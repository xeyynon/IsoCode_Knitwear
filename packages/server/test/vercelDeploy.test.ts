import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { demoClock } from '../src/demoClock'
import { dbMediaStore } from '../src/dbMediaStore'
import { MediaConfigError, mediaStoreFromEnv } from '../src/mediaFromEnv'
import { istDate } from '../src/today'
import { vercelOrigins } from '../src/vercel'
import { migratedDb, pgliteDb } from './helpers'

describe('the demo clock for a hosted demo', () => {
  it('is the real clock when DEMO_TODAY is not set', () => {
    expect(demoClock(undefined)).toBeUndefined()
    expect(demoClock('  ')).toBeUndefined()
  })
  it('refuses a date that is not real', () => {
    expect(() => demoClock('2026-13-01')).toThrow(/DEMO_TODAY/)
  })
  it('reads every real day as the demo day in India, with the time of day running as normal', () => {
    for (const real of ['2026-11-08T03:00:00Z', '2026-11-20T15:45:00Z', '2027-01-02T20:00:00Z']) {
      const now = new Date(real)
      const t = demoClock('2026-11-06', () => now)!()
      expect(istDate(t)).toBe('2026-11-06')
      expect((now.getTime() - t.getTime()) % 86_400_000).toBe(0)   // whole days back: minutes and seconds are untouched
    }
  })
  it('so a 15-minute lock still ends: two readings 20 minutes apart are 20 minutes apart', () => {
    let now = new Date('2026-11-12T06:00:00Z')
    const clock = demoClock('2026-11-06', () => now)!
    const a = clock().getTime()
    now = new Date(now.getTime() + 20 * 60_000)
    expect(clock().getTime() - a).toBe(20 * 60_000)
  })
})

describe('photo bytes in Postgres (MEDIA_STORE=db)', () => {
  let pg: PGlite
  beforeAll(async () => { pg = await migratedDb() })
  afterAll(async () => { await pg.close() })

  it('puts, gets, replaces and deletes, and refuses a bad key like every other store', async () => {
    const store = dbMediaStore(pgliteDb(pg))
    await store.put('photos/a.jpg', Buffer.from([1, 2, 3]))
    expect([...(await store.get('photos/a.jpg'))!]).toEqual([1, 2, 3])
    await store.put('photos/a.jpg', Buffer.from([9]))
    expect([...(await store.get('photos/a.jpg'))!]).toEqual([9])
    await store.delete('photos/a.jpg')
    expect(await store.get('photos/a.jpg')).toBeNull()
    await expect(store.put('../x', Buffer.from([1]))).rejects.toThrow(/bad media key/)
  })
  it('no signed-in role can read the table directly: only the store, acting as the system', async () => {
    await dbMediaStore(pgliteDb(pg)).put('photos/b.jpg', Buffer.from([7]))
    for (const ctx of [{ role: 'merchandiser' as const }, { role: 'buyer' as const, buyerId: '00000000-0000-0000-0000-0000000000b1' }]) {
      const rows = await pgliteDb(pg).tx(ctx, (tx) => tx.query('select key from media_object'))
      expect(rows).toEqual([])
    }
  })
  it('is chosen by MEDIA_STORE=db, and needs the database to be passed', () => {
    expect(mediaStoreFromEnv({ MEDIA_STORE: 'db' }, { db: pgliteDb(pg) })).toBeDefined()
    expect(() => mediaStoreFromEnv({ MEDIA_STORE: 'db' })).toThrow(MediaConfigError)
    expect(() => mediaStoreFromEnv({ MEDIA_STORE: 'ftp' })).toThrow(/disk, memory, s3 or db/)
  })
})

describe('the Vercel entry', () => {
  it('allows the deployment\'s own addresses as origins, and nothing else on its own', () => {
    expect(vercelOrigins({ VERCEL_PROJECT_PRODUCTION_URL: 'isocode-knitwear.vercel.app', VERCEL_URL: 'isocode-knitwear-abc.vercel.app' }))
      .toEqual(['https://isocode-knitwear.vercel.app', 'https://isocode-knitwear-abc.vercel.app'])
    expect(vercelOrigins({})).toEqual([])
  })
})

// Found on the live demo: with the whole clock shifted to the demo day, a sign-in token expired two days "ago" by the phone's own
// clock, so the app refused to keep the sign-in. Only the factory's day may move; tokens, locks and links keep real time.
describe('a hosted demo moves only the factory day, never the time tokens are measured in', () => {
  it('the token is valid in real time while the board, the phone and the maths read the demo day', async () => {
    const { buildApp } = await import('../src/app')
    const { seedDemo, DEMO_LOGINS, DEMO_TODAY } = await import('../src/demoSeed')
    const pg = await migratedDb()
    await pgliteDb(pg).tx({ role: 'system' }, (tx) => seedDemo(tx, DEMO_TODAY))
    const realNow = new Date('2026-11-08T06:00:00Z')   // two days after the demo day
    const app = buildApp({ db: pgliteDb(pg), tokenSecret: 'x'.repeat(40), logger: false, clock: () => realNow, dayClock: demoClock(DEMO_TODAY, () => realNow)! })
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_LOGINS.merchandiser })
    const token = login.json().token as string
    const exp = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).exp as number
    expect(exp * 1000).toBeGreaterThan(realNow.getTime())   // still in the future by the phone's real clock
    const board = await app.inject({ method: 'GET', url: '/api/board', headers: { authorization: `Bearer ${token}` } })
    expect(board.json().today).toBe('2026-11-06')
    await app.close(); await pg.close()
  })
})
