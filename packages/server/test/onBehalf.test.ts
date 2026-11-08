import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { lowConfidenceStages } from '../src/confidence.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// A merchandiser enters a stage on a visit (a subcontractor has no one to send a count). The update is
// kept as "entered on behalf" and the order page and board say it is low confidence. Buyers never see it.
const NOW = new Date('2026-11-04T04:30:00Z')
let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW }) })
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const evt = (over: object = {}) => ({ clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 100, ...over })
const send = async (payload: object, h: Record<string, string>) => app.inject({ method: 'POST', url: '/api/events', headers: h, payload })
const stored = async (clientUuid: string) =>
  (await pg.query<{ on_behalf: boolean; entered_by: string | null; qty: number }>(`select on_behalf, entered_by::text as entered_by, qty from update_event where client_uuid = $1`, [clientUuid])).rows
const detail = async (orderId = ID.orderRed) => (await app.inject({ url: `/api/orders/${orderId}`, headers: await merch() })).json()

describe('a merchandiser posts for any stage', () => {
  it("can post for a stage that is not theirs to be in: either unit's order", async () => {
    const h = await merch()
    for (const orderId of [ID.orderRed, ID.orderGreen]) {
      const e = evt({ orderId })
      expect((await send(e, h)).json()).toEqual({ ok: true, duplicate: false })
      expect(await stored(e.clientUuid)).toEqual([{ on_behalf: true, entered_by: ID.merch, qty: 100 }])
    }
  })

  it('a supervisor count is stored as theirs, not on behalf', async () => {
    const e = evt()
    await send(e, await sup())
    expect(await stored(e.clientUuid)).toEqual([{ on_behalf: false, entered_by: ID.sup1, qty: 100 }])
  })

  it("a supervisor still cannot post for another unit's stage", async () => {
    const e = evt({ orderId: ID.orderGreen })
    expect((await send(e, await sup())).statusCode).toBe(404)
    expect(await stored(e.clientUuid)).toEqual([])
  })

  it('a retried send is counted once', async () => {
    const h = await merch()
    const e = evt({ qty: 300 })
    expect((await send(e, h)).json().duplicate).toBe(false)
    expect((await send(e, h)).json().duplicate).toBe(true)
    expect(await stored(e.clientUuid)).toHaveLength(1)
    const sewing = (await detail()).stages.find((s: any) => s.stage === 'sewing')
    expect(sewing.produced).toBe(5 * 350 + 300)
  })

  it('uses the same checks and messages as a supervisor', async () => {
    const h = await merch()
    const bad = await send(evt({ qty: -5 }), h)
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.message).toMatch(/whole number/)
    const future = await send(evt({ date: '2026-11-05' }), h)
    expect(future.statusCode).toBe(400)
    expect(future.json().error.message).toMatch(/future/)
    const nope = await send(evt({ stage: 'embroidery' }), h)
    expect(nope.statusCode).toBe(404)
  })

  it("a note typed with it is kept, and a reason chosen with it is the merchandiser's own", async () => {
    await send(evt({ note: { text: 'Visited the unit: 300 counted by hand' } }), await merch())
    await send(evt({ note: { category: 'machine' } }), await merch())
    const n = (await pg.query<{ category_by: string | null; text_en: string | null; category: string | null }>(`select category_by, text_en, category from note order by created_at, id`)).rows
    expect(n).toEqual(expect.arrayContaining([
      { category_by: null, text_en: 'Visited the unit: 300 counted by hand', category: null },
      { category_by: 'merchandiser', text_en: null, category: 'machine' },
    ]))
  })

  it('the pieces count in the engine just as a floor count does', async () => {
    await send(evt({ qty: 2000 }), await merch())
    const board = (await app.inject({ url: '/api/board', headers: await merch() })).json()
    expect(board.rows.find((r: any) => r.po === 'B-PO-88240').status).toBe('green')
  })
})

