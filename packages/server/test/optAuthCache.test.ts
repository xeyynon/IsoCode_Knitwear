// OPT-LANE C: O-5, the sign-in check remembers an account for a few seconds, and every route that changes an account forgets it at once.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { AUTH_CACHE_MS, createAuthCache, type AccountState } from '../src/authCache.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const SECRET = 'x'.repeat(40)
const NOW = new Date('2026-11-04T04:30:00Z')
let pg: PGlite
let real: Db
let app: FastifyInstance
let lookups = 0
let txs = 0
/** Counts the transactions and the account lookups the sign-in check makes. */
const counting: Db = {
  tx: (ctx, fn) => { txs++; return real.tx(ctx, (tx) => fn({ query: (sql, p) => { if (/from account where id = \$1/.test(sql)) lookups++; return tx.query(sql, p) } })) },
}
beforeAll(async () => { pg = await migratedDb(); real = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); lookups = 0; txs = 0; app = buildApp({ db: counting, tokenSecret: SECRET, clock: () => NOW }) })
afterAll(async () => { await pg.close() })

const login = async (a: FastifyInstance, b: object) => (await a.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token as string
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
const merch = (a = app) => login(a, { email: CREDS.email, password: CREDS.password }).then(bearer)
const sup = (a = app) => login(a, { phone: CREDS.phone, pin: CREDS.pin }).then(bearer)
const me = (h: Record<string, string>, a = app) => a.inject({ url: '/api/me', headers: h }).then((r) => r.statusCode)
const post = (h: Record<string, string>, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: h, payload })

describe('O-5: fewer round trips for the sign-in check', () => {
  it('O-5: the account is read once for many requests, not once per request (4 round trips each before)', async () => {
    const h = await sup()
    lookups = 0; txs = 0
    for (let i = 0; i < 20; i++) expect(await me(h)).toBe(200)
    expect(lookups).toBe(1)
    expect(txs).toBe(1)   // /api/me opens no transaction of its own: 20 requests cost one
  })
  it('O-5: concurrent first requests share one lookup', async () => {
    const h = await sup()
    app.authCache.invalidate()
    lookups = 0
    const codes = await Promise.all(Array.from({ length: 15 }, () => me(h)))
    expect(codes).toEqual(Array(15).fill(200))
    expect(lookups).toBe(1)
  })
  it('O-5: authCacheMs 0 switches it off: one lookup per request, as before', async () => {
    const off = buildApp({ db: counting, tokenSecret: SECRET, clock: () => NOW, authCacheMs: 0 })
    const h = await sup(off)
    lookups = 0
    for (let i = 0; i < 5; i++) await me(h, off)
    expect(lookups).toBe(5)
  })
})

describe('O-5: a change made through this process takes effect on the very next request', () => {
  it('O-5: stopping an account: the next request is 401, though the account was remembered a moment ago', async () => {
    const m = await merch()
    const s = await sup()
    expect(await me(s)).toBe(200)                                   // remembered now
    expect((await post(m, `/api/accounts/${ID.sup1}/disabled`, { disabled: true })).statusCode).toBe(200)
    expect(await me(s)).toBe(401)                                   // the very next request
    expect((await post(m, `/api/accounts/${ID.sup1}/disabled`, { disabled: false })).statusCode).toBe(200)
    expect(await me(s)).toBe(401)                                   // allowing again does not bring the old sign-in back (token version moved)
  })
  it('O-5: sign out everywhere, in capitals too', async () => {
    const m = await merch()
    const s = await sup()
    expect(await me(s)).toBe(200)
    expect((await post(m, `/api/accounts/${ID.sup1.toUpperCase()}/sign-out`)).statusCode).toBe(200)
    expect(await me(s)).toBe(401)
  })
  it('O-5: a PIN reset signs the person out at once', async () => {
    const m = await merch()
    const s = await sup()
    expect(await me(s)).toBe(200)
    expect((await post(m, `/api/accounts/${ID.sup1}/pin`, { pin: '7391' })).statusCode).toBe(200)
    expect(await me(s)).toBe(401)
  })
  it('O-5: an account stopped while someone else is signed in does not touch the other account', async () => {
    const m = await merch()
    const s = await sup()
    expect(await me(s)).toBe(200)
    await post(m, `/api/accounts/${ID.sup1}/disabled`, { disabled: true })
    expect(await me(m)).toBe(200)
  })
  it('O-5: a new account is usable at once (nothing is remembered about an id that was not found)', async () => {
    const m = await merch()
    const ghost = '00000000-0000-0000-0000-00000000f00d'
    const { signToken } = await import('../src/auth.js')
    const t = bearer(signToken({ sub: ghost, role: 'merchandiser', exp: Math.floor(NOW.getTime() / 1000) + 600, ver: 0 }, SECRET))
    expect(await me(t)).toBe(401)                                   // no such account yet
    await pg.query(`insert into account (id, role, email, password_hash) values ($1, 'merchandiser', 'late@example.test', 'x')`, [ghost])
    expect(await me(t)).toBe(200)                                   // the "not found" was not remembered
    void m
  })
})

