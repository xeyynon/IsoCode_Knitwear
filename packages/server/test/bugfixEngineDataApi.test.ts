// BE-002 .. BE-006 through the API and the database: a stray date, a bad setting and a long timeline
// must not stall or mislead the board and the order page. Names start with the bug id.
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

const merch = async () => ({
  authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token}`,
})
const order = (over: object = {}) => ({
  buyerId: ID.buyerB, po: 'B-PO-90001', style: 'polo', colour: 'white', sizes: { S: 500, M: 1200, L: 800 },
  exFactory: '2026-11-20', templateId: TEMPLATE_ID, ...over,
})
const board = async () => app.inject({ url: '/api/board', headers: await merch() })
const detail = async (id: string) => app.inject({ url: `/api/orders/${id}`, headers: await merch() })

describe('BE-002 / BE-003: a date typo is refused where it comes in', () => {
  it('BE-002: an ex-factory date of 9999-12-31 is refused (400) when an order is created, previewed or moved', async () => {
    const h = await merch()
    const create = await app.inject({ method: 'POST', url: '/api/orders', headers: h, payload: order({ exFactory: '9999-12-31' }) })
    expect(create.statusCode).toBe(400)
    expect(create.json().error.message).toMatch(/real date/i)
    expect((await app.inject({ method: 'POST', url: '/api/orders/preview', headers: h, payload: order({ exFactory: '9999-12-31' }) })).statusCode).toBe(400)
    const move = await app.inject({ method: 'POST', url: `/api/orders/${ID.orderRed}/ex-factory`, headers: h, payload: { exFactory: '9999-12-31', reason: 'typo' } })
    expect(move.statusCode).toBe(400)
  })
  it('BE-003: an ex-factory date in year 0026 is refused instead of being read as 1926', async () => {
    const h = await merch()
    const res = await app.inject({ method: 'POST', url: '/api/orders', headers: h, payload: order({ exFactory: '0026-12-20' }) })
    expect(res.statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/orders/preview', headers: h, payload: order({ exFactory: '0026-12-20' }) })).statusCode).toBe(400)
  })
  it('BE-002: an ordinary date is still accepted', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/orders', headers: await merch(), payload: order() })).statusCode).toBe(201)
  })
  it('BE-002: a year-9999 order already in the database no longer stalls the board or its own page', async () => {
    await pg.exec(`insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ('00000000-0000-0000-0000-00000000f999', '${ID.buyerB}', 'B-FAR', 's', 'c', 500, '9999-12-31');
                   insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty)
                   values ('00000000-0000-0000-0000-00000000f999', '${ID.buyerB}', 'sewing', '${ID.unit1}', '9999-12-31', 1, 500)`)
    const t0 = performance.now()
    const b = await board()
    const d = await detail('00000000-0000-0000-0000-00000000f999')
    const ms = performance.now() - t0
    expect(b.statusCode).toBe(200)
    expect(d.statusCode).toBe(200)
    expect(b.json().rows.some((r: any) => r.po === 'B-FAR')).toBe(true)
    expect(ms).toBeLessThan(5000)       // it took about 53 seconds
  })
})

describe('BE-005: a bad stored setting does not change what the board says', () => {
  it('BE-005: window_days = 0 and a JSON null in the table leave the red order red', async () => {
    const before = (await (await board()).json().rows.find((r: any) => r.po === 'B-PO-88240'))
    expect(before.status).toBe('red')
    await pg.exec(`update settings set value = '0'::jsonb where key = 'window_days'; update settings set value = 'null'::jsonb where key = 'red_below'`)
    const after = (await (await board()).json().rows.find((r: any) => r.po === 'B-PO-88240'))
    expect(after.status).toBe('red')
    const d = (await detail(ID.orderRed)).json()
    expect(d.stages[0].made).toBe(350)
  })
})

describe('BE-006: the order page lists every closed day', () => {
  it('BE-006: an order shipping years out lists its Sundays to the last one', async () => {
    await pg.exec(`insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ('00000000-0000-0000-0000-00000000f998', '${ID.buyerB}', 'B-LONG', 's', 'c', 500, '2029-12-31');
                   insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty)
                   values ('00000000-0000-0000-0000-00000000f998', '${ID.buyerB}', 'sewing', '${ID.unit1}', '2029-12-28', 1, 500)`)
    const d = (await detail('00000000-0000-0000-0000-00000000f998')).json()
    expect(d.calendar.to).toBe('2029-12-31')
    const closed = d.calendar.units[0].closed as { date: string; reason: string }[]
    expect(closed[0]!.date).toBe('2026-11-08')
    expect(closed[closed.length - 1]!.date).toBe('2029-12-30')     // the last Sunday; the list used to stop after 400 days
    expect(closed.length).toBe(Math.floor((Date.parse('2029-12-30') - Date.parse('2026-11-08')) / (7 * 86_400_000)) + 1)
  })
})
