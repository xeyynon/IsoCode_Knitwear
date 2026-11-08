// O-3 (a refresh does not rewrite what did not change; its writes are batched) and O-2 (a refresh is scoped to what changed,
// refreshes are coalesced, and a full one still runs when the day changes, after a failure, and now and then).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { loadEngineData } from '../src/engineData.js'
import { loadEngineDataFor, refreshWarnings, WarningRefresher } from '../src/warningService.js'
import { refreshWarningsOld } from './oldRefresh.js'
import { bulkSeed, buyerVisible, isFullOpenRead, isOpenRead, isWarningUpdate, logging, outboxTable, pad, warningTable } from './refreshHarness.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed, TEMPLATE_ID, TODAY } from './helpers.js'

const SYS = { role: 'system' as const }
const NOW = new Date('2026-11-04T04:30:00Z')   // 10:00 in India, TODAY
let pg: PGlite
let pgOld: PGlite
let db: Db
let dbOld: Db
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg); pgOld = await migratedDb(); dbOld = pgliteDb(pgOld) })
beforeEach(async () => {
  for (const p of [pg, pgOld]) { await resetAndSeed(p); await bulkSeed(p, 7, 14, TODAY) }
})
afterAll(async () => { await pg.close(); await pgOld.close() })

const xmins = async () => (await pg.query<{ id: string; x: string }>('select id::text as id, xmin::text as x from warning order by id')).rows
const addEvent = (p: PGlite, order: string, stage: string, unit: string, qty: number, n: number, date = TODAY) =>
  p.query(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty) select $1, id, buyer_id, $3, $4, $5, $6 from orders where id = $2`,
    [`00000000-0000-4000-a000-${pad(n)}`, order, stage, unit, date, qty])
const bulkId = (i: number) => `00000000-0000-0000-0000-${pad(100 + i)}`

describe('O-3: a refresh does not rewrite a warning whose figures did not change', () => {
  it('leaves every tuple version alone on a second refresh of the same input, and sends no UPDATE', async () => {
    await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY))
    const before = await xmins()
    expect(before.length).toBeGreaterThan(3)   // there is something to rewrite
    const spy = logging(db)
    await spy.db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY))
    expect(await xmins()).toEqual(before)
    expect(spy.log.filter((l) => isWarningUpdate(l.sql))).toEqual([])
  })

  it('the old per-row code, given the same input, DOES rewrite every open warning (so this test can tell the two apart)', async () => {
    await dbOld.tx(SYS, (tx) => refreshWarningsOld(tx, SYS, TODAY))
    const open = (await pgOld.query<{ n: number }>('select count(*)::int as n from warning where resolved_at is null')).rows[0]!.n
    const spy = logging(dbOld)
    await spy.db.tx(SYS, (tx) => refreshWarningsOld(tx, SYS, TODAY))
    expect(spy.log.filter((l) => isWarningUpdate(l.sql)).length).toBe(open)
    expect(open).toBeGreaterThan(3)
  })

  it('writes only the warnings whose figures moved, all in one statement, and the others keep their tuple version', async () => {
    await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY))
    const before = new Map((await xmins()).map((r) => [r.id, r.x]))
    // A few more pieces on three stages that have a warning move their figures a little; require one statement per kind of change at most,
    // and that rows whose figures did not move keep their tuple version.
    const warned = (await pg.query<{ order_id: string; stage: string; unit_id: string }>(
      `select w.order_id::text as order_id, w.stage, m.unit_id::text as unit_id from warning w join milestone m on m.order_id = w.order_id and m.stage = w.stage where w.resolved_at is null order by w.id limit 3`)).rows
    let n = 1
    for (const w of warned) await addEvent(pg, w.order_id, w.stage, w.unit_id, 1, n++)
    const spy = logging(db)
    await spy.db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY))
    expect(spy.log.filter((l) => isWarningUpdate(l.sql)).length).toBeLessThanOrEqual(3)   // one per kind of change (colour, date moved, figures), never one per row
    const after = await xmins()
    const touched = after.filter((r) => before.get(r.id) !== r.x).length
    expect(touched).toBeGreaterThan(0)
    expect(touched).toBeLessThan(before.size)   // the rest keep their tuple version
  })

  it('ends in exactly the table the old per-row code ends in, step by step, and writes the same alerts', async () => {
    const steps: ((p: PGlite, k: number) => Promise<unknown>)[] = [
      async () => undefined,                                                          // first refresh: creates
      (p, k) => addEvent(p, bulkId(0), 'cutting', ID.unit1, 900, 10 + k),             // figures move
      (p, k) => addEvent(p, bulkId(1), 'cutting', ID.unit1, 5000, 20 + k),            // a stage completes: resolved
      (p) => p.query(`update milestone set planned_end = planned_end + 3 where order_id = $1`, [bulkId(2)]),   // the date behind a wording moves
      (p) => p.query(`update orders set ex_factory = ex_factory - 6 where id = $1`, [bulkId(3)]),
      (p) => p.query(`insert into calendar_day (unit_id, date, working) select $1, d::date, false from generate_series(date '2026-11-05', date '2026-11-12', '1 day') d`, [ID.unit1]),
      async () => undefined,
    ]
    for (let k = 0; k < steps.length; k++) {
      await steps[k]!(pg, k); await steps[k]!(pgOld, k)
      await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY))
      await dbOld.tx(SYS, (tx) => refreshWarningsOld(tx, SYS, TODAY))
      // keep a few confirmed / dismissed so the rules about them are exercised by the later steps
      if (k === 0) for (const p of [pg, pgOld]) {
        const ids = (await p.query<{ id: string }>(`select w.id::text as id from warning w join orders o on o.id = w.order_id where w.resolved_at is null order by o.po, w.stage limit 4`)).rows
        await p.query(`update warning set confirmed_by = $2, confirmed_at = now() where id = $1`, [ids[0]!.id, ID.merch])
        await p.query(`update warning set dismissed_at = now(), dismissed_was_confirmed = false where id = $1`, [ids[1]!.id])
        await p.query(`update warning set confirmed_by = $2, confirmed_at = now() where id = $1`, [ids[2]!.id, ID.merch])
      }
      expect(await warningTable(pg), `step ${k}`).toEqual(await warningTable(pgOld))
      expect(await outboxTable(pg), `alerts at step ${k}`).toEqual(await outboxTable(pgOld))
    }
    expect((await warningTable(pg)).length).toBeGreaterThan(3)
  })

  it('compares figures without regard to key order (jsonb stores keys in its own order)', async () => {
    await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY))
    const before = await xmins()
    await pg.query(`update warning set maths = (select jsonb_object_agg(k, v order by k desc) from jsonb_each(maths) e(k, v))`)   // same content, written in another order
    const mid = await xmins()
    const spy = logging(db)
    await spy.db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY))
    expect(await xmins()).toEqual(mid)
    expect(spy.log.filter((l) => isWarningUpdate(l.sql))).toEqual([])
    expect(mid.length).toBe(before.length)
  })
})

describe('O-2: a scoped refresh touches only its scope', () => {
  it('an order scope recomputes that order and leaves a stale warning on another order alone', async () => {
    await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY))
    const rows = (await pg.query<{ order_id: string; stage: string; unit_id: string }>(
      `select w.order_id::text as order_id, w.stage, m.unit_id::text as unit_id from warning w join milestone m on m.order_id = w.order_id and m.stage = w.stage where w.resolved_at is null order by w.id limit 2`)).rows
    const [a, b] = rows as [typeof rows[0], typeof rows[0]]
    await addEvent(pg, a.order_id, a.stage, a.unit_id, 100000, 1)   // both stages complete
    await addEvent(pg, b.order_id, b.stage, b.unit_id, 100000, 2)
    await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY, { orderId: a.order_id }))
    const open = async (o: string) => (await pg.query(`select 1 from warning where order_id = $1 and stage = $2 and resolved_at is null`, [o, a.order_id === o ? a.stage : b.stage])).rows.length
    expect(await open(a.order_id)).toBe(0)   // resolved
    expect(await open(b.order_id)).toBe(1)   // not in scope: untouched
    await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY, { orderIds: [b.order_id] }))
    expect(await open(b.order_id)).toBe(0)
  })

  it('a unit scope covers the orders with a milestone in that unit and no others', async () => {
    await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY))
    await pg.query(`insert into calendar_day (unit_id, date, working) select $1, d::date, false from generate_series(date '2026-11-05', date '2026-11-20', '1 day') d`, [ID.unit2])
    const before = await warningTable(pg)
    await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY, { unitId: ID.unit1 }))   // unit 2 changed, unit 1 asked: nothing from the calendar of unit 2 shows up
    const afterUnit1 = await warningTable(pg)
    await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY, { unitId: ID.unit2 }))
    const afterUnit2 = await warningTable(pg)
    await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY))
    const full = await warningTable(pg)
    expect(afterUnit2).toEqual(full)         // asking for the unit that changed is the same as a full refresh
    expect(afterUnit1).not.toEqual(full)     // the other unit's orders were not recomputed
    expect(before).not.toEqual(full)
  })

  it('a scoped refresh is cheap: few statements, and none that write when nothing changed', async () => {
    await db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY))
    const spy = logging(db)
    await spy.db.tx(SYS, (tx) => refreshWarnings(tx, SYS, TODAY, { orderId: bulkId(0) }))
    expect(spy.log.length).toBeLessThanOrEqual(7)
    expect(spy.log.filter((l) => isWarningUpdate(l.sql) || /insert into/i.test(l.sql))).toEqual([])
  })
})

describe('O-2: reading the data of several orders', () => {
  it('gives the same rows and mapping as loadEngineData, for just those orders (guards the copy against drift)', async () => {
    await pg.query(`update orders set sizes = '{"S": 10, "M": 20}'::jsonb`)   // non-empty sizes, so a column the two loaders disagree on would show
    await addEvent(pg, bulkId(0), 'cutting', ID.unit1, 5, 1)
    await pg.query(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty, on_behalf) select '00000000-0000-4000-a000-000000009999', id, buyer_id, 'cutting', $2, $3, 7, true from orders where id = $1`, [bulkId(0), ID.unit1, TODAY])
    const ids = [bulkId(0), bulkId(3), bulkId(5), ID.orderRed]
    const all = await db.tx(SYS, (tx) => loadEngineData(tx))
    const some = await db.tx(SYS, (tx) => loadEngineDataFor(tx, ids))
    const set = new Set(ids)
    expect(some.orders).toEqual(all.orders.filter((o) => set.has(o.id)))
    const byKey = <T,>(m: Map<string, T>, keep: (k: string) => boolean) => [...m].filter(([k]) => keep(k)).sort(([a], [b]) => (a < b ? -1 : 1))
    expect(byKey(some.stagesBy, () => true)).toEqual(byKey(all.stagesBy, (k) => set.has(k)))
    // (the order of the events inside one order is not part of the contract: the engine's answer does not depend on it)
    const sorted = (m: ReturnType<typeof byKey<{ clientUuid: string }[]>>) => m.map(([k, v]) => [k, [...v].sort((a, b) => (a.clientUuid < b.clientUuid ? -1 : 1))])
    expect(sorted(byKey(some.eventsBy, () => true))).toEqual(sorted(byKey(all.eventsBy, (k) => set.has(k))))
    expect(some.calendars).toEqual(all.calendars)
    expect(some.settings).toEqual(all.settings)
    expect(some.onBehalf.size).toBeGreaterThan(0)
    expect([...some.onBehalf].every((u) => all.onBehalf.has(u))).toBe(true)
    // and it is cheap: the order list is not read
    const spy = logging(db)
    await spy.db.tx(SYS, (tx) => loadEngineDataFor(tx, ids))
    expect(spy.log.some((l) => /where o\.id = any/.test(l.sql))).toBe(true)
  })
})

