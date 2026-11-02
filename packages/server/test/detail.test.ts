import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { CREDS, ID, TEMPLATE_ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

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
const get = async (url: string, h?: Record<string, string>) => app.inject({ url, headers: h ?? await merch() })
const post = async (url: string, payload: object, h?: Record<string, string>) => app.inject({ method: 'POST', url, payload, headers: h ?? await merch() })
const count = async (table: string) => (await pg.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0]!.n

describe('GET /api/orders/options', () => {
  it('lists buyers and templates with their stages in order', async () => {
    const body = (await get('/api/orders/options')).json()
    expect(body.buyers.map((b: any) => b.name)).toEqual(['Buyer B', 'Buyer C'])
    expect(body.templates).toHaveLength(1)
    expect(body.templates[0]).toMatchObject({ id: TEMPLATE_ID, name: 'Knit tee' })
    expect(body.templates[0].stages).toEqual([
      { stage: 'cutting', workingDaysBefore: 12 }, { stage: 'sewing', workingDaysBefore: 6 },
      { stage: 'finishing', workingDaysBefore: 2 }, { stage: 'packing', workingDaysBefore: 0 }])
  })
  it('is for merchandisers: a supervisor is refused, no token is a 401', async () => {
    expect((await get('/api/orders/options', await sup())).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/orders/options' })).statusCode).toBe(401)
  })
})

describe('POST /api/orders/preview', () => {
  it('shows the dates an order would get, naming each unit, without creating anything', async () => {
    const before = [await count('orders'), await count('milestone')]
    const res = await post('/api/orders/preview', { templateId: TEMPLATE_ID, exFactory: '2026-11-20' })
    expect(res.statusCode).toBe(200)
    const p = res.json()
    expect(p.milestones.map((m: any) => [m.stage, m.plannedEnd, m.unitName])).toEqual([
      ['cutting', '2026-11-06', 'Unit 1'], ['sewing', '2026-11-13', 'Unit 1'],
      ['finishing', '2026-11-18', 'Unit 1'], ['packing', '2026-11-20', 'Unit 1']])
    expect(p.problems).toEqual([])
    expect(p.alreadyDue).toEqual([])
    expect([await count('orders'), await count('milestone')]).toEqual(before)   // nothing written
  })
  it('says so when the order would already be late, and when the template is broken', async () => {
    const late = (await post('/api/orders/preview', { templateId: TEMPLATE_ID, exFactory: '2026-11-10' })).json()
    expect(late.alreadyDue).toContain('cutting')
    expect(late.problems).toEqual([])
    const bad = '00000000-0000-0000-0000-0000000000f2'
    await pg.query(`insert into tna_template (id, name, offsets) values ($1, 'Bad', $2::jsonb)`, [bad, JSON.stringify([
      { stage: 'cutting', sequence: 1, working_days_before: 2, unit_id: ID.unit1 },
      { stage: 'sewing', sequence: 2, working_days_before: 6, unit_id: ID.unit1 }])])
    const broken = (await post('/api/orders/preview', { templateId: bad, exFactory: '2026-11-20' })).json()
    expect(broken.problems.join(' ')).toMatch(/"sewing" would finish .* before "cutting"/)
  })
  it.each([
    [{ templateId: 'abc', exFactory: '2026-11-20' }, 400],
    [{ templateId: TEMPLATE_ID, exFactory: '2026-02-30' }, 400],
    [{ templateId: '00000000-0000-0000-0000-00000000dead', exFactory: '2026-11-20' }, 404],
    [{}, 400],
  ])('refuses %j with %i', async (body, status) => {
    expect((await post('/api/orders/preview', body)).statusCode).toBe(status)
  })
  it('a supervisor is refused', async () => {
    expect((await post('/api/orders/preview', { templateId: TEMPLATE_ID, exFactory: '2026-11-20' }, await sup())).statusCode).toBe(403)
  })
})

describe('GET /api/orders/:id', () => {
  const detail = async (id: string) => (await get(`/api/orders/${id}`)).json()

  it('shows each stage with the planned date beside the projected one, and the sum behind the colour', async () => {
    const d = await detail(ID.orderRed)
    expect(d.order).toMatchObject({ po: 'B-PO-88240', buyerName: 'Buyer B', qty: 4550, exFactory: '2026-11-20', status: 'red' })
    expect(d.stages).toHaveLength(1)
    expect(d.stages[0]).toMatchObject({
      stage: 'sewing', unitName: 'Unit 1', status: 'red', qty: 4550, produced: 1750, remaining: 2800,
      plannedEnd: '2026-11-11', projectedEnd: '2026-11-13',     // 2800 at 350/day = 8 working days, Sundays skipped
      maths: 'Need 467/day · making 350/day · 700 pcs short by 11 Nov.', shortBy: 700, madeIsEstimate: false, complete: false,
    })
    expect(d.history).toEqual([])
  })

  it('a new order with no updates is grey and says so, not green', async () => {
    const d = await detail(ID.orderNew)
    expect(d.order.status).toBe('grey')
    expect(d.stages[0].status).toBe('grey')
    expect(d.stages[0].projectedEnd).toBeNull()
    expect(d.stages[0].maths).toMatch(/no output recorded yet/)
  })

  it('lists every date change, newest first, with who, from, to and why', async () => {
    const created = (await post('/api/orders', { buyerId: ID.buyerB, po: 'B-NEW', style: 's', colour: 'c', sizes: { M: 1000 }, exFactory: '2026-11-20', templateId: TEMPLATE_ID })).json()
    await post(`/api/orders/${created.orderId}/ex-factory`, { exFactory: '2026-11-27', reason: 'Buyer moved the ship date' })
    const d = await detail(created.orderId)
    expect(d.history).toHaveLength(5)                                  // the order, and four stages
    expect(d.history.every((h: any) => h.by === CREDS.email && h.reason === 'Buyer moved the ship date')).toBe(true)
    const order = d.history.find((h: any) => h.what === 'Ex-factory date')
    expect(order).toMatchObject({ from: '2026-11-20', to: '2026-11-27' })
    expect(d.history.map((h: any) => h.what)).toEqual(expect.arrayContaining(['Cutting finish date', 'Sewing finish date', 'Finishing finish date', 'Packing finish date']))
    expect(d.stages.find((s: any) => s.stage === 'packing').plannedEnd).toBe('2026-11-27')
    expect(d.history[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  it('puts the most recent change first when there are several', async () => {
    const o = (await post('/api/orders', { buyerId: ID.buyerB, po: 'B-TWO', style: 's', colour: 'c', sizes: { M: 10 }, exFactory: '2026-11-20', templateId: TEMPLATE_ID })).json()
    await post(`/api/orders/${o.orderId}/ex-factory`, { exFactory: '2026-11-27', reason: 'first move' })
    await new Promise((r) => setTimeout(r, 25))                       // a later transaction gets a later timestamp
    await post(`/api/orders/${o.orderId}/ex-factory`, { exFactory: '2026-12-04', reason: 'second move' })
    const h = (await detail(o.orderId)).history
    expect(h[0]).toMatchObject({ reason: 'second move' })
    expect(h[h.length - 1]).toMatchObject({ reason: 'first move' })
    const orderRows = h.filter((x: any) => x.what === 'Ex-factory date')
    expect(orderRows.map((x: any) => [x.from, x.to])).toEqual([['2026-11-27', '2026-12-04'], ['2026-11-20', '2026-11-27']])
  })

  it("does not show another order's history", async () => {
    const a = (await post('/api/orders', { buyerId: ID.buyerB, po: 'A', style: 's', colour: 'c', sizes: { M: 10 }, exFactory: '2026-11-20', templateId: TEMPLATE_ID })).json()
    await post(`/api/orders/${a.orderId}/ex-factory`, { exFactory: '2026-11-27', reason: 'x' })
    expect((await detail(ID.orderRed)).history).toEqual([])
  })

  it('an unknown order is 404 and a malformed id is 400', async () => {
    expect((await get('/api/orders/00000000-0000-0000-0000-00000000dead')).statusCode).toBe(404)
    expect((await get('/api/orders/not-an-id')).statusCode).toBe(400)
  })
  it('a supervisor is refused; it is never cached', async () => {
    expect((await get(`/api/orders/${ID.orderRed}`, await sup())).statusCode).toBe(403)
    expect((await get(`/api/orders/${ID.orderRed}`)).headers['cache-control']).toBe('no-store')
  })
  it('the detail and the board always agree on the colour', async () => {
    const board = (await get('/api/board')).json().rows
    for (const row of board) expect((await detail(row.orderId)).order.status).toBe(row.status)
  })
})
