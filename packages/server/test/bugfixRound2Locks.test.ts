// Bug round 2: two writes at the same moment on one order / one photo (BE-066, BE-067).
//
// PGlite has ONE connection, so two transactions never overlap there. These tests use the technique of review.test.ts ("racy" Db): a wrapper
// around the transaction lets "the other request" commit at the exact point where the race would bite. It checks the ORDER of the work
// (take the lock before reading; claim the rows before deleting a file). That Postgres really makes the second request wait for the lock
// is what the real-Postgres CI job (TEST_DATABASE_URL, `npm run test:pg`) checks; these tests cannot prove it.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { memoryMediaStore, type Db, type Tx } from '../src/index.js'
import { changeExFactory } from '../src/orderService.js'
import { approvePhoto, purgeRejectedPhotos } from '../src/photoService.js'
import { ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

let pg: PGlite
let real: Db
beforeAll(async () => { pg = await migratedDb(); real = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg) })
afterAll(async () => { await pg.close() })

const staff = { role: 'merchandiser' } as const

describe('BE-066: two ex-factory changes at the same moment chain their history', () => {
  it('BE-066: the second change records the date the first one wrote as its old date', async () => {
    const before = (await pg.query<{ ex_factory: string }>('select ex_factory::text as ex_factory from orders where id = $1', [ID.orderRed])).rows[0]!.ex_factory
    let raced = false
    // "Request B" (to 2026-12-04) commits in between. If request A takes a row lock (for update) or an advisory lock before it reads the order,
    // real Postgres makes B wait for A or A wait for B, so the stand-in lets B finish FIRST and then lets A read. If A reads with no lock,
    // B slips in AFTER A's read and A's "old" value is already stale.
    const racy: Db = {
      tx: (ctx, fn) => real.tx(ctx, (tx) => fn({
        query: async (sql, params) => {
          if (!raced && (/from orders where id = \$1/.test(sql) || /pg_advisory_xact_lock/.test(sql))) {
            raced = true
            const locked = /for update|pg_advisory_xact_lock/i.test(sql)
            const other = () => changeExFactory(tx as Tx, staff, ID.merch, ID.orderRed, '2026-12-04', 'B moved it')
            if (locked) { await other(); return tx.query(sql, params) }
            const seen = await tx.query(sql, params)
            await other()
            return seen as never
          }
          return tx.query(sql, params)
        },
      })),
    }
    await racy.tx(staff, (tx) => changeExFactory(tx, staff, ID.merch, ID.orderRed, '2026-12-11', 'A moved it'))
    expect(raced).toBe(true)
    const log = (await pg.query<{ old: string; new: string; reason: string }>(
      `select old, new, reason from date_change where entity = 'orders' and entity_id = $1 and field = 'ex_factory' order by at, reason`, [ID.orderRed])).rows
    const byReason = (r: string) => log.find((l) => l.reason === r)!
    expect(byReason('B moved it')).toMatchObject({ old: before, new: '2026-12-04' })
    expect(byReason('A moved it')).toMatchObject({ old: '2026-12-04', new: '2026-12-11' })   // not `before`: the history must chain
    expect((await pg.query<{ ex_factory: string }>('select ex_factory::text as ex_factory from orders where id = $1', [ID.orderRed])).rows[0]!.ex_factory).toBe('2026-12-11')
  })
})

describe('BE-067: approving a photo at the moment the clean-up picked it keeps its file', () => {
  const jpegLike = Buffer.alloc(2000, 0x41)
  const plant = async (mem: ReturnType<typeof memoryMediaStore>) => {
    const key = `photos/${crypto.randomUUID()}.jpg`
    await mem.put(key, jpegLike)
    const id = (await pg.query<{ id: string }>(
      `insert into photo (client_uuid, order_id, buyer_id, storage_key, stage, unit_id, taken_on, bytes, rejected_at)
       values ($1, $2, $3, $4, 'sewing', $5, '2026-11-01', 2000, now() - interval '30 days') returning id::text as id`,
      [crypto.randomUUID(), ID.orderRed, ID.buyerB, key, ID.unit1])).rows[0]!.id
    return { id, key }
  }
  const state = async (id: string) => (await pg.query<{ approved_by: string | null; rejected_at: string | null; purged_at: string | null }>(
    'select approved_by::text as approved_by, rejected_at::text as rejected_at, purged_at::text as purged_at from photo where id = $1', [id])).rows[0]!

  it('BE-067: a photo approved just after the clean-up chose it is never left approved without its file', async () => {
    const mem = memoryMediaStore()
    const { id, key } = await plant(mem)
    let raced = false
    // Right after the clean-up's first look at the rejected photos (whatever form that look takes), a merchandiser approves the photo.
    const racy: Db = {
      tx: (ctx, fn) => real.tx(ctx, (tx) => fn({
        query: async (sql: string, params?: unknown[]) => {
          const out = await tx.query(sql, params)
          if (!raced && ctx.role === 'merchandiser' && /rejected_at is not null/.test(sql) && /purged_at is null/.test(sql) && /from photo|update photo/.test(sql)) {
            raced = true
            await approvePhoto(tx as Tx, ctx, ID.merch, id).catch(() => undefined)   // refused once the clean-up has claimed the row; either answer is fine
          }
          return out as never
        },
      })),
    }
    await purgeRejectedPhotos(racy, staff, mem, 7)
    expect(raced).toBe(true)
    const s = await state(id)
    const visibleToBuyer = s.approved_by !== null && s.rejected_at === null
    // The invariant: a photo a buyer could be shown has its file. (Either the approval won and the file is there, or the clean-up won and the photo stays rejected.)
    if (visibleToBuyer) expect(mem.files.has(key)).toBe(true)
    expect(s.purged_at === null).toBe(mem.files.has(key))                        // marked purged exactly when the file is gone
  })

  it('BE-067: a failed delete gives the claim back, so the row can be tried again and nothing is left marked without being deleted', async () => {
    const mem = memoryMediaStore()
    const { id, key } = await plant(mem)
    const broken = { put: mem.put, get: mem.get, delete: async () => { throw new Error('refused') } }
    await expect(purgeRejectedPhotos(real, staff, broken, 7)).rejects.toThrow('refused')
    expect((await state(id)).purged_at).toBeNull()
    expect(mem.files.has(key)).toBe(true)
    expect(await purgeRejectedPhotos(real, staff, mem, 7)).toBe(1)
    expect((await state(id)).purged_at).not.toBeNull()
    expect(mem.files.has(key)).toBe(false)
  })

  it('BE-067: an approved photo is not picked by the clean-up, and approving a claimed (purged) photo is refused', async () => {
    const mem = memoryMediaStore()
    const a = await plant(mem)
    await real.tx(staff, (tx) => approvePhoto(tx, staff, ID.merch, a.id))
    expect(await purgeRejectedPhotos(real, staff, mem, 0)).toBe(0)
    expect(mem.files.has(a.key)).toBe(true)
    const b = await plant(mem)
    expect(await purgeRejectedPhotos(real, staff, mem, 7)).toBe(1)
    await expect(real.tx(staff, (tx) => approvePhoto(tx, staff, ID.merch, b.id))).rejects.toThrow('No such photo')
  })
})