describe('O-2: when the refresher runs what', () => {
  const make = (inner: Db, extra: { fullEveryMs?: number; now?: () => number; clock?: () => Date; onError?: (e: unknown) => void } = {}) => {
    const spy = logging(inner)
    const r = new WarningRefresher({ db: spy.db, clock: () => NOW, fullEveryMs: 60_000, now: () => 1_000, ...extra })
    const fulls = () => spy.log.filter((l) => isFullOpenRead(l.sql)).length
    return { r, spy, fulls }
  }

  it('the first refresh is full, later scoped ones are not', async () => {
    const { r, spy, fulls } = make(db)
    await r.request({ orderId: bulkId(0) })
    expect(fulls()).toBe(1)
    spy.reset()
    await r.request({ orderId: bulkId(1) })
    expect(fulls()).toBe(0)
    expect(spy.tx.system).toBe(1)
  })

  it('the first refresh on a new factory day is full (figures move with no write), and only the first', async () => {
    let now = NOW
    const { r, spy, fulls } = make(db, { clock: () => now })
    await r.request({ orderId: bulkId(0) })
    spy.reset()
    now = new Date('2026-11-04T19:00:00Z')   // 00:30 on the 5th in India
    expect(r.needsFull()).toBe(true)
    await r.request({ orderId: bulkId(0) })
    expect(fulls()).toBe(1)
    spy.reset()
    await r.request({ orderId: bulkId(0) })
    expect(fulls()).toBe(0)
  })

  it('a full refresh runs again once the safety interval has passed, and every time when it is 0', async () => {
    let t = 1_000
    const { r, spy, fulls } = make(db, { now: () => t })
    await r.request({ orderId: bulkId(0) })
    spy.reset(); t += 59_000
    await r.request({ orderId: bulkId(0) })
    expect(fulls()).toBe(0)
    t += 2_000
    await r.request({ orderId: bulkId(0) })
    expect(fulls()).toBe(1)
    const zero = make(db, { fullEveryMs: 0 })
    await zero.r.request({ orderId: bulkId(0) }); await zero.r.request({ orderId: bulkId(1) })
    expect(zero.fulls()).toBe(2)
  })

  it('settings edited behind its back make the next scoped refresh turn into a full one', async () => {
    const { r, spy, fulls } = make(db)
    await r.request()   // full, remembers the settings
    spy.reset()
    await pg.query(`update settings set value = '7'::jsonb where key = 'warn_within_days'`)
    await r.request({ orderId: bulkId(0) })
    expect(fulls()).toBe(1)
  })

  it('N writes at the same moment cost at most 2 refreshes', async () => {
    const { r, spy } = make(db)
    await r.request()   // warm: now only scoped runs
    spy.reset()
    await Promise.all(Array.from({ length: 12 }, (_, i) => r.request({ orderId: bulkId(i) })))
    expect(spy.tx.system).toBeLessThanOrEqual(2)
    expect(spy.tx.system).toBeGreaterThanOrEqual(1)
  })

  it('a request that arrives while a refresh runs is not answered until a run that began after it has finished', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((res) => { release = res })
    let first = true
    const slow: Db = { tx: async (ctx, fn) => { if (first) { first = false; order.push('start1'); await gate; order.push('end1') } else order.push('run2'); return db.tx(ctx, fn) } }
    const r = new WarningRefresher({ db: slow, clock: () => NOW })
    const p1 = r.request()
    await Promise.resolve()
    const p2 = r.request({ orderId: bulkId(0) }).then(() => order.push('done2'))
    release()
    await Promise.all([p1, p2])
    expect(order).toEqual(['start1', 'end1', 'run2', 'done2'])
  })

  it('a failed refresh is reported, does not reject, and leaves the next call to do a full one', async () => {
    let fail = true
    const flaky: Db = { tx: (ctx, fn) => (fail ? Promise.reject(new Error('down')) : db.tx(ctx, fn)) }
    const errors: unknown[] = []
    const spy = logging(flaky)
    const r = new WarningRefresher({ db: spy.db, clock: () => NOW, onError: (e) => errors.push(e) })
    await r.request()                                 // first full: fails
    expect(errors).toHaveLength(1)
    fail = false
    const ok = new WarningRefresher({ db: logging(db).db, clock: () => NOW })
    await ok.request({ orderId: bulkId(0) }); expect(ok.needsFull()).toBe(false)
    // the same instance, after the failure, is still dirty: a scoped request becomes a full refresh
    const spy2 = logging(db)
    let down = false
    const sometimes: Db = { tx: (ctx, fn) => (down ? Promise.reject(new Error('down')) : spy2.db.tx(ctx, fn)) }
    const r2 = new WarningRefresher({ db: sometimes, clock: () => NOW, onError: (e) => errors.push(e) })
    await r2.request()
    down = true; await r2.request({ orderId: bulkId(0) }); expect(errors).toHaveLength(2)
    down = false; spy2.reset()
    await r2.request({ orderId: bulkId(1) })
    expect(spy2.log.filter((l) => isFullOpenRead(l.sql))).toHaveLength(1)
  })

  it('reset() forgets everything: the next refresh is full', async () => {
    const { r, spy, fulls } = make(db)
    await r.request(); spy.reset(); await r.request({ orderId: bulkId(0) }); expect(fulls()).toBe(0)
    r.reset(); await r.request({ orderId: bulkId(0) }); expect(fulls()).toBe(1)
  })
})

