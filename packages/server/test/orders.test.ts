import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { CREDS, ID, TEMPLATE_ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const SECRET = 'x'.repeat(40)
const NOW = new Date('2026-11-04T04:30:00Z') // 4 Nov 2026, India

let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW }) })
afterAll(async () => { await pg.close() })

const token = async (body: object) => ((await app.inject({ method: 'POST', url: '/api/auth/login', payload: body })).json() as { token: string }).token
const merch = async () => ({ authorization: `Bearer ${await token({ email: CREDS.email, password: CREDS.password })}` })
const sup = async () => ({ authorization: `Bearer ${await token({ phone: CREDS.phone, pin: CREDS.pin })}` })

const order = (over: object = {}) => ({
  buyerId: ID.buyerB, po: 'B-PO-90001', style: 'polo', colour: 'white', sizes: { S: 500, M: 1200, L: 800 },
  exFactory: '2026-11-20', templateId: TEMPLATE_ID, ...over,
})
const create = async (over: object = {}, headers?: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/api/orders', headers: headers ?? await merch(), payload: order(over) })
const ymd = (ms: { stage: string; plannedEnd: string }[]) => Object.fromEntries(ms.map((m) => [m.stage, m.plannedEnd]))

describe('creating an order from a TNA template', () => {
  it('back-schedules every stage from ex-factory, skipping Sundays', async () => {
    const res = await create()
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.qty).toBe(2500)                                  // the sizes added up
    expect(ymd(body.milestones)).toEqual({
      cutting: '2026-11-06', sewing: '2026-11-13', finishing: '2026-11-18', packing: '2026-11-20',
    })
    expect(body.alreadyDue).toEqual([])
    const { rows } = await pg.query<{ stage: string; qty: number; working_days_before: number }>(
      `select stage, qty, working_days_before from milestone where order_id = $1 order by sequence`, [body.orderId])
    expect(rows.map((r) => [r.stage, r.qty, r.working_days_before])).toEqual([
      ['cutting', 2500, 12], ['sewing', 2500, 6], ['finishing', 2500, 2], ['packing', 2500, 0]])
  })

  it('respects the unit calendar: a closure moves the date', async () => {
    await pg.exec(`insert into calendar_day (unit_id, date, working, note) values ('${ID.unit1}', '2026-11-19', false, 'closure')`)
    const body = (await create()).json()
    expect(ymd(body.milestones).finishing).toBe('2026-11-17') // 19th closed: 18th, then 17th
  })

  it('a new order with no updates shows on the board as grey, never green', async () => {
    await create()
    const board = (await app.inject({ url: '/api/board', headers: await merch() })).json()
    const row = board.rows.find((r: any) => r.po === 'B-PO-90001')
    expect(row.status).toBe('grey')
  })

  it('an order that is already late is created and flagged, not refused', async () => {
    const res = await create({ po: 'LATE-1', exFactory: '2026-11-10' })
    expect(res.statusCode).toBe(201)
    expect(res.json().alreadyDue).toContain('cutting')
  })

  describe('refuses bad input with a plain reason', () => {
    it.each([
      ['a missing PO', { po: ' ' }, /PO is required/],
      ['no sizes', { sizes: {} }, /at least one size/],
      ['a negative size', { sizes: { S: -1 } }, /whole number/],
      ['a fractional size', { sizes: { S: 1.5 } }, /whole number/],
      ['all sizes zero', { sizes: { S: 0 } }, /more than 0/],
      ['a quantity that does not match the sizes', { qty: 999 }, /does not match the sizes, which add up to 2500/],
      ['an impossible date', { exFactory: '2026-02-30' }, /real date/],
      ['a non-uuid buyer', { buyerId: 'abc' }, /Choose a buyer/],
    ])('%s', async (_l, over, msg) => {
      const res = await create(over)
      expect(res.statusCode).toBe(400)
      expect(res.json().error.message).toMatch(msg)
    })
    it('an unknown buyer or template is a 404', async () => {
      expect((await create({ buyerId: '00000000-0000-0000-0000-00000000dead' })).statusCode).toBe(404)
      expect((await create({ templateId: '00000000-0000-0000-0000-00000000dead' })).statusCode).toBe(404)
    })
    it('a repeated PO/style/colour for a buyer is a 409', async () => {
      expect((await create()).statusCode).toBe(201)
      const again = await create()
      expect(again.statusCode).toBe(409)
      expect(again.json().error.code).toBe('duplicate_order')
    })
    it('a template whose offsets are out of order is refused with the reason', async () => {
      const bad = '00000000-0000-0000-0000-0000000000f2'
      await pg.query(`insert into tna_template (id, name, offsets) values ($1, 'Bad', $2::jsonb)`, [bad, JSON.stringify([
        { stage: 'cutting', sequence: 1, working_days_before: 2, unit_id: ID.unit1 },
        { stage: 'sewing', sequence: 2, working_days_before: 6, unit_id: ID.unit1 }])])
      const res = await create({ templateId: bad })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.message).toMatch(/cannot be used.*"sewing" would finish/)
    })
    it('a failed create leaves nothing behind', async () => {
      await create({ qty: 999 })
      const { rows } = await pg.query(`select 1 from orders where po = 'B-PO-90001'`)
      expect(rows).toHaveLength(0)
    })
  })

  it('a supervisor cannot create orders', async () => {
    expect((await create({}, await sup())).statusCode).toBe(403)
  })
  it('needs sign-in', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/orders', payload: order() })).statusCode).toBe(401)
  })
})

