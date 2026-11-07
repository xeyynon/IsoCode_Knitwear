import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, cleanOrigin, parseOrigins, signToken, verifyToken, hashSecret, verifySecret, normalisePhone, LOCK_MINUTES, MAX_FAILED_ATTEMPTS, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const SECRET = 'x'.repeat(40)
// 2026-11-04 10:00 in India: the "today" the seed data is built around
let now = new Date('2026-11-04T04:30:00Z')

let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => {
  await resetAndSeed(pg)
  now = new Date('2026-11-04T04:30:00Z')
  app = buildApp({ db, tokenSecret: SECRET, allowedOrigins: ['https://app.example.test'], clock: () => now })
})
afterAll(async () => { await pg.close() })

const signIn = async (body: object) => {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: body })
  return { res, json: res.json() as Record<string, any> }
}
const merchToken = async () => (await signIn({ email: CREDS.email, password: CREDS.password })).json.token as string
const supToken = async () => (await signIn({ phone: CREDS.phone, pin: CREDS.pin })).json.token as string
const auth = (token: string) => ({ authorization: `Bearer ${token}` })
const evt = (over: object = {}) => ({ clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 100, ...over })

describe('starting up', () => {
  it('refuses to start without a token secret (fails closed)', () => {
    expect(() => buildApp({ db, tokenSecret: '' })).toThrow(/TOKEN_SECRET/)
    expect(() => buildApp({ db, tokenSecret: 'short' })).toThrow(/TOKEN_SECRET/)
  })
})