describe('O-2: what each route asks for', () => {
  let app: FastifyInstance
  let spy: ReturnType<typeof logging>
  const open = (sqls: { sql: string; role: string }[]) => sqls.filter((l) => l.role === 'system' && isOpenRead(l.sql))
  beforeEach(async () => {
    spy = logging(db)
    app = buildApp({ db: spy.db, tokenSecret: 'x'.repeat(40), clock: () => NOW })
  })
  const login = async () => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token}` })
  const post = async (url: string, payload: object) => app.inject({ method: 'POST', url, payload, headers: await login() })
  const warm = async () => { await app.inject({ url: '/api/review', headers: await login() }); spy.reset() }
  const ev = (n: number, orderId = bulkId(0), stage = 'cutting') => ({ clientUuid: `00000000-0000-4000-b000-${pad(n)}`, orderId, stage, date: TODAY, qty: 10 })

  it('an event refreshes its own order only', async () => {
    await warm()
    expect((await post('/api/events', ev(1))).statusCode).toBe(200)
    const reads = open(spy.log)
    expect(reads).toHaveLength(1)
    expect(isFullOpenRead(reads[0]!.sql)).toBe(false)
    expect(spy.log.some((l) => l.role === 'system' && /where o\.id = \$1/.test(l.sql))).toBe(true)
  })

  it('an ex-factory change refreshes that order only', async () => {
    await warm()
    expect((await post(`/api/orders/${bulkId(2)}/ex-factory`, { exFactory: '2026-12-20', reason: 'test' })).statusCode).toBe(200)
    const reads = open(spy.log)
    expect(reads.map((r) => isFullOpenRead(r.sql))).toEqual([false])
    expect(spy.log.some((l) => l.role === 'system' && /where o\.id = \$1/.test(l.sql))).toBe(true)
  })

  it('a calendar change refreshes the orders of that unit, and clearing it again too', async () => {
    await warm()
    expect((await post('/api/calendar', { unitId: ID.unit2, date: '2026-11-10', working: false })).statusCode).toBe(200)
    expect(open(spy.log).map((r) => isFullOpenRead(r.sql))).toEqual([false])
    expect(spy.log.some((l) => l.role === 'system' && /from milestone where unit_id = any/.test(l.sql))).toBe(true)
    spy.reset()
    expect((await post('/api/calendar/clear', { unitId: ID.unit2, date: '2026-11-10' })).statusCode).toBe(200)
    expect(open(spy.log).map((r) => isFullOpenRead(r.sql))).toEqual([false])
  })

  it('a new order refreshes that order only, and its warning is there at once', async () => {
    await warm()
    const res = await post('/api/orders', { buyerId: ID.buyerB, po: 'LATE-9', style: 's', colour: 'c', sizes: { M: 1000 }, exFactory: '2026-11-10', templateId: TEMPLATE_ID })
    expect(res.statusCode).toBe(201)
    expect(open(spy.log).map((r) => isFullOpenRead(r.sql))).toEqual([false])
    expect((await pg.query(`select 1 from warning where order_id = $1`, [res.json().orderId])).rows.length).toBeGreaterThan(0)
  })

  it('a batch refreshes the orders of the updates it stored, once, and nothing when every item was refused', async () => {
    await warm()
    const events = [ev(2, bulkId(0)), ev(3, bulkId(1)), ev(4, bulkId(1), 'cutting')]
    const res = await post('/api/events/batch', { events })
    expect(res.statusCode).toBe(200)
    expect(spy.tx.system).toBe(1)
    expect(open(spy.log).map((r) => isFullOpenRead(r.sql))).toEqual([false])
    spy.reset()
    await post('/api/events/batch', { events: [{ ...ev(5), stage: 'nonsense-stage' }] })
    expect(spy.tx.system).toBe(0)
  })

  it('opening the review queue: full the first time, then only the orders on the queue; a new factory day is full again', async () => {
    let now = NOW
    app = buildApp({ db: spy.db, tokenSecret: 'x'.repeat(40), clock: () => now })
    const h = await login()
    await app.inject({ url: '/api/review', headers: h })
    expect(open(spy.log).map((r) => isFullOpenRead(r.sql))).toEqual([true])
    spy.reset()
    await app.inject({ url: '/api/review', headers: h })
    expect(open(spy.log).map((r) => isFullOpenRead(r.sql))).toEqual([false])
    spy.reset()
    now = new Date('2026-11-04T19:00:00Z')
    await app.inject({ url: '/api/review', headers: await login() })   // (signing in again: the token is a day-part old)
    expect(open(spy.log).map((r) => isFullOpenRead(r.sql))).toEqual([true])
  })

  it('a failing refresh never fails the write, and the next call to the same app is a full refresh', async () => {
    let down = true
    const flaky: Db = { tx: (ctx, fn) => (ctx.role === 'system' && down ? Promise.reject(new Error('down')) : spy.db.tx(ctx, fn)) }
    app = buildApp({ db: flaky, tokenSecret: 'x'.repeat(40), clock: () => NOW })
    expect((await post('/api/events', ev(6))).statusCode).toBe(200)
    down = false; spy.reset()
    expect((await post('/api/events', ev(7))).statusCode).toBe(200)
    expect(open(spy.log).map((r) => isFullOpenRead(r.sql))).toEqual([true])
  })

  it('what a buyer can read is only what a person confirmed, after any of this', async () => {
    await warm()
    await post('/api/events', ev(8))
    expect(await buyerVisible(db, ID.buyerB)).toEqual([])
    expect(await buyerVisible(db, ID.buyerC)).toEqual([])
  })
})
