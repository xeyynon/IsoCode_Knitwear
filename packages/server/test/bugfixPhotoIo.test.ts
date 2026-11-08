// OPT-LANE C: no database transaction is held while the photo store works (BE-046, audit O-7).
// Fault injection: the store throws, the delete throws, the insert fails, the commit's answer is lost, duplicates race.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, memoryMediaStore, type Db } from '../src/index.js'
import type { MediaStore } from '../src/mediaStore.js'
import { PURGE_BATCH, savePhoto } from '../src/photoService.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const NOW = new Date('2026-11-04T04:30:00Z')
const SECRET = 'x'.repeat(40)
const jpeg = (size = 2000): Buffer => { const b = Buffer.alloc(size, 0x41); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; b[size - 2] = 0xff; b[size - 1] = 0xd9; return b }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let pg: PGlite
let real: Db
beforeAll(async () => { pg = await migratedDb(); real = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg) })
afterAll(async () => { await pg.close() })

/** A Db that counts the transactions open right now and keeps the highest count seen. */
function countingDb(inner: Db) {
  const s = { open: 0, max: 0, started: 0, hook: null as null | ((sql: string) => void | Promise<void>), afterCommit: null as null | (() => void), rollbackAfter: false }
  const db: Db = {
    async tx(ctx, fn) {
      s.open++; s.started++; s.max = Math.max(s.max, s.open)
      try {
        const out = await inner.tx(ctx, async (tx) => {
          const res = await fn({ query: async (sql, params) => { await s.hook?.(sql); return tx.query(sql, params) } })
          if (s.rollbackAfter) throw new Error('commit failed before it happened')
          return res
        })
        s.afterCommit?.()
        return out
      } finally { s.open-- }
    },
  }
  return { db, s }
}

/** A store that is slow and notes how many transactions were open at the moment it was asked, and while it waited. */
function slowStore(inner: MediaStore, s: { open: number }, ms = 40) {
  const seen: { op: string; openAtCall: number; openWhileWaiting: number }[] = []
  const wrap = <A extends unknown[], R>(op: string, f: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    const e = { op, openAtCall: s.open, openWhileWaiting: -1 }
    seen.push(e)
    await sleep(ms)
    e.openWhileWaiting = s.open
    return f(...a)
  }
  const store: MediaStore = { put: wrap('put', inner.put.bind(inner)), get: wrap('get', inner.get.bind(inner)), delete: wrap('delete', inner.delete.bind(inner)) }
  return { store, seen }
}

