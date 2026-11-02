import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { AppError, getBoard, submitEvent, istDate, isIsoDate, type Ctx, type Db } from '../src/index.js'
import { ID, TODAY, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const merch: Ctx = { role: 'merchandiser' }
const sup1: Ctx = { role: 'supervisor', unitId: ID.unit1 }
const sup2: Ctx = { role: 'supervisor', unitId: ID.unit2 }
const buyerB: Ctx = { role: 'buyer', buyerId: ID.buyerB }

let pg: PGlite
let db: Db
// One database per file (booting Postgres in WebAssembly takes about a second);
// the data is wiped and re-seeded before every test.
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg) })
afterAll(async () => { await pg.close() })

const uuid = () => crypto.randomUUID()
const board = (ctx: Ctx = merch) => db.tx(ctx, (tx) => getBoard(tx, ctx, TODAY))
const post = (ctx: Ctx, over: Partial<Parameters<typeof submitEvent>[2]> = {}) =>
  db.tx(ctx, (tx) => submitEvent(tx, ctx, {
    clientUuid: uuid(), orderId: ID.orderRed, stage: 'sewing', date: TODAY, qty: 100, ...over,
  }, TODAY))

describe('the board', () => {
  it('lists every order, worst first, with the maths behind each colour', async () => {
    const rows = await board()
    expect(rows.map((r) => [r.po, r.status])).toEqual([
      ['B-PO-88240', 'red'],
      ['B-PO-88213', 'grey'],   // set up, nothing sent: grey, never green
      ['C-PO-0488', 'green'],
    ])
    expect(rows[0]!.maths).toBe('Need 467/day · making 350/day · 700 pcs short by 11 Nov.')
    expect(rows[0]!.shortBy).toBe(700)
    expect(rows[0]!.worstStage).toBe('sewing')
    expect(rows[0]!.hasWarning).toBe(true)
    expect(rows[2]!.hasWarning).toBe(false)
  })

  it('an order with no stages is grey, not green', async () => {
    await pg.exec(`insert into orders (buyer_id, po, style, colour, qty, ex_factory)
                   values ('${ID.buyerC}', 'C-EMPTY', 's', 'c', 10, '2026-12-01')`)
    const empty = (await board()).find((r) => r.po === 'C-EMPTY')!
    expect(empty.status).toBe('grey')
    expect(empty.reasons).toEqual(['no stages set up'])
  })

  it('respects a closed day in the unit calendar', async () => {
    await pg.exec(`insert into calendar_day (unit_id, date, working, note) values ('${ID.unit1}', '2026-11-09', false, 'Deepavali')`)
    const red = (await board()).find((r) => r.po === 'B-PO-88240')!
    expect(red.maths).toContain('Need 560/day') // 2800 left over 5 working days
  })

  it('reads thresholds from the settings table', async () => {
    // Making 350 against 467 needed (75%) is red at the default 90% line; with the line at 70% it is amber.
    await pg.exec(`update settings set value = '0.7' where key = 'red_below'`)
    expect((await board()).find((r) => r.po === 'B-PO-88240')!.status).toBe('amber')
  })

  it('is for merchandisers only: buyers and supervisors are refused', async () => {
    for (const ctx of [buyerB, sup1]) {
      await expect(board(ctx)).rejects.toMatchObject({ status: 403 })
    }
  })
})

describe('submitting a daily update', () => {
  it('moves the board: a big day turns a red order green', async () => {
    expect((await board())[0]!.po).toBe('B-PO-88240')
    await post(sup1, { qty: 2000 }) // 2000 today: 800 left, average now 680/day, needs 133
    const row = (await board()).find((r) => r.po === 'B-PO-88240')!
    expect(row.status).toBe('green')
  })

  it('counts a retried send once', async () => {
    const clientUuid = uuid()
    expect(await post(sup1, { clientUuid, qty: 100 })).toEqual({ duplicate: false })
    expect(await post(sup1, { clientUuid, qty: 100 })).toEqual({ duplicate: true })
    const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from update_event where client_uuid = $1`, [clientUuid])
    expect(rows[0]?.n).toBe(1)
  })

  it("will not let a supervisor post to another unit's stage", async () => {
    await expect(post(sup2)).rejects.toMatchObject({ status: 404 })
    const { rows } = await pg.query(`select 1 from update_event where date = $1`, [TODAY])
    expect(rows).toHaveLength(0)
  })

  it('will not let a buyer post at all', async () => {
    await expect(post(buyerB)).rejects.toMatchObject({ status: 403 })
  })

  it.each([
    ['a negative quantity', { qty: -1 }],
    ['a fractional quantity', { qty: 1.5 }],
    ['an absurd quantity', { qty: 10_000_000 }],
    ['a non-uuid client id', { clientUuid: 'abc' }],
    ['a non-uuid order id', { orderId: 'abc' }],
    ['a blank stage', { stage: '  ' }],
    ['a malformed date', { date: '04/11/2026' }],
    ['an impossible date', { date: '2026-02-30' }],
    ['a date in the future', { date: '2026-11-05' }],
  ])('rejects %s', async (_label, over) => {
    await expect(post(sup1, over)).rejects.toBeInstanceOf(AppError)
    await expect(post(sup1, over)).rejects.toMatchObject({ status: 400 })
  })

  it('a stage that does not exist is a 404, not a database error', async () => {
    await expect(post(sup1, { stage: 'embroidery' })).rejects.toMatchObject({ status: 404 })
  })
})

describe('row-level security through the service layer', () => {
  it('a buyer context sees nothing of the events the colours come from', async () => {
    const seen = await db.tx(buyerB, (tx) => tx.query('select 1 from update_event'))
    expect(seen).toHaveLength(0)
  })
  it('fails closed with no identity', async () => {
    await expect(db.tx({ role: 'buyer' } as Ctx, async () => 1)).rejects.toThrow(/buyerId/)
  })
})

describe('today', () => {
  it('uses the factory calendar date (India), not the server zone', () => {
    // 20:30 UTC on 3 Nov is already 02:00 on 4 Nov in India.
    expect(istDate(new Date('2026-11-03T20:30:00Z'))).toBe('2026-11-04')
    expect(istDate(new Date('2026-11-03T18:00:00Z'))).toBe('2026-11-03')
  })
  it('validates real calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-2-3')).toBe(false)
  })
})
