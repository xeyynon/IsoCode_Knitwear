// Fix lane D: sign-in (BE-033, BE-034).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, login, LOCK_MINUTES, MAX_FAILED_ATTEMPTS, type Db } from '../src/index.js'
import { AppError } from '../src/errors.js'
import * as authModule from '../src/auth.js'
import * as authService from '../src/authService.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const SECRET = 'x'.repeat(40)
let now = new Date('2026-11-04T04:30:00Z')
let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => {
  await resetAndSeed(pg)
  now = new Date('2026-11-04T04:30:00Z')
  app = buildApp({ db, tokenSecret: SECRET, clock: () => now })
})
afterAll(async () => { await pg.close() })

let ip = 0
const signIn = async (body: object) => {
  // a fresh address every time: this file tests the per-account answer, not the per-address limit
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: body, remoteAddress: `10.1.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}` })
  return { res, json: res.json() as { error?: { code: string; message: string } } }
}

describe('BE-033: a locked account is indistinguishable from an unknown one', () => {
  // the failure memory of unknown keys belongs to the Db object, which these tests share: one new phone per test
  let n = 0
  let UNKNOWN = ''
  beforeEach(() => { UNKNOWN = '90000100' + String(10 + n++) })
  it('BE-033: after the same number of tries a real and an unknown phone give the same status, code and words', async () => {
    const real = []
    const unknown = []
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 2; i++) {
      real.push(await signIn({ phone: CREDS.phone, pin: '9999' }))
      unknown.push(await signIn({ phone: UNKNOWN, pin: '9999' }))
    }
    expect(real.map((r) => r.res.statusCode)).toEqual(unknown.map((r) => r.res.statusCode))
    expect(real.map((r) => r.json)).toEqual(unknown.map((r) => r.json))
    expect(real[MAX_FAILED_ATTEMPTS]!.res.statusCode).toBe(429)   // and the lock still comes after the same number of tries as before
    expect(real[MAX_FAILED_ATTEMPTS - 1]!.res.statusCode).toBe(401)
  })

  it('BE-033: the right PIN of a locked account and the right-shaped PIN of a locked unknown phone answer alike', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) { await signIn({ phone: CREDS.phone, pin: '9999' }); await signIn({ phone: UNKNOWN, pin: '9999' }) }
    const real = await signIn({ phone: CREDS.phone, pin: CREDS.pin })
    const unknown = await signIn({ phone: UNKNOWN, pin: CREDS.pin })
    expect(real.res.statusCode).toBe(429)
    expect(real.res.statusCode).toBe(unknown.res.statusCode)
    expect(real.json).toEqual(unknown.json)
  })

  it('BE-033: an unknown email is locked and answers like a locked merchandiser', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) { await signIn({ email: CREDS.email, password: 'nope' }); await signIn({ email: 'Nobody@Example.test', password: 'nope' }) }
    const real = await signIn({ email: CREDS.email, password: 'nope' })
    const unknown = await signIn({ email: 'nobody@example.test', password: 'nope' })   // spelling in another case is the same key
    expect(real.res.statusCode).toBe(429)
    expect(unknown.res.statusCode).toBe(429)
    expect(unknown.json).toEqual(real.json)
  })

  it('BE-033: a locked answer costs a hash, like every other answer', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await signIn({ phone: CREDS.phone, pin: '9999' })
    const times: number[] = []
    for (let i = 0; i < 3; i++) {
      const t = performance.now()
      expect((await signIn({ phone: CREDS.phone, pin: '9999' })).res.statusCode).toBe(429)
      times.push(performance.now() - t)
    }
    // before the fix a locked account answered in about 2 ms; a hash takes about 40 ms
    expect(Math.min(...times)).toBeGreaterThan(15)
  })

  it('BE-033: an unknown phone gets fresh tries once the lock has run out', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await signIn({ phone: UNKNOWN, pin: '9999' })
    expect((await signIn({ phone: UNKNOWN, pin: '9999' })).res.statusCode).toBe(429)
    now = new Date(now.getTime() + (LOCK_MINUTES + 1) * 60_000)
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) expect((await signIn({ phone: UNKNOWN, pin: '9999' })).res.statusCode).toBe(401)
  })

  it('BE-033: a stopped account answers like an unknown one all the way to the lock', async () => {
    await pg.query(`update account set disabled_at = now() where id = $1`, [ID.sup1])
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).res.statusCode).toBe(401)
    expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).res.statusCode).toBe(429)
  })

  it('BE-033: the table that remembers unknown phones and emails stays small', () => {
    const tracker = authService.createFailureTracker(100)
    for (let i = 0; i < 5_000; i++) tracker.recordFailure(`phone:${i}`, now.getTime())
    expect(tracker.size).toBeLessThanOrEqual(100)
    // the newest keys are the ones remembered
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) tracker.recordFailure('phone:fresh', now.getTime())
    expect(tracker.isLocked('phone:fresh', now.getTime())).toBe(true)
    expect(tracker.isLocked('phone:fresh', now.getTime() + (LOCK_MINUTES + 1) * 60_000)).toBe(false)
  })

  it('BE-033: a real supervisor who is locked is told how long to wait', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await signIn({ phone: CREDS.phone, pin: '9999' })
    const locked = await signIn({ phone: CREDS.phone, pin: CREDS.pin })
    expect(locked.json.error?.code).toBe('locked')
    expect(locked.json.error?.message).toMatch(new RegExp(`${LOCK_MINUTES} minutes`))
  })
})