describe('changing the ex-factory date', () => {
  const change = async (orderId: string, body: object, headers?: Record<string, string>) =>
    app.inject({ method: 'POST', url: `/api/orders/${orderId}/ex-factory`, headers: headers ?? await merch(), payload: body })
  const makeOrder = async () => (await create()).json().orderId as string

  it('re-schedules every milestone and logs each change with who, old, new and why', async () => {
    const id = await makeOrder()
    const res = await change(id, { exFactory: '2026-11-27', reason: 'Buyer moved the ship date' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.exFactory).toEqual({ old: '2026-11-20', new: '2026-11-27' })
    expect(Object.fromEntries(body.milestones.map((m: any) => [m.stage, m.new]))).toEqual({
      cutting: '2026-11-13', sewing: '2026-11-20', finishing: '2026-11-25', packing: '2026-11-27' })

    const { rows } = await pg.query<any>(`select entity, field, old, new, reason, user_id::text as user_id from date_change order by entity desc, new`)
    expect(rows).toHaveLength(5) // the order + four milestones
    expect(rows.every((r: any) => r.reason === 'Buyer moved the ship date' && r.user_id === ID.merch)).toBe(true)
    expect(rows.find((r: any) => r.entity === 'orders')).toMatchObject({ field: 'ex_factory', old: '2026-11-20', new: '2026-11-27' })
  })

  it('the board uses the new dates', async () => {
    const id = await makeOrder()
    await change(id, { exFactory: '2026-11-27', reason: 'moved' })
    const { rows } = await pg.query<{ planned_end: string }>(`select planned_end::text from milestone where order_id = $1 and stage = 'packing'`, [id])
    expect(rows[0]?.planned_end).toBe('2026-11-27')
  })

  it.each([[''], ['   '], [undefined]])('a reason is required (%j) and nothing changes without one', async (reason) => {
    const id = await makeOrder()
    const res = await change(id, { exFactory: '2026-11-27', reason })
    expect(res.statusCode).toBe(400)
    const { rows } = await pg.query<{ ex_factory: string }>(`select ex_factory::text from orders where id = $1`, [id])
    expect(rows[0]?.ex_factory).toBe('2026-11-20')
    expect((await pg.query(`select 1 from date_change`)).rows).toHaveLength(0)
  })

  it('refuses the same date, a bad date and an unknown order', async () => {
    const id = await makeOrder()
    expect((await change(id, { exFactory: '2026-11-20', reason: 'x' })).statusCode).toBe(400)
    expect((await change(id, { exFactory: 'soon', reason: 'x' })).statusCode).toBe(400)
    expect((await change('00000000-0000-0000-0000-00000000dead', { exFactory: '2026-11-27', reason: 'x' })).statusCode).toBe(404)
  })

  it('leaves a hand-set milestone where it is and says so', async () => {
    const id = await makeOrder()
    await pg.query(`update milestone set working_days_before = null, planned_end = '2026-11-14' where order_id = $1 and stage = 'sewing'`, [id])
    const body = (await change(id, { exFactory: '2026-11-27', reason: 'moved' })).json()
    expect(body.leftAlone).toEqual(['sewing'])
    const { rows } = await pg.query<{ planned_end: string }>(`select planned_end::text from milestone where order_id = $1 and stage = 'sewing'`, [id])
    expect(rows[0]?.planned_end).toBe('2026-11-14')
  })

  it('a supervisor cannot change dates', async () => {
    const id = await makeOrder()
    expect((await change(id, { exFactory: '2026-11-27', reason: 'x' }, await sup())).statusCode).toBe(403)
  })

  it('the history cannot be rewritten, even by the owner', async () => {
    const id = await makeOrder()
    await change(id, { exFactory: '2026-11-27', reason: 'moved' })
    await expect(pg.exec(`update date_change set reason = 'edited'`)).rejects.toThrow(/append-only/)
    await expect(pg.exec(`delete from date_change`)).rejects.toThrow(/append-only/)
  })
})