const asSup = { role: 'supervisor' as const, unitId: ID.unit1 }
const input = (over: object = {}) => ({ clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', bytes: jpeg(), ...over })
const rows = async () => (await pg.query<{ id: string; storage_key: string; purged_at: string | null }>('select id::text as id, storage_key, purged_at::text as purged_at from photo order by created_at, id')).rows

const token = async (app: FastifyInstance, b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const upload = (app: FastifyInstance, h: Record<string, string>, over: { clientUuid?: string } = {}) => app.inject({
  method: 'POST', url: '/api/photos',
  headers: { ...h, 'content-type': 'image/jpeg', 'x-client-uuid': over.clientUuid ?? crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': 'sewing', 'x-date': '2026-11-04' },
  payload: jpeg(),
})

describe('BE-046: nothing holds a database transaction while the photo store works', () => {
  it('BE-046: upload, staff read, supervisor read, buyer read and clean-up: zero open transactions at every store call', async () => {
    const { db, s } = countingDb(real)
    const mem = memoryMediaStore()
    const slow = slowStore(mem, s)
    const app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, media: slow.store })
    const merch = await token(app, { email: CREDS.email, password: CREDS.password })
    const sup = await token(app, { phone: CREDS.phone, pin: CREDS.pin })

    const up = await upload(app, sup)
    expect(up.statusCode).toBe(200)
    const id = up.json().id as string
    expect((await app.inject({ url: `/api/photos/${id}/file`, headers: merch })).statusCode).toBe(200)
    expect((await app.inject({ url: `/api/photos/${id}/file`, headers: sup })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: `/api/photos/${id}/approve`, headers: merch })).statusCode).toBe(200)
    const link = (await app.inject({ method: 'POST', url: '/api/buyer-links', headers: merch, payload: { buyerId: ID.buyerB } })).json().token as string
    const buyerRes = await app.inject({ url: `/api/buyer/photos/${id}`, headers: { authorization: `Bearer ${link}` } })
    expect(buyerRes.statusCode).toBe(200)
    expect(buyerRes.rawPayload.equals(jpeg())).toBe(true)
    expect((await app.inject({ method: 'POST', url: `/api/photos/${id}/reject`, headers: merch })).statusCode).toBe(200)
    await pg.query(`update photo set rejected_at = now() - interval '9 days'`)
    expect((await app.inject({ method: 'POST', url: '/api/photos/purge', headers: merch, payload: { days: 7 } })).json()).toEqual({ purged: 1 })

    expect(slow.seen.map((e) => e.op)).toEqual(['put', 'get', 'get', 'get', 'delete'])
    for (const e of slow.seen) { expect(e.openAtCall).toBe(0); expect(e.openWhileWaiting).toBe(0) }
  })

  it('BE-046: with the store stuck, the API still answers: twenty stuck uploads hold no connection', async () => {
    const { db, s } = countingDb(real)
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const mem = memoryMediaStore()
    const stuck: MediaStore = { put: async (k, b) => { await gate; return mem.put(k, b) }, get: (k) => mem.get(k), delete: (k) => mem.delete(k) }
    const app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, media: stuck })
    const sup = await token(app, { phone: CREDS.phone, pin: CREDS.pin })
    const ups = Array.from({ length: 20 }, () => upload(app, sup))
    await sleep(150)   // every upload has finished its first transaction and is waiting for the store
    expect(s.open).toBe(0)
    const t0 = Date.now()
    expect((await app.inject({ url: '/api/me', headers: sup })).statusCode).toBe(200)
    expect(Date.now() - t0).toBeLessThan(1000)
    release()
    const res = await Promise.all(ups)
    expect(res.map((r) => r.statusCode)).toEqual(Array(20).fill(200))
    expect(await rows()).toHaveLength(20)
    expect(mem.files.size).toBe(20)
  })

  it('BE-046: before the change a transaction was open at the store call (the test can tell)', async () => {
    // The old order of work, reduced to its shape: the store is called from inside the transaction.
    const { db, s } = countingDb(real)
    const slow = slowStore(memoryMediaStore(), s, 5)
    await db.tx(asSup, async () => { await slow.store.put('photos/x.jpg', jpeg()) })
    expect(slow.seen[0]!.openAtCall).toBe(1)
  })
})