describe('O-5: the memory is what makes the difference (a test that fails if an invalidation call is removed)', () => {
  it('O-5: a change made behind the app\'s back (SQL) is not seen inside the window, is seen after invalidate(), and after the window', async () => {
    const s = await sup()
    expect(await me(s)).toBe(200)
    await pg.query(`update account set disabled_at = now(), token_version = token_version + 1 where id = $1`, [ID.sup1])
    expect(await me(s)).toBe(200)                                   // the documented staleness: another process or a direct edit
    app.authCache.invalidate(ID.sup1)
    expect(await me(s)).toBe(401)
  })
  it('O-5: and without invalidate() the window ends by itself after authCacheMs', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() })
    try {
      const a = buildApp({ db: counting, tokenSecret: SECRET, clock: () => NOW })
      const s = await sup(a)
      expect(await me(s, a)).toBe(200)
      await pg.query(`update account set token_version = token_version + 1 where id = $1`, [ID.sup1])
      vi.setSystemTime(Date.now() + AUTH_CACHE_MS - 100)
      expect(await me(s, a)).toBe(200)
      vi.setSystemTime(Date.now() + 200)
      expect(await me(s, a)).toBe(401)
    } finally { vi.useRealTimers() }
  })
  it('O-5: a route that forgets to call invalidate would leave the old sign-in working (the sign-out route is checked with the call removed)', async () => {
    // The same sequence as the sign-out test, but with the app's own cache replaced by one that ignores invalidate(): it must fail.
    const s = await sup()
    const m = await merch()
    expect(await me(s)).toBe(200)
    const real = app.authCache.invalidate.bind(app.authCache)
    app.authCache.invalidate = () => undefined
    await post(m, `/api/accounts/${ID.sup1}/sign-out`)
    expect(await me(s)).toBe(200)                                   // stale: this is exactly the bug the invalidation prevents
    app.authCache.invalidate = real
    app.authCache.invalidate()
    expect(await me(s)).toBe(401)
  })
})

describe('O-5: the cache itself', () => {
  const state: AccountState = { token_version: 0, disabled: false, unit_id: null }
  it('O-5: a lookup that was running when the account was invalidated is not stored', async () => {
    const c = createAuthCache(5000)
    let release!: (s: AccountState) => void
    const slow = c.lookup('a', () => new Promise<AccountState>((r) => { release = r }))
    c.invalidate('a')
    release({ ...state, token_version: 7 })
    expect((await slow)!.token_version).toBe(7)     // the caller that asked gets its answer
    expect(c.size).toBe(0)                           // but nobody after it reuses it
    let loads = 0
    await c.lookup('a', async () => { loads++; return state })
    expect(loads).toBe(1)
  })
  it('O-5: a lookup that starts after an invalidation does not join one that started before it', async () => {
    const c = createAuthCache(5000)
    let release!: (s: AccountState) => void
    const before = c.lookup('a', () => new Promise<AccountState>((r) => { release = r }))
    c.invalidate('a')
    const after = await c.lookup('a', async () => ({ ...state, token_version: 9 }))
    expect(after!.token_version).toBe(9)
    release({ ...state, token_version: 1 })
    await before
    expect((await c.lookup('a', async () => state))!.token_version).toBe(9)   // the newer answer is the one kept
  })
  it('O-5: it holds at most `max` accounts and forgets the oldest; entries expire; spellings of one id are one entry', async () => {
    let t = 0
    const c = createAuthCache(1000, 50, () => t)
    for (let i = 0; i < 500; i++) await c.lookup(`id-${i}`, async () => state)
    expect(c.size).toBeLessThanOrEqual(50)
    let loads = 0
    const load = async () => { loads++; return state }
    await c.lookup('ABC', load); await c.lookup('abc', load)
    expect(loads).toBe(1)
    t = 999; await c.lookup('abc', load); expect(loads).toBe(1)
    t = 1001; await c.lookup('abc', load); expect(loads).toBe(2)
  })
  it('O-5: a failed lookup is not remembered, and not found is not remembered', async () => {
    const c = createAuthCache(5000)
    await expect(c.lookup('a', async () => { throw new Error('db down') })).rejects.toThrow('db down')
    expect(await c.lookup('a', async () => undefined)).toBeUndefined()
    expect(c.size).toBe(0)
    expect(await c.lookup('a', async () => state)).toEqual(state)
  })
})
