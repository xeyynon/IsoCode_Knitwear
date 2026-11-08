// OPT-A: O-17 (istDate), O-9 (buyer view assembly), O-10 (the engine data load). Each test compares the new code with the old.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { getBuyerViewFor, type BuyerView } from '../src/buyerService.js'
import type { Ctx, Db, Tx } from '../src/db.js'
import { istDate } from '../src/today.js'
import { migratedDb, pgliteDb } from './helpers.js'
import fs from 'node:fs'
import { loadEngineData } from '../src/engineData.js'
import { GEN_TODAY, seedBuyerExtras, seedGenerated, snapshot } from './optData.js'
import { rng } from '../../engine/test/optData.js'

const MERCH: Ctx = { role: 'merchandiser' }

describe('O-17: istDate with one shared formatter', () => {
  const fresh = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
  it('gives the date a new formatter gives, over 20,000 instants across 2000 to 2100', () => {
    let seed = 99
    const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
    for (let i = 0; i < 20_000; i++) {
      const d = new Date(Date.UTC(2000, 0, 1) + Math.floor(next() * 101 * 365.25 * 86_400_000))
      expect(istDate(d)).toBe(fresh(d))
    }
  })
  it('turns over at 18:30 UTC, which is midnight in India', () => {
    expect(istDate(new Date('2026-11-04T18:29:59Z'))).toBe('2026-11-04')
    expect(istDate(new Date('2026-11-04T18:30:00Z'))).toBe('2026-11-05')
    expect(istDate(new Date('2026-11-04T19:00:00Z'))).toBe('2026-11-05')
    expect(istDate(new Date('2026-12-31T18:30:00Z'))).toBe('2027-01-01')
  })
  it('with no argument gives today in India', () => { expect(istDate()).toBe(fresh(new Date())) })
})

/** The buyer-view assembly as it was before O-9: for each order, filter the whole milestone, photo and warning lists. */
async function oldBuyerView(tx: Tx, buyerId: string): Promise<BuyerView> {
  const buyer = (await tx.query<{ name: string }>('select name from buyer where id = $1', [buyerId]))[0]!
  const orders = await tx.query<{ id: string; po: string; style: string; colour: string; qty: number; ex_factory: string }>(
    'select id::text as id, po, style, colour, qty, ex_factory::text as ex_factory from orders where buyer_id = $1 order by ex_factory, po, style, colour, id', [buyerId])
  const ms = await tx.query<{ order_id: string; stage: string; planned_end: string }>(
    'select order_id::text as order_id, stage, planned_end::text as planned_end from milestone where buyer_id = $1 order by order_id, sequence, stage, id', [buyerId])
  const photos = await tx.query<{ order_id: string; id: string; stage: string; taken_on: string }>(
    `select order_id::text as order_id, id::text as id, stage, taken_on::text as taken_on from photo
      where buyer_id = $1 and approved_by is not null and rejected_at is null and purged_at is null order by taken_on, created_at, id`, [buyerId])
  const warns = await tx.query<{ order_id: string; stage: string; status: 'amber' | 'red'; buyer_text: string; since: string }>(
    `select order_id::text as order_id, stage, status, buyer_text,
            to_char(confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as since
       from warning where buyer_id = $1 and confirmed_by is not null and dismissed_at is null and resolved_at is null order by confirmed_at, id`, [buyerId])
  return {
    buyer: { name: buyer.name },
    orders: orders.map((o) => ({
      po: o.po, style: o.style, colour: o.colour, qty: o.qty, exFactory: o.ex_factory,
      milestones: ms.filter((m) => m.order_id === o.id).map((m) => ({ stage: m.stage, plannedEnd: m.planned_end })),
      photos: photos.filter((p) => p.order_id === o.id).map((p) => ({ id: p.id, stage: p.stage, takenOn: p.taken_on })),
      warnings: warns.filter((w) => w.order_id === o.id).map((w) => ({
        stage: w.stage, severity: w.status === 'red' ? 'late_risk' as const : 'attention' as const, text: w.buyer_text, since: w.since,
      })),
    })),
  }
}