describe('BE-046: upload faults leave no row without a file, and a retry stores exactly one photo', () => {
  it('BE-046: the store refuses the file: 500, no row, no file; a retry with the same upload id then works and makes one row', async () => {
    const mem = memoryMediaStore()
    let fail = true
    const flaky: MediaStore = { put: async (k, b) => { if (fail) throw new Error('bucket unreachable'); return mem.put(k, b) }, get: (k) => mem.get(k), delete: (k) => mem.delete(k) }
    const app = buildApp({ db: real, tokenSecret: SECRET, clock: () => NOW, media: flaky })
    const sup = await token(app, { phone: CREDS.phone, pin: CREDS.pin })
    const clientUuid = crypto.randomUUID()
    const first = await upload(app, sup, { clientUuid })
    expect(first.statusCode).toBe(500)
    expect(JSON.stringify(first.json())).not.toContain('bucket')
    expect(await rows()).toHaveLength(0)
    expect(mem.files.size).toBe(0)
    fail = false
    const retry = await upload(app, sup, { clientUuid })
    expect(retry.statusCode).toBe(200)
    expect(retry.json().duplicate).toBe(false)
    const again = await upload(app, sup, { clientUuid })
    expect(again.json()).toEqual({ id: retry.json().id, duplicate: true })
    expect(await rows()).toHaveLength(1)
    expect(mem.files.size).toBe(1)
  })

  it('BE-046: the file is stored but the insert fails: the file is taken back, no row is left', async () => {
    const { db, s } = countingDb(real)
    const mem = memoryMediaStore()
    s.hook = (sql) => { if (/insert into photo/.test(sql)) throw new Error('database went away') }
    const app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, media: mem })
    const sup = await token(app, { phone: CREDS.phone, pin: CREDS.pin })
    expect((await upload(app, sup)).statusCode).toBe(500)
    expect(await rows()).toHaveLength(0)
    expect(mem.files.size).toBe(0)
  })

  it('BE-046: the insert fails AND taking the file back fails: the caller still gets the real error and the failure is reported, not thrown', async () => {
    const { db, s } = countingDb(real)
    const mem = memoryMediaStore()
    s.hook = (sql) => { if (/insert into photo/.test(sql)) throw new Error('database went away') }
    const stubborn: MediaStore = { put: (k, b) => mem.put(k, b), get: (k) => mem.get(k), delete: async () => { throw new Error('delete refused') } }
    const orphans: string[] = []
    const sup = await real.tx({ role: 'system' }, async () => asSup)
    await expect(savePhoto(db, sup, stubborn, input(), '2026-11-04', (key) => orphans.push(key))).rejects.toThrow('database went away')
    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatch(/^photos\/[0-9a-f-]{36}\.jpg$/)
    expect(await rows()).toHaveLength(0)
    expect(mem.files.size).toBe(1)   // the orphan: under a random key nobody can ask for
  })

  it('BE-046: the commit was lost AFTER it happened: the row exists, so the file is kept and readable', async () => {
    const { db, s } = countingDb(real)
    const mem = memoryMediaStore()
    // The insert transaction commits, then the caller is told it failed (a dropped connection). Only that transaction (the second one) does this.
    s.afterCommit = () => { if (s.started === 2) throw new Error('connection lost after commit') }
    await expect(savePhoto(db, asSup, mem, input(), '2026-11-04')).rejects.toThrow('connection lost')
    const r = await rows()
    expect(r).toHaveLength(1)
    expect(mem.files.has(r[0]!.storage_key)).toBe(true)
  })

  it('BE-046: the commit failed BEFORE it happened (rolled back): the row is absent, so the file is taken back', async () => {
    const { db, s } = countingDb(real)
    const mem = memoryMediaStore()
    const sup = asSup
    // first transaction (the stage lookup) runs normally; the second rolls back after the insert
    let n = 0
    const swap: Db = { tx: (ctx, fn) => { n++; s.rollbackAfter = n === 2; return db.tx(ctx, fn) } }
    await expect(savePhoto(swap, sup, mem, input(), '2026-11-04')).rejects.toThrow('commit failed before it happened')
    expect(await rows()).toHaveLength(0)
    expect(mem.files.size).toBe(0)
  })

  it('BE-046: five identical uploads at once make one row and leave one file (the losers take their copies back)', async () => {
    const mem = memoryMediaStore()
    const app = buildApp({ db: real, tokenSecret: SECRET, clock: () => NOW, media: slowStore(mem, { open: 0 }, 20).store })
    const sup = await token(app, { phone: CREDS.phone, pin: CREDS.pin })
    const clientUuid = crypto.randomUUID()
    const res = await Promise.all(Array.from({ length: 5 }, () => upload(app, sup, { clientUuid })))
    expect(res.map((r) => r.statusCode)).toEqual(Array(5).fill(200))
    const bodies = res.map((r) => r.json() as { id: string; duplicate: boolean })
    expect(new Set(bodies.map((b) => b.id)).size).toBe(1)
    expect(bodies.filter((b) => !b.duplicate)).toHaveLength(1)
    const r = await rows()
    expect(r).toHaveLength(1)
    expect([...mem.files.keys()]).toEqual([r[0]!.storage_key])
  })

  it('BE-046: an upload id already used for another order is still a 409, and the extra file is taken back', async () => {
    const mem = memoryMediaStore()
    const first = input()
    await savePhoto(real, { role: 'system' }, mem, first, '2026-11-04')
    await expect(savePhoto(real, { role: 'system' }, mem, { ...first, orderId: ID.orderNew }, '2026-11-04')).rejects.toMatchObject({ status: 409, code: 'conflict' })
    expect(mem.files.size).toBe(1)
  })

  it('BE-046: a repeat of a stored upload answers from the database and does not touch the store at all', async () => {
    const { db, s } = countingDb(real)
    const slow = slowStore(memoryMediaStore(), s, 1)
    const one = input()
    await savePhoto(db, asSup, slow.store, one, '2026-11-04')
    const before = slow.seen.length
    expect(await savePhoto(db, asSup, slow.store, one, '2026-11-04')).toMatchObject({ duplicate: true })
    expect(slow.seen.length).toBe(before)
  })
})

