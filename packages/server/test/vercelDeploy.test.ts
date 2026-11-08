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