describe('public routes', () => {
  it('health needs no sign-in', async () => {
    const res = await app.inject({ url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
  it('status reports plain names and states only, and no secrets or errors', async () => {
    const res = await app.inject({ url: '/api/status' })
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.checks.map((c: any) => [c.name, c.state])).toEqual([['API', 'up'], ['Database', 'up']])
    expect(JSON.stringify(body)).not.toMatch(/postgres|password|secret|token/i)
  })
  it('status says Down when the database is unreachable, without leaking why', async () => {
    const broken: Db = { tx: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2') } }
    const a = buildApp({ db: broken, tokenSecret: SECRET, clock: () => now })
    const body = (await a.inject({ url: '/api/status' })).json()
    expect(body.ok).toBe(false)
    expect(body.checks[1]).toMatchObject({ name: 'Database', state: 'down' })
    expect(JSON.stringify(body)).not.toMatch(/10\.0\.0\.5|hunter2/)
  })
})

describe('every other route is guarded by default', () => {
  it.each([
    ['GET', '/api/board'], ['GET', '/api/me'], ['POST', '/api/events'], ['POST', '/api/events/batch'],
    ['GET', '/api/anything-new-added-later'],
  ])('%s %s without a token is 401', async (method, url) => {
    const res = await app.inject({ method: method as 'GET', url })
    expect(res.statusCode).toBe(401)
  })
  it('rejects a tampered token, an expired token and a token signed with another secret', async () => {
    const good = await merchToken()
    const [body, sig] = good.split('.')
    const forged = `${Buffer.from(JSON.stringify({ sub: 'x', role: 'merchandiser', exp: 9_999_999_999 })).toString('base64url')}.${sig}`
    const expired = signToken({ sub: 'x', role: 'merchandiser', exp: Math.floor(now.getTime() / 1000) - 1 }, SECRET)
    const other = signToken({ sub: 'x', role: 'merchandiser', exp: 9_999_999_999 }, 'y'.repeat(40))
    for (const t of [forged, expired, other, `${body}.`, 'garbage', `${good}.extra`]) {
      expect((await app.inject({ url: '/api/me', headers: auth(t) })).statusCode).toBe(401)
    }
    expect((await app.inject({ url: '/api/me', headers: auth(good) })).statusCode).toBe(200)
  })
})

describe('signing in', () => {
  it('merchandiser: email and password, case-insensitive email', async () => {
    const { res, json } = await signIn({ email: '  M@Example.TEST ', password: CREDS.password })
    expect(res.statusCode).toBe(200)
    expect(json.role).toBe('merchandiser')
    expect(res.headers['cache-control']).toBe('no-store')
  })
  it('supervisor: phone (any common format) and 4-digit PIN; token carries the unit', async () => {
    for (const phone of ['9876543210', '+91 98765 43210', '98765-43210']) {
      const { res, json } = await signIn({ phone, pin: CREDS.pin })
      expect(res.statusCode).toBe(200)
      expect(verifyToken(json.token, SECRET, now)).toMatchObject({ role: 'supervisor', unitId: ID.unit1 })
    }
  })
  it('a supervisor token lasts 30 days, a merchandiser token 12 hours', async () => {
    const m = (await signIn({ email: CREDS.email, password: CREDS.password })).json
    const s = (await signIn({ phone: CREDS.phone, pin: CREDS.pin })).json
    expect(Date.parse(m.expiresAt) - now.getTime()).toBe(12 * 3600_000)
    expect(Date.parse(s.expiresAt) - now.getTime()).toBe(30 * 86_400_000)
  })
  it('a wrong password and an unknown account give the same answer', async () => {
    const wrong = await signIn({ email: CREDS.email, password: 'nope' })
    const unknown = await signIn({ email: 'nobody@example.test', password: 'nope' })
    expect(wrong.res.statusCode).toBe(401)
    expect(unknown.res.statusCode).toBe(401)
    expect(wrong.json).toEqual(unknown.json)
  })
  it('a merchandiser cannot sign in with the supervisor PIN route and vice versa', async () => {
    expect((await signIn({ phone: CREDS.phone, pin: '0000' })).res.statusCode).toBe(401)
    expect((await signIn({ email: '9876543210', password: CREDS.pin })).res.statusCode).toBe(401)
  })
  it.each([
    [{}], [{ email: CREDS.email }], [{ phone: CREDS.phone, pin: '12' }], [{ phone: 'abc', pin: '1234' }], [{ phone: CREDS.phone, pin: 1234 }],
  ])('rejects malformed input %j with 400', async (body) => {
    expect((await signIn(body)).res.statusCode).toBe(400)
  })
  it(`locks an account after ${MAX_FAILED_ATTEMPTS} wrong PINs, even for the right PIN, then unlocks`, async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) expect((await signIn({ phone: CREDS.phone, pin: '0000' })).res.statusCode).toBe(401)
    const locked = await signIn({ phone: CREDS.phone, pin: CREDS.pin })
    expect(locked.res.statusCode).toBe(429)
    expect(locked.json.error.code).toBe('locked')
    now = new Date(now.getTime() + (LOCK_MINUTES + 1) * 60_000)
    expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).res.statusCode).toBe(200)
  })
  it(`once a lock has run out, the account gets ${MAX_FAILED_ATTEMPTS} fresh tries`, async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await signIn({ phone: CREDS.phone, pin: '0000' })
    now = new Date(now.getTime() + (LOCK_MINUTES + 1) * 60_000)
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) expect((await signIn({ phone: CREDS.phone, pin: '0000' })).res.statusCode).toBe(401)
    expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).res.statusCode).toBe(200)
    // and the fifth fresh wrong try locks it again
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await signIn({ phone: CREDS.phone, pin: '0000' })
    expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).res.statusCode).toBe(429)
  })
  it('a successful sign-in resets the failed-attempt count', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) await signIn({ phone: CREDS.phone, pin: '0000' })
    expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).res.statusCode).toBe(200)
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) await signIn({ phone: CREDS.phone, pin: '0000' })
    expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).res.statusCode).toBe(200)
  })
  it('limits sign-in attempts per address', async () => {
    let last = 0
    for (let i = 0; i < 11; i++) last = (await signIn({ email: `x${i}@example.test`, password: 'nope' })).res.statusCode
    expect(last).toBe(429)
    expect((await signIn({ email: CREDS.email, password: CREDS.password })).res.statusCode).toBe(429)
  })
  it('a successful sign-in does not give back failures the address has already spent', async () => {
    for (let i = 0; i < 9; i++) expect((await signIn({ email: `x${i}@example.test`, password: 'nope' })).res.statusCode).toBe(401)
    expect((await signIn({ email: CREDS.email, password: CREDS.password })).res.statusCode).toBe(200)
    expect((await signIn({ email: 'y@example.test', password: 'nope' })).res.statusCode).toBe(401)
    expect((await signIn({ email: 'z@example.test', password: 'nope' })).res.statusCode).toBe(429)
  })
  it('wrong PINs sent at the same moment are all counted, so the lock still comes after five', async () => {
    // PGlite runs one transaction at a time, which hides the race. This Db models Postgres's
    // READ COMMITTED: each statement commits on its own, and every sign-in has read the account
    // before any of them writes it back.
    const N = 10
    let read = 0
    let release!: () => void
    const allRead = new Promise<void>((r) => { release = r })
    const racy: Db = {
      tx: async (ctx, fn) => {
        let first = true
        return fn({
          query: async (sql, params) => {
            const rows = await db.tx(ctx, (t) => t.query(sql, params))
            if (first && /from account/.test(sql)) { first = false; if (++read === N) release(); await allRead }
            return rows as never
          },
        })
      },
    }
    const a = buildApp({ db: racy, tokenSecret: SECRET, clock: () => now })
    const codes = await Promise.all(Array.from({ length: N }, (_, i) =>
      a.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: CREDS.phone, pin: '0000' }, remoteAddress: `10.0.0.${i + 1}` })
        .then((r) => r.statusCode)))
    expect(codes).toEqual(Array(N).fill(401))
    const [acc] = (await pg.query<{ failed_attempts: number }>(`select failed_attempts from account where id = '${ID.sup1}'`)).rows
    expect(acc!.failed_attempts).toBe(N)
    expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).json.error.code).toBe('locked')
  })
  it('a burst of wrong sign-ins from one address cannot all slip past the per-address limit', async () => {
    const slow: Db = { tx: async (ctx, fn) => { await new Promise((r) => setTimeout(r, 30)); return db.tx(ctx, fn) } }
    const a = buildApp({ db: slow, tokenSecret: SECRET, clock: () => now })
    const codes = await Promise.all(Array.from({ length: 30 }, (_, i) =>
      a.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `x${i}@example.test`, password: 'nope' } })
        .then((r) => r.statusCode)))
    expect(codes.filter((c) => c === 401)).toHaveLength(10)
    expect(codes.filter((c) => c === 429)).toHaveLength(20)
  })
})