describe('BE-046: clean-up deletes files with no transaction open, in batches, and marks only what was deleted', () => {
  const plant = async (n: number, mem: ReturnType<typeof memoryMediaStore>) => {
    for (let i = 0; i < n; i++) {
      const key = `photos/${crypto.randomUUID()}.jpg`
      await mem.put(key, jpeg())
      await pg.query(
        `insert into photo (client_uuid, order_id, buyer_id, storage_key, stage, unit_id, taken_on, bytes, rejected_at)
         values ($1, $2, $3, $4, 'sewing', $5, '2026-11-01', 2000, now() - interval '30 days' + ($6 || ' seconds')::interval)`,
        [crypto.randomUUID(), ID.orderRed, ID.buyerB, key, ID.unit1, String(i)])
    }
  }
  it('BE-046: a delete that fails leaves its row unmarked, the others are marked, the error is thrown, and the next run finishes', async () => {
    const mem = memoryMediaStore()
    await plant(5, mem)
    const keys = (await rows()).map((r) => r.storage_key)
    let bad: string | null = keys[2]!
    const store: MediaStore = { put: (k, b) => mem.put(k, b), get: (k) => mem.get(k), delete: async (k) => { if (k === bad) throw new Error('refused'); return mem.delete(k) } }
    await expect((async () => { const { purgeRejectedPhotos } = await import('../src/photoService.js'); return purgeRejectedPhotos(real, { role: 'merchandiser' }, store, 7) })()).rejects.toThrow('refused')
    const after = await rows()
    expect(after.filter((r) => r.purged_at).map((r) => r.storage_key).sort()).toEqual(keys.filter((k) => k !== bad).sort())
    expect(mem.files.has(bad)).toBe(true)
    bad = null
    const { purgeRejectedPhotos } = await import('../src/photoService.js')
    expect(await purgeRejectedPhotos(real, { role: 'merchandiser' }, store, 7)).toBe(1)
    expect((await rows()).every((r) => r.purged_at)).toBe(true)
    expect(mem.files.size).toBe(0)
    expect(await purgeRejectedPhotos(real, { role: 'merchandiser' }, store, 7)).toBe(0)
  })

  it('BE-046: more than one batch: every file goes, no transaction is open at any delete, and one stuck file does not loop for ever', async () => {
    const { db, s } = countingDb(real)
    const mem = memoryMediaStore()
    const n = PURGE_BATCH * 2 + 17
    await plant(n, mem)
    const slow = slowStore(mem, s, 0)
    const { purgeRejectedPhotos } = await import('../src/photoService.js')
    expect(await purgeRejectedPhotos(db, { role: 'merchandiser' }, slow.store, 7)).toBe(n)
    expect(slow.seen).toHaveLength(n)
    expect(slow.seen.every((e) => e.openAtCall === 0)).toBe(true)
    expect(mem.files.size).toBe(0)
    expect(s.started).toBe(3)   // three rounds: one claiming update each (BE-067 merged the old select and update; a second transaction runs only to give back a failed delete)

    // a file that can never be deleted: tried once per run, the rest still go
    await plant(PURGE_BATCH + 3, mem)
    const first = (await rows()).filter((r) => !r.purged_at)[0]!.storage_key
    let calls = 0
    const stuck: MediaStore = { put: (k, b) => mem.put(k, b), get: (k) => mem.get(k), delete: async (k) => { calls++; if (k === first) throw new Error('stuck'); return mem.delete(k) } }
    await expect(purgeRejectedPhotos(real, { role: 'merchandiser' }, stuck, 7)).rejects.toThrow('stuck')
    expect(calls).toBe(PURGE_BATCH + 3)
    expect((await rows()).filter((r) => !r.purged_at)).toHaveLength(1)
  })
})

describe('BE-046: a photo that is gone from the store is "not found", and the lookup alone decides who may read', () => {
  it('BE-046: the row exists but the file is missing: 404; another unit and an unknown id: 404; nothing is fetched for them', async () => {
    const { db, s } = countingDb(real)
    const mem = memoryMediaStore()
    const slow = slowStore(mem, s, 0)
    const app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, media: slow.store })
    const sup = await token(app, { phone: CREDS.phone, pin: CREDS.pin })
    const id = (await upload(app, sup)).json().id as string
    mem.files.clear()
    expect((await app.inject({ url: `/api/photos/${id}/file`, headers: sup })).statusCode).toBe(404)
    const before = slow.seen.length
    expect((await app.inject({ url: `/api/photos/${crypto.randomUUID()}/file`, headers: sup })).statusCode).toBe(404)
    expect((await app.inject({ url: '/api/photos/not-an-id/file', headers: sup })).statusCode).toBe(404)
    expect(slow.seen.length).toBe(before)
  })
})