describe('OPT-A on a generated dataset', () => {
  let pg: PGlite
  let db: Db
  beforeAll(async () => {
    pg = await migratedDb(); db = pgliteDb(pg)
    await seedGenerated(pg, 300)
    await seedBuyerExtras(pg)
  }, 120_000)
  afterAll(async () => { await pg.close() })

  it('O-9: the buyer view equals the old nested-filter assembly for all 8 buyers (and has photos, warnings and milestones to compare)', async () => {
    const buyers = await pg.query<{ id: string }>('select id::text as id from buyer order by id')
    let withPhotos = 0, withWarnings = 0, withMilestones = 0
    for (const b of buyers.rows) {
      const want = await db.tx(MERCH, (tx) => oldBuyerView(tx, b.id))
      const got = await db.tx(MERCH, (tx) => getBuyerViewFor(tx, MERCH, b.id))
      expect(got).toEqual(want)
      expect(JSON.stringify(got)).toBe(JSON.stringify(want))     // same key order and same array order, byte for byte
      for (const o of got.orders) { withPhotos += o.photos.length ? 1 : 0; withWarnings += o.warnings.length ? 1 : 0; withMilestones += o.milestones.length ? 1 : 0 }
    }
    expect(withPhotos).toBeGreaterThan(50)
    expect(withWarnings).toBeGreaterThan(50)
    expect(withMilestones).toBeGreaterThan(200)
  })

  // ---- O-10: the events query has no ORDER BY, and sizes are read only for a single order --------------------------------
  const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/optBoardGolden.json', import.meta.url), 'utf8')).generated

  /** A Tx that hands back the rows of the events query in another order: shuffled, or reversed. */
  const reorderEvents = (how: 'shuffle' | 'reverse', seed: number) => {
    const next = rng(seed)
    return (tx: Tx): Tx => ({
      query: (async (sql: string, params?: unknown[]) => {
        const rows = await tx.query<Record<string, unknown>>(sql, params)
        if (!/from update_event/.test(sql)) return rows
        const a = [...rows]
        if (how === 'reverse') return a.reverse()
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!] }
        return a
      }) as Tx['query'],
    })
  }

  it('O-10: the board and all 300 order pages equal the stored original when the events arrive shuffled, and when they arrive reversed', async () => {
    for (const [how, seed] of [['shuffle', 1], ['shuffle', 2], ['reverse', 3]] as const) {
      const now = await snapshot(db, GEN_TODAY, 6, reorderEvents(how, seed))
      expect(now.sample).toEqual(golden.sample)
      expect(now).toEqual(golden)
    }
  }, 120_000)

  it('O-10: the load asks the database for no ORDER BY on events, and for sizes only when one order is asked for', async () => {
    const seen: string[] = []
    const spy = (tx: Tx): Tx => ({ query: (async (sql: string, p?: unknown[]) => { seen.push(sql); return tx.query(sql, p) }) as Tx['query'] })
    const id = (await pg.query<{ id: string }>('select id::text as id from orders order by po limit 1')).rows[0]!.id
    const all = await db.tx(MERCH, (tx) => loadEngineData(spy(tx)))
    const one = await db.tx(MERCH, (tx) => loadEngineData(spy(tx), id))
    const events = seen.filter((q) => /from update_event/.test(q))
    expect(events).toHaveLength(2)
    for (const q of events) expect(q).not.toMatch(/orders+by/i)
    const orderQueries = seen.filter((q) => /from orders o/.test(q))
    expect(orderQueries[0]).not.toMatch(/o.sizes/)
    expect(orderQueries[1]).toMatch(/o.sizes/)
    expect(all.orders).toHaveLength(300)
    expect(all.orders.every((o) => Object.keys(o.sizes).length === 0)).toBe(true)
    expect(one.orders).toHaveLength(1)
  })

  it('O-10: the order page still shows the sizes of its order', async () => {
    await pg.exec(`update orders set sizes = '{"S": 100, "M": 200}'::jsonb where po = 'GEN-PO-0001'`)
    const id = (await pg.query<{ id: string }>("select id::text as id from orders where po = 'GEN-PO-0001'")).rows[0]!.id
    const { getOrderDetail } = await import('../src/orderDetailService.js')
    const d = await db.tx(MERCH, (tx) => getOrderDetail(tx, MERCH, id, GEN_TODAY))
    expect(d.order.sizes).toEqual({ S: 100, M: 200 })
    await pg.exec("update orders set sizes = '{}'::jsonb where po = 'GEN-PO-0001'")
  })

  it('O-10: two updates can never share a client_uuid, which is the only thing in the engine that depends on event order', async () => {
    await expect(pg.exec(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
      select client_uuid, order_id, buyer_id, stage, unit_id, date, qty from update_event limit 1`)).rejects.toThrow(/duplicate key|unique/i)
  })
})