describe('the board', () => {
  it('a merchandiser gets every order, worst first, with the maths', async () => {
    const res = await app.inject({ url: '/api/board', headers: auth(await merchToken()) })
    const body = res.json()
    expect(res.statusCode).toBe(200)
    expect(body.today).toBe('2026-11-04')
    expect(body.rows.map((r: any) => r.status)).toEqual(['red', 'grey', 'green'])
    expect(body.rows[0].maths).toBe('Need 467/day · making 350/day · 700 pcs short by 11 Nov.')
    expect(res.headers['cache-control']).toBe('no-store')
  })
  it('a supervisor is refused', async () => {
    expect((await app.inject({ url: '/api/board', headers: auth(await supToken()) })).statusCode).toBe(403)
  })
})

describe('sending updates', () => {
  it('a supervisor posts for their own stage; the board then changes', async () => {
    const s = await supToken()
    const res = await app.inject({ method: 'POST', url: '/api/events', headers: auth(s), payload: evt({ qty: 2000 }) })
    expect(res.json()).toEqual({ ok: true, duplicate: false })
    const board = (await app.inject({ url: '/api/board', headers: auth(await merchToken()) })).json()
    expect(board.rows.find((r: any) => r.po === 'B-PO-88240').status).toBe('green')
  })
  it('a retried send is reported as a duplicate and counted once', async () => {
    const s = await supToken()
    const payload = evt()
    await app.inject({ method: 'POST', url: '/api/events', headers: auth(s), payload })
    const again = await app.inject({ method: 'POST', url: '/api/events', headers: auth(s), payload })
    expect(again.json()).toEqual({ ok: true, duplicate: true })
    const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from update_event where client_uuid = $1`, [payload.clientUuid])
    expect(rows[0]?.n).toBe(1)
  })
  it("a supervisor cannot post for another unit's order", async () => {
    const res = await app.inject({ method: 'POST', url: '/api/events', headers: auth(await supToken()), payload: evt({ orderId: ID.orderGreen }) })
    expect(res.statusCode).toBe(404)
  })
  it('bad input is a 400 with a plain message', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/events', headers: auth(await supToken()), payload: evt({ qty: -5 }) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/whole number/)
  })
  it('malformed JSON is a 400, not a stack trace', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/events', headers: { ...auth(await supToken()), 'content-type': 'application/json' }, payload: '{not json' })
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toMatch(/at |node_modules|SyntaxError/)
  })

  describe('batch (the offline queue)', () => {
    it('reports each item; one bad item does not sink the rest', async () => {
      const s = await supToken()
      const good = evt()
      const res = await app.inject({
        method: 'POST', url: '/api/events/batch', headers: auth(s),
        payload: { events: [good, evt({ qty: -1 }), evt({ orderId: ID.orderGreen }), good] },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().results.map((r: any) => r.result)).toEqual(['accepted', 'rejected', 'rejected', 'duplicate'])
      expect(res.json().results[1]).toMatchObject({ code: 'bad_request' })
    })
    it('re-sending the whole batch after a lost response changes nothing', async () => {
      const s = await supToken()
      const events = [evt(), evt(), evt()]
      await app.inject({ method: 'POST', url: '/api/events/batch', headers: auth(s), payload: { events } })
      const again = await app.inject({ method: 'POST', url: '/api/events/batch', headers: auth(s), payload: { events } })
      expect(again.json().results.map((r: any) => r.result)).toEqual(['duplicate', 'duplicate', 'duplicate'])
      const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from update_event where date = '2026-11-04'`)
      expect(rows[0]?.n).toBe(3)
    })
    it('a null item is rejected on its own; the rest still go through', async () => {
      const s = await supToken()
      const res = await app.inject({ method: 'POST', url: '/api/events/batch', headers: auth(s), payload: { events: [evt(), null] } })
      expect(res.statusCode).toBe(200)
      expect(res.json().results.map((r: any) => r.result)).toEqual(['accepted', 'rejected'])
      expect(res.json().results[1]).toMatchObject({ code: 'bad_request' })
    })
    it('a null body on a single update is a 400', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/events', headers: { ...auth(await supToken()), 'content-type': 'application/json' }, payload: 'null' })
      expect(res.statusCode).toBe(400)
    })
    it('rejects an empty or oversized batch', async () => {
      const s = await supToken()
      for (const events of [[], Array.from({ length: 201 }, () => evt())]) {
        expect((await app.inject({ method: 'POST', url: '/api/events/batch', headers: auth(s), payload: { events } })).statusCode).toBe(400)
      }
    })
  })
})