// A Db with no accounts in it: every sign-in is an unknown account, which pays for one hash.
const emptyDb: Db = { tx: async (_ctx, fn) => fn({ query: async () => [] }) }

/** The longest time the event loop went without running, while `work` ran. */
async function longestStall(work: () => Promise<unknown>): Promise<number> {
  let longest = 0
  let last = performance.now()
  let stop = false
  const ticker = (async () => {
    while (!stop) {
      await new Promise<void>((r) => setImmediate(r))
      const t = performance.now()
      longest = Math.max(longest, t - last)
      last = t
    }
  })()
  last = performance.now()
  await work()
  stop = true
  await ticker
  return longest
}
async function bestStall(work: () => Promise<unknown>): Promise<number> {
  const runs: number[] = []
  for (let i = 0; i < 3; i++) runs.push(await longestStall(work))
  return Math.min(...runs)   // a busy machine can stall one run; blocked code stalls every run
}

describe('BE-034: password and PIN checks do not block the event loop', () => {
  it('BE-034: sign-in does not block the event loop', async () => {
    const stall = await bestStall(() => Promise.all(Array.from({ length: 10 }, (_, i) =>
      login(emptyDb, { phone: `90000000${10 + i}`, pin: '1234' }, SECRET, now).catch(() => undefined))))
    // Measured against this machine's own speed, so a busy runner cannot fail it: one blocking hash costs `one` ms of stall, and
    // the old code stalled for all ten in a row (about ten times `one`). On the thread pool the loop only ever waits briefly.
    const h = authModule.hashSecret('x')
    const t0 = performance.now()
    for (let i = 0; i < 3; i++) authModule.verifySecret('y', h)
    const one = (performance.now() - t0) / 3
    expect(stall).toBeLessThan(one * 2.5)
  })

  it('BE-034: verifySecretAsync agrees with verifySecret, and hashSecretAsync makes hashes verifySecret accepts', async () => {
    const h = authModule.hashSecret('a pass phrase')
    expect(await authModule.verifySecretAsync('a pass phrase', h)).toBe(true)
    expect(await authModule.verifySecretAsync('another', h)).toBe(false)
    expect(await authModule.verifySecretAsync('a pass phrase', null)).toBe(false)
    expect(await authModule.verifySecretAsync('a pass phrase', 'scrypt$1$2')).toBe(false)
    const h2 = await authModule.hashSecretAsync('1234')
    expect(authModule.verifySecret('1234', h2)).toBe(true)
    expect(authModule.verifySecret('1235', h2)).toBe(false)
  })

  it('BE-034: no more than the limit run at once; the queue is bounded and the overflow answers 503', async () => {
    const restore = authModule.setHashLimits({ concurrency: 2, maxQueue: 3 })
    try {
      const h = authModule.hashSecret('x')
      const all = Array.from({ length: 10 }, () => authModule.verifySecretAsync('x', h).then(() => 'ok' as const, (e: unknown) => e))
      expect(authModule.hashLoad()).toEqual({ running: 2, waiting: 3 })
      const out = await Promise.all(all)
      expect(out.filter((o) => o === 'ok')).toHaveLength(5)
      const refused = out.filter((o): o is AppError => o instanceof AppError)
      expect(refused).toHaveLength(5)
      expect(refused[0]!.status).toBe(503)
      expect(authModule.hashLoad()).toEqual({ running: 0, waiting: 0 })
    } finally { restore() }
  })

  it('BE-034: a busy server answers sign-in with 503, not a wrong-PIN count', async () => {
    const restore = authModule.setHashLimits({ concurrency: 1, maxQueue: 0 })
    try {
      const slow = authModule.verifySecretAsync('x', authModule.hashSecret('x'))   // takes the only slot
      const res = await signIn({ phone: CREDS.phone, pin: '9999' })
      expect(res.res.statusCode).toBe(503)
      await slow
    } finally { restore() }
    const [acc] = (await pg.query<{ failed_attempts: number }>(`select failed_attempts from account where id = '${ID.sup1}'`)).rows
    expect(acc!.failed_attempts).toBe(0)
  })

  it('BE-034: the synchronous hashSecret and verifySecret are still exported (adminService uses them)', () => {
    expect(authModule.verifySecret('7391', authModule.hashSecret('7391'))).toBe(true)
  })
})
