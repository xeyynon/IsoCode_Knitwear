// Every list a person sees has a TOTAL order: when two rows tie on what the list sorts by, a last key (an id) decides,
// so the same data always comes back in the same order. Without it Postgres may return tied rows in any order (it
// depends on the plan and on what vacuum did), and a screen, a CSV export or a test would change from one run to the next.
//
// Each test inserts the tied rows so that the order they are stored in is the OPPOSITE of the order they must come
// back in. A query with no tie-breaker then returns them in the stored order and the assertion fails.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { buildApp, type Db } from '../src/index.js'
import { getBuyerViewFor } from '../src/buyerService.js'
import { getMyStages } from '../src/myService.js'
import { loadEngineData } from '../src/engineData.js'
import { changeExFactory } from '../src/orderService.js'
import { listUnits } from '../src/adminService.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const NOW = new Date('2026-11-04T04:30:00Z')
let pg: PGlite
let db: Db
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg) })
afterAll(async () => { await pg.close() })

const staff = { role: 'merchandiser' } as const
const uid = (hi: string, n: number) => `${hi}-0000-0000-0000-${String(n).padStart(12, '0')}`
const LATE = (n: number) => uid('ffffffff', n)    // sorts after
const EARLY = (n: number) => uid('00000001', n)   // sorts before

describe('a buyer\'s file', () => {
  const BUYER = uid('00000000', 77)
  beforeEach(async () => {
    await pg.query(`insert into buyer (id, name) values ($1, 'Buyer T')`, [BUYER])
  })
  const order = (id: string, po: string, colour: string, exFactory = '2026-12-01') =>
    pg.query(`insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ($1, $2, $3, 'tee', $4, 10, $5)`, [id, BUYER, po, colour, exFactory])
  const stage = (orderId: string, stage: string, seq: number) =>
    pg.query(`insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty) values ($1, $2, $3, $4, '2026-11-30', $5, 10)`, [orderId, BUYER, stage, ID.unit1, seq])
  const read = () => db.tx(staff, (tx) => getBuyerViewFor(tx, staff, BUYER))

  it('orders with the same ex-factory date and PO come back by style and colour, whatever order they were entered in', async () => {
    await order(LATE(1), 'T-1', 'zeta')
    await order(EARLY(2), 'T-1', 'alpha')
    await order(LATE(3), 'T-0', 'omega')
    expect((await read()).orders.map((o) => `${o.po}/${o.colour}`)).toEqual(['T-0/omega', 'T-1/alpha', 'T-1/zeta'])
  })

  it('stages with the same sequence come back by stage name, then id, and always grouped by order', async () => {
    await order(LATE(1), 'T-1', 'a')
    await order(EARLY(2), 'T-2', 'a')
    await stage(LATE(1), 'sewing', 1); await stage(EARLY(2), 'sewing', 1); await stage(LATE(1), 'cutting', 1); await stage(EARLY(2), 'cutting', 2)
    const first = await read()
    expect(first.orders.map((o) => o.milestones.map((m) => m.stage))).toEqual([['cutting', 'sewing'], ['sewing', 'cutting']])   // T-1: equal sequence, by name. T-2: cutting is sequence 2
    expect(JSON.stringify(await read())).toBe(JSON.stringify(first))
  })

  it('photos and warnings with the same time come back by id', async () => {
    await order(EARLY(1), 'T-1', 'a')
    await stage(EARLY(1), 'sewing', 1)
    for (const id of [LATE(5), EARLY(5), uid('80000000', 5)]) {
      await pg.query(`insert into photo (id, order_id, buyer_id, storage_key, approved_by, taken_on, created_at) values ($1, $2, $3, $4, $5, '2026-11-03', '2026-11-03T05:00:00Z')`, [id, EARLY(1), BUYER, `k-${id}`, ID.merch])
    }
    expect((await read()).orders[0]!.photos.map((p) => p.id)).toEqual([EARLY(5), uid('80000000', 5), LATE(5)])
    for (const [stageName, id] of [['pack', LATE(6)], ['pack', EARLY(6)]] as const) {
      await pg.query(`insert into warning (id, order_id, buyer_id, stage, status, maths, buyer_text, confirmed_by, confirmed_at) values ($1, $2, $3, $4, 'red', '{}', $5, $6, '2026-11-03T05:00:00Z')`,
        [id, EARLY(1), BUYER, `${stageName}-${id.slice(0, 2)}`, `text-${id.slice(0, 2)}`, ID.merch])
    }
    expect((await read()).orders[0]!.warnings.map((w) => w.text)).toEqual(['text-00', 'text-ff'])
  })
})