describe('errors never leak detail', () => {
  it('an unexpected failure is a plain 500', async () => {
    const boom: Db = { tx: async () => { throw new Error('relation "orders" does not exist at /srv/app/db.ts:12') } }
    const a = buildApp({ db: boom, tokenSecret: SECRET, clock: () => now })
    const token = signToken({ sub: 'x', role: 'merchandiser', exp: Math.floor(now.getTime() / 1000) + 600 }, SECRET)
    const res = await a.inject({ url: '/api/board', headers: auth(token) })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toMatch(/relation|srv|db\.ts/)
  })
  it('unknown paths are a plain 404', async () => {
    const res = await app.inject({ url: '/api/health/x', headers: auth(await merchToken()) })
    expect(res.statusCode).toBe(404)
  })
})

describe('CORS', () => {
  it('allows only listed origins', async () => {
    const ok = await app.inject({ url: '/api/health', headers: { origin: 'https://app.example.test' } })
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.test')
    const bad = await app.inject({ url: '/api/health', headers: { origin: 'https://evil.example.test' } })
    expect(bad.headers['access-control-allow-origin']).toBeUndefined()
  })
  it('answers the preflight without needing a token', async () => {
    const res = await app.inject({ method: 'OPTIONS', url: '/api/events', headers: { origin: 'https://app.example.test', 'access-control-request-method': 'POST' } })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/)
  })
  it('cleans hand-pasted origins (stray brackets, quotes, slashes, newlines, case)', () => {
    expect(cleanOrigin('>https://App.Example.test/')).toBe('https://app.example.test')
    expect(cleanOrigin('"https://app.example.test"\n')).toBe('https://app.example.test')
    expect(cleanOrigin('app.example.test')).toBeNull()   // no scheme
    expect(parseOrigins('https://a.test, nonsense ,http://localhost:5173/')).toEqual({
      origins: ['https://a.test', 'http://localhost:5173'], dropped: ['nonsense'],
    })
  })
})

describe('secrets and tokens', () => {
  it('hashes are salted and verify only the right secret', () => {
    const h = hashSecret('4321')
    expect(h).not.toBe(hashSecret('4321'))
    expect(verifySecret('4321', h)).toBe(true)
    expect(verifySecret('4322', h)).toBe(false)
    expect(verifySecret('4321', null)).toBe(false)
    expect(verifySecret('4321', 'plaintext')).toBe(false)
  })
  it('normalises phone numbers', () => {
    expect(normalisePhone('+91 98765 43210')).toBe('9876543210')
    expect(normalisePhone('12345')).toBeNull()
  })
})