describe('the flag on the order page and the board', () => {
  it('is off for a stage fed only by floor counts, on once a visit entry feeds its rate', async () => {
    expect((await detail()).stages[0].lowConfidence).toBe(false)
    expect((await app.inject({ url: '/api/board', headers: await merch() })).json().rows.find((r: any) => r.po === 'B-PO-88240').lowConfidenceStages).toEqual([])
    // BE-004: the rate rests on finished days, so the visit entry is dated yesterday; one dated today does not feed it (see bugfixEngineData.test.ts)
    await send(evt({ date: '2026-11-03' }), await merch())
    expect((await detail()).stages[0].lowConfidence).toBe(true)
    const row = (await app.inject({ url: '/api/board', headers: await merch() })).json().rows.find((r: any) => r.po === 'B-PO-88240')
    expect(row.lowConfidenceStages).toEqual(['sewing'])
  })

  it("is not set by a supervisor's own update", async () => {
    await send(evt(), await sup())
    expect((await detail()).stages[0].lowConfidence).toBe(false)
  })

  it('does not name a finished stage on the board', async () => {
    await send(evt({ qty: 5000, date: '2026-11-03' }), await merch())   // BE-004: dated yesterday, a day the rate rests on
    const d = await detail()
    expect(d.stages[0].complete).toBe(true)
    expect(d.stages[0].lowConfidence).toBe(true)
    const row = (await app.inject({ url: '/api/board', headers: await merch() })).json().rows.find((r: any) => r.po === 'B-PO-88240')
    expect(row.lowConfidenceStages).toEqual([])
  })

  it('the order page carries the factory date, for the form to default to', async () => {
    expect((await detail()).today).toBe('2026-11-04')
  })
})

describe('lowConfidenceStages (which stages rest on a visit entry)', () => {
  const ev = (stage: string, date: string, id: string) => ({ clientUuid: id, stage, date, qty: 10 })
  const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`

  it('flags a stage when an entry is among the newest days that feed its rate', () => {
    const events = [ev('sewing', day(20), 'a'), ev('sewing', day(21), 'b'), ev('sewing', day(22), 'c')]
    expect([...lowConfidenceStages(events, new Set(['c']), '2026-11-04', 5)]).toEqual(['sewing'])
  })

  it('does not flag one that has fallen out of the window', () => {
    // 5 to 10 Oct 2026 are Monday to Saturday (4 Oct is a Sunday, which is not a day of the rate: BE-004)
    const events = [5, 6, 7, 8, 9, 10].map((n) => ev('sewing', day(n), `e${n}`))
    expect(lowConfidenceStages(events, new Set(['e5']), '2026-11-04', 5).size).toBe(0)
    expect(lowConfidenceStages(events, new Set(['e6']), '2026-11-04', 5).size).toBe(1)
  })

  it('counts days, not rows: two entries on one day take one place', () => {
    const events = [ev('sewing', day(1), 'x'), ev('sewing', day(2), 'a'), ev('sewing', day(2), 'b'), ev('sewing', day(3), 'c')]
    expect(lowConfidenceStages(events, new Set(['x']), '2026-11-04', 3).size).toBe(1)
  })

  it('judges each stage on its own, and ignores a day in the future', () => {
    const events = [ev('sewing', day(1), 'a'), ev('cutting', day(1), 'b'), ev('cutting', '2026-11-20', 'c')]
    expect([...lowConfidenceStages(events, new Set(['a', 'c']), '2026-11-04', 5)]).toEqual(['sewing'])
  })
})

describe('the record is kept safe', () => {
  const asSup = (sql: string, params: unknown[]) => pgliteDb(pg).tx({ role: 'supervisor', unitId: ID.unit1 }, (tx) => tx.query(sql, params))

  it('a supervisor session cannot write a row marked on behalf', async () => {
    const insert = (flag: boolean) => asSup(
      `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty, on_behalf)
       values (gen_random_uuid(), $1, $2, 'sewing', $3, '2026-11-04', 5, $4)`, [ID.orderRed, ID.buyerB, ID.unit1, flag])
    await expect(insert(true)).rejects.toThrow(/row-level security/)
    await expect(insert(false)).resolves.toBeDefined()
  })

  it('the history stays insert-only: the flag cannot be rewritten afterwards', async () => {
    const e = evt()
    await send(e, await merch())
    await expect(pgliteDb(pg).tx({ role: 'merchandiser' }, (tx) => tx.query(`update update_event set on_behalf = false where client_uuid = $1`, [e.clientUuid]))).rejects.toThrow()
    expect((await stored(e.clientUuid))[0]!.on_behalf).toBe(true)
  })

  it('a buyer cannot read the flag, in the database or in what the buyer page returns', async () => {
    await send(evt(), await merch())
    const link = (await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await merch(), payload: { buyerId: ID.buyerB } })).json()
    const seen = await db.tx({ role: 'buyer', buyerId: ID.buyerB }, (tx) => tx.query('select on_behalf, entered_by from update_event'))
    expect(seen).toEqual([])
    const body = (await app.inject({ url: '/api/buyer/orders', headers: { authorization: `Bearer ${link.token}` } })).body
    expect(body).toContain('B-PO-88240')
    expect(body).not.toMatch(/onBehalf|on_behalf|enteredBy|lowConfidence|low confidence|merchandiser/i)
  })
})