describe('the supervisor\'s list', () => {
  it('stages due the same day on the same PO come back by order, then stage, then id', async () => {
    // Two buyers, the same PO number, the same due date and sequence: only the ids can order them.
    await pg.query(`insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ($1, $2, 'SAME-PO', 'tee', 'a', 10, '2026-12-01'), ($3, $4, 'SAME-PO', 'tee', 'a', 10, '2026-12-01')`,
      [LATE(1), ID.buyerB, EARLY(2), ID.buyerC])
    for (const [o, b] of [[LATE(1), ID.buyerB], [EARLY(2), ID.buyerC]] as const) {
      await pg.query(`insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty) values ($1, $2, 'sewing', $3, '2026-11-02', 1, 10), ($1, $2, 'cutting', $3, '2026-11-02', 1, 10)`, [o, b, ID.unit1])
    }
    const ctx = { role: 'supervisor', unitId: ID.unit1 } as const
    const rows = (await db.tx(ctx, (tx) => getMyStages(tx, ctx, '2026-11-04'))).filter((r) => r.po === 'SAME-PO')
    expect(rows.map((r) => [r.orderId, r.stage])).toEqual([[EARLY(2), 'cutting'], [EARLY(2), 'sewing'], [LATE(1), 'cutting'], [LATE(1), 'sewing']])
  })
})

describe('what the engine is fed', () => {
  it('orders and the stages of one order come back in a fixed order', async () => {
    await pg.query(`insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ($1, $2, 'SAME-PO', 'tee', 'a', 10, '2026-12-01'), ($3, $4, 'SAME-PO', 'tee', 'a', 10, '2026-12-01')`,
      [LATE(1), ID.buyerB, EARLY(2), ID.buyerC])
    for (const s of ['sewing', 'packing', 'cutting']) {
      await pg.query(`insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty) values ($1, $2, $3, $4, '2026-11-30', 1, 10)`, [LATE(1), ID.buyerB, s, ID.unit1])
    }
    const data = await db.tx(staff, (tx) => loadEngineData(tx))
    const same = data.orders.filter((o) => o.po === 'SAME-PO').map((o) => o.id)
    expect(same).toEqual([EARLY(2), LATE(1)])
    expect(data.stagesBy.get(LATE(1))!.map((s) => s.stage)).toEqual(['cutting', 'packing', 'sewing'])
  })
})

describe('the board', () => {
  it('orders that tie on colour, ex-factory date and PO come back by id', async () => {
    await pg.query(`insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ($1, $2, 'SAME-PO', 'tee', 'a', 10, '2026-12-01'), ($3, $4, 'SAME-PO', 'tee', 'a', 10, '2026-12-01')`,
      [LATE(1), ID.buyerB, EARLY(2), ID.buyerC])
    const app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW })
    const token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token
    const res = await app.inject({ url: '/api/board', headers: { authorization: `Bearer ${token}` } })
    expect(res.json().rows.filter((o: { po: string }) => o.po === 'SAME-PO').map((o: { orderId: string }) => o.orderId)).toEqual([EARLY(2), LATE(1)])
  })
})

describe('moving the ex-factory date', () => {
  it('stages with the same sequence are re-dated, and reported, in a fixed order', async () => {
    const id = LATE(1)
    await pg.query(`insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ($1, $2, 'MOVE-PO', 'tee', 'a', 10, '2026-12-01')`, [id, ID.buyerB])
    for (const [s, before] of [['sewing', 6], ['cutting', 12]] as const) {
      await pg.query(`insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty, working_days_before) values ($1, $2, $3, $4, '2026-11-01', 1, 10, $5)`, [id, ID.buyerB, s, ID.unit1, before])
    }
    const moved = await db.tx(staff, (tx) => changeExFactory(tx, staff, ID.merch, id, '2026-12-10', 'buyer asked'))
    expect(moved.milestones.map((m) => m.stage)).toEqual(['cutting', 'sewing'])
  })
})

describe('lists in the admin screens', () => {
  it('units and buyers with the same name come back by id', async () => {
    // Unit names are unique ignoring case (014), so units tie only on a column the index ignores: they cannot tie. Buyers can.
    await pg.query(`insert into buyer (id, name) values ($1, 'Same Name'), ($2, 'Same Name')`, [LATE(1), EARLY(2)])
    const app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW })
    const token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token
    const res = await app.inject({ url: '/api/orders/options', headers: { authorization: `Bearer ${token}` } })
    expect(res.json().buyers.filter((b: { name: string }) => b.name === 'Same Name').map((b: { id: string }) => b.id)).toEqual([EARLY(2), LATE(1)])
    expect((await db.tx(staff, (tx) => listUnits(tx, staff))).map((u) => u.name)).toEqual(['Unit 1', 'Unit 2'])
  })
})
