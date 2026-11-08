// OPT-LANE C: the sign-in limiter in app.ts (BE-044, BE-045; audit O-12).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { LOGIN_BUDGET, LOGIN_WINDOW_MS, createLoginLimiter, limiterKey } from '../src/loginLimiter.js'
import { CREDS, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const SECRET = 'x'.repeat(40)
let now = new Date('2026-11-04T04:30:00Z')
let pg: PGlite
let db: Db
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); now = new Date('2026-11-04T04:30:00Z') })
afterAll(async () => { await pg.close() })

const apps: FastifyInstance[] = []
const make = (trustProxy?: boolean | number | string[]) => {
  const a = buildApp({ db, tokenSecret: SECRET, clock: () => now, ...(trustProxy === undefined ? {} : { trustProxy }) })
  apps.push(a)
  return a
}
// A wrong password for an email nobody has: only the per-address budget moves, never an account lock.
let n = 0
const wrong = (a: FastifyInstance, remoteAddress: string, xff?: string) =>
  a.inject({ method: 'POST', url: '/api/auth/login', remoteAddress, ...(xff ? { headers: { 'x-forwarded-for': xff } } : {}),
    payload: { email: `nobody${n++}@example.test`, password: 'not the password' } }).then((r) => r.statusCode)
const right = (a: FastifyInstance, remoteAddress: string) =>
  a.inject({ method: 'POST', url: '/api/auth/login', remoteAddress, payload: { email: CREDS.email, password: CREDS.password } }).then((r) => r.statusCode)

describe('BE-044: the caller is the address the nearest trusted proxy saw', () => {
  it('BE-044: with one proxy in front, writing a different left-most X-Forwarded-For does not reset the budget', async () => {
    const a = make(1)
    const proxy = '10.0.0.1'
    // The real caller is 203.0.113.7: the proxy appends it after whatever the caller wrote.
    for (let i = 0; i < LOGIN_BUDGET; i++) expect(await wrong(a, proxy, `198.51.100.${i + 1}, 203.0.113.7`)).toBe(401)
    expect(await wrong(a, proxy, '198.51.100.200, 203.0.113.7')).toBe(429)
    expect(await wrong(a, proxy, '203.0.113.7')).toBe(429)
    expect(await wrong(a, proxy, '1.2.3.4, 5.6.7.8, 203.0.113.7')).toBe(429)
    expect(a.loginLimiter.size).toBe(1)
  })
  it('BE-044: another real caller behind the same proxy has a budget of their own', async () => {
    const a = make(1)
    for (let i = 0; i < LOGIN_BUDGET; i++) await wrong(a, '10.0.0.1', '203.0.113.7')
    expect(await wrong(a, '10.0.0.1', '203.0.113.7')).toBe(429)
    expect(await wrong(a, '10.0.0.1', '203.0.113.8')).toBe(401)
  })
  it('BE-044: with no proxy trusted, X-Forwarded-For is ignored altogether', async () => {
    const a = make()
    for (let i = 0; i < LOGIN_BUDGET; i++) expect(await wrong(a, '10.0.0.9', `198.51.100.${i + 1}`)).toBe(401)
    expect(await wrong(a, '10.0.0.9', '198.51.100.99')).toBe(429)
  })
  it('BE-044: `true` means one proxy, not "believe the first address in the header"', async () => {
    const a = make(true)
    for (let i = 0; i < LOGIN_BUDGET; i++) expect(await wrong(a, '10.0.0.1', `198.51.100.${i + 1}, 203.0.113.7`)).toBe(401)
    expect(await wrong(a, '10.0.0.1', '198.51.100.250, 203.0.113.7')).toBe(429)
  })
  it('BE-044: a list of proxy addresses works the same way (the proxy is trusted, the caller in front of it is not)', async () => {
    const a = make(['10.0.0.0/8'])
    for (let i = 0; i < LOGIN_BUDGET; i++) expect(await wrong(a, '10.1.2.3', `198.51.100.${i + 1}, 203.0.113.7`)).toBe(401)
    expect(await wrong(a, '10.1.2.3', '198.51.100.250, 203.0.113.7')).toBe(429)
  })
  it('BE-044: one address cannot have many budgets by writing it in other spellings of the same address', () => {
    expect(limiterKey('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(limiterKey('203.0.113.7')).toBe('203.0.113.7')
    expect(limiterKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(limiterKey('2001:0DB8:0001:0002::1'))   // the same /64
    expect(limiterKey('2001:db8:1:2::1')).not.toBe(limiterKey('2001:db8:1:3::1'))
    expect(limiterKey('FE80::1%eth0')).toBe(limiterKey('fe80::2'))
    expect(limiterKey('x'.repeat(500)).length).toBeLessThanOrEqual(64)
  })
})

describe('BE-045: the limiter map stays small', () => {
  it('BE-045: a hard cap: a million addresses leave at most `max` entries, and a newcomer still gets the whole budget', () => {
    const l = createLoginLimiter(LOGIN_BUDGET, LOGIN_WINDOW_MS, 100)
    const t = 1_000_000
    for (let i = 0; i < 20_000; i++) l.spend(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, t)
    expect(l.size).toBeLessThanOrEqual(100)
    for (let i = 0; i < LOGIN_BUDGET; i++) { expect(l.blocked('192.0.2.1', t)).toBe(false); l.spend('192.0.2.1', t) }
    expect(l.blocked('192.0.2.1', t)).toBe(true)
  })
  it('BE-045: an entry whose window has ended is removed by the sweep, one still running is not', () => {
    const l = createLoginLimiter()
    l.spend('192.0.2.1', 0)
    l.spend('192.0.2.2', LOGIN_WINDOW_MS - 10)
    expect(l.size).toBe(2)
    expect(l.sweep(LOGIN_WINDOW_MS)).toBe(1)
    expect(l.size).toBe(1)
    expect(l.blocked('192.0.2.2', LOGIN_WINDOW_MS)).toBe(false)
  })
  it('BE-045: a try that spends nothing leaves no entry: a good sign-in, a bad body, a request refused for load', async () => {
    const a = make(1)
    expect(await right(a, '10.0.0.1')).toBe(200)
    expect(a.loginLimiter.size).toBe(0)
    const bad = await a.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.0.1', headers: { 'content-type': 'application/json' }, payload: '"text"' })
    expect(bad.statusCode).toBe(400)
    expect(a.loginLimiter.size).toBe(0)
    expect(await wrong(a, '10.0.0.1')).toBe(401)
    expect(a.loginLimiter.size).toBe(1)
    // a good sign-in does not hand back the failure already spent
    expect(await right(a, '10.0.0.1')).toBe(200)
    expect(a.loginLimiter.size).toBe(1)
  })
  it('BE-045: the sweep runs on a timer that does not keep the process alive, and the timer stops when the app closes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const spy = vi.spyOn(globalThis, 'setInterval')
      const a = make()
      const timer = spy.mock.results.map((r) => r.value as NodeJS.Timeout).find((t) => typeof t?.hasRef === 'function')
      expect(timer).toBeDefined()
      expect(timer!.hasRef()).toBe(false)
      expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1)
      const before = vi.getTimerCount()
      a.loginLimiter.spend('192.0.2.1', now.getTime())
      now = new Date(now.getTime() + LOGIN_WINDOW_MS + 1000)
      vi.advanceTimersByTime(61_000)
      expect(a.loginLimiter.size).toBe(0)
      await a.close()
      expect(vi.getTimerCount()).toBe(before - 1)
      spy.mockRestore()
    } finally { vi.useRealTimers() }
  })
})
