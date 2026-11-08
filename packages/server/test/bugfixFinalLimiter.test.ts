// Final bug cycle: BE-081 (and BE-082).
//   BE-081  Ten wrong sign-ins from ONE address (any accounts) blocked every sign-in from it for 15 minutes, correct ones too. A factory
//           behind one router or one mobile NAT address could be locked out by ten fumbled PINs spread over a shift. The failures are now
//           counted per address AND account (the same budget as before, 10), with a much higher ceiling per address (60), so one person's
//           mistakes stop only that person, and one address still cannot try many accounts without limit.
//   BE-082  A supervisor's account lock (5 wrong PINs, 15 minutes) is kept on purpose: the phone shows a calm message, and a merchandiser's
//           PIN reset clears it. (A stranger who knows a phone number can lock that account: accepted, see audit/bugcycle/fb.md.)
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { LOGIN_ADDRESS_BUDGET, LOGIN_BUDGET, LOGIN_WINDOW_MS, createLoginLimiter } from '../src/loginLimiter.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const SECRET = 'x'.repeat(40)
let now = new Date('2026-11-04T04:30:00Z')
let pg: PGlite, db: Db, app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); now = new Date('2026-11-04T04:30:00Z'); app = buildApp({ db, tokenSecret: SECRET, clock: () => now }) })
afterAll(async () => { await pg.close() })

const ADDR = '203.0.113.9'
const login = (payload: object, remoteAddress = ADDR) => app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress, payload })
const wrongFor = (email: string) => login({ email, password: 'not the password' }).then((r) => r.statusCode)
const wrongBody = (payload: object) => login(payload).then((r) => ({ status: r.statusCode, code: (r.json() as { error?: { code?: string } }).error?.code }))
const rightMerch = () => login({ email: CREDS.email, password: CREDS.password }).then((r) => r.statusCode)

describe('BE-081: the budget is per address and account, with a higher ceiling per address', () => {
  it('BE-081: the numbers: 10 per address and account, 60 per address', () => {
    expect(LOGIN_BUDGET).toBe(10)
    expect(LOGIN_ADDRESS_BUDGET).toBe(60)
  })

  it("BE-081: one account has wrong tries (it locks after 5, the address budget for it ends at 10) and that never stops a different person from signing in at the same address", async () => {
    for (let i = 0; i < 5; i++) expect(await wrongFor('typo@example.test')).toBe(401)
    for (let i = 0; i < LOGIN_BUDGET - 5; i++) expect(await wrongFor('typo@example.test')).toBe(429)   // locked: still counted
    const stopped = await wrongBody({ email: 'typo@example.test', password: 'x' })
    expect(stopped).toEqual({ status: 429, code: 'rate_limited' })                // the limiter, not the account lock, answers now
    expect(await rightMerch()).toBe(200)                                          // someone else behind the same address: not blocked (it was, before)
  })

  it('BE-081: failures spread over many accounts from one address (a factory\'s fumbled PINs) do not block a right sign-in', async () => {
    for (let i = 0; i < 30; i++) expect(await wrongFor(`fumble${i}@example.test`)).toBe(401)
    expect(await rightMerch()).toBe(200)
  })

  it('BE-081: one address still cannot try accounts without limit: the 61st failure is refused, and so is everyone from that address after it', async () => {
    for (let i = 0; i < LOGIN_ADDRESS_BUDGET; i++) expect(await wrongFor(`spray${i}@example.test`)).toBe(401)
    expect(await wrongFor('spray-next@example.test')).toBe(429)
    expect(await rightMerch()).toBe(429)
    expect(await login({ email: CREDS.email, password: CREDS.password }, '198.51.100.20').then((r) => r.statusCode)).toBe(200)   // another address is untouched
  })

  it('BE-081: after the window the account is allowed again', async () => {
    for (let i = 0; i < LOGIN_BUDGET; i++) await wrongFor('typo@example.test')
    expect(await wrongFor('typo@example.test')).toBe(429)
    now = new Date(now.getTime() + LOGIN_WINDOW_MS + 1000)
    expect(await wrongFor('typo@example.test')).toBe(401)
  })

  it('BE-081: the account is the same whatever its spelling (case and spaces of an email, the form of a phone number)', async () => {
    for (let i = 0; i < LOGIN_BUDGET; i++) await wrongFor(i % 2 ? 'Typo@Example.test' : ' typo@example.TEST ')
    // all ten were counted under one account, so the limiter (not the account lock) answers the next one
    expect(await wrongBody({ email: 'typo@example.test', password: 'x' })).toEqual({ status: 429, code: 'rate_limited' })
    const forms = ['90000 10999', '9000010999', '+91 90000-10999', '90000-10999', '919000010999']
    for (let i = 0; i < LOGIN_BUDGET; i++) await login({ phone: forms[i % forms.length], pin: '0000' })
    expect(await wrongBody({ phone: '9000010999', pin: '0000' })).toEqual({ status: 429, code: 'rate_limited' })
  })

  it('BE-081: the limiter itself keeps the scopes apart and counts a scoped spend only in its scope', () => {
    const l = createLoginLimiter()
    const t = 1_000
    for (let i = 0; i < LOGIN_BUDGET; i++) l.spend('192.0.2.1', t, 'a')
    expect(l.blocked('192.0.2.1', t, 'a')).toBe(true)
    expect(l.blocked('192.0.2.1', t, 'b')).toBe(false)
    expect(l.blocked('192.0.2.1', t)).toBe(false)
    expect(l.blocked('192.0.2.2', t, 'a')).toBe(false)
  })
})

describe('BE-082: a supervisor\'s account lock', () => {
  const supWrong = () => login({ phone: CREDS.phone, pin: '0000' }).then((r) => ({ status: r.statusCode, body: r.json() as { error?: { code?: string; message?: string } } }))

  it('BE-082: five wrong PINs lock the account for 15 minutes with a calm message that does not blame the person', async () => {
    for (let i = 0; i < 5; i++) expect((await supWrong()).status).toBe(401)
    const locked = await supWrong()
    expect(locked.status).toBe(429)
    expect(locked.body.error?.code).toBe('locked')
    expect(locked.body.error?.message).toMatch(/try again in 15 minutes/i)
    // and even the right PIN is refused while it is locked
    expect((await login({ phone: CREDS.phone, pin: CREDS.pin })).statusCode).toBe(429)
  })

  it('BE-082: a merchandiser\'s PIN reset clears the lock and the supervisor signs in with the new PIN', async () => {
    for (let i = 0; i < 6; i++) await supWrong()
    const token = (await login({ email: CREDS.email, password: CREDS.password }, '198.51.100.30')).json().token as string
    const reset = await app.inject({ method: 'POST', url: `/api/accounts/${ID.sup1}/pin`, headers: { authorization: `Bearer ${token}` }, payload: { pin: '7391' } })
    expect(reset.statusCode).toBeLessThan(300)
    expect((await login({ phone: CREDS.phone, pin: '7391' }, '198.51.100.31')).statusCode).toBe(200)
  })

  it('BE-082: the lock is 15 minutes: after that the right PIN works again', async () => {
    for (let i = 0; i < 6; i++) await supWrong()
    now = new Date(now.getTime() + 16 * 60_000)
    expect((await login({ phone: CREDS.phone, pin: CREDS.pin }, '198.51.100.32')).statusCode).toBe(200)
  })
})
