import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const NOW = new Date('2026-11-04T04:30:00Z')
let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW }) })
afterAll(async () => { await pg.close() })

const sup = async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: CREDS.phone, pin: CREDS.pin } })
  return { authorization: `Bearer ${r.json().token}` }
}
const merch = async () => {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })
  return { authorization: `Bearer ${r.json().token}` }
}
const stages = async () => (await app.inject({ url: '/api/my/stages', headers: await sup() })).json()

describe('GET /api/my/stages', () => {
  it("lists only the supervisor's own unit's stages, soonest due first, with progress", async () => {
    const body = await stages()
    expect(body.today).toBe('2026-11-04')
    // unit 1 runs B-PO-88240 (due 11 Nov) and B-PO-88213 (due 20 Nov); unit 2's order is not visible
    expect(body.stages.map((s: any) => [s.po, s.stage, s.plannedEnd])).toEqual([
      ['B-PO-88240', 'sewing', '2026-11-11'],
      ['B-PO-88213', 'sewing', '2026-11-20'],
    ])
    const red = body.stages[0]
    expect(red).toMatchObject({ qty: 4550, produced: 1750, todayQty: 0, complete: false })
  })

  it("counts today's pieces separately from the total", async () => {
    await pg.query(
      `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty) values (gen_random_uuid(), $1, $2, 'sewing', $3, '2026-11-04', 120)`,
      [ID.orderRed, ID.buyerB, ID.unit1])
    const red = (await stages()).stages[0]
    expect(red.todayQty).toBe(120)
    expect(red.produced).toBe(1870)
  })

  it('marks a finished stage complete', async () => {
    await pg.query(
      `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty) values (gen_random_uuid(), $1, $2, 'sewing', $3, '2026-11-03', 2800)`,
      [ID.orderRed, ID.buyerB, ID.unit1])
    expect((await stages()).stages[0].complete).toBe(true)
  })

  it('a merchandiser is refused, and no token is a 401', async () => {
    expect((await app.inject({ url: '/api/my/stages', headers: await merch() })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/my/stages' })).statusCode).toBe(401)
  })

  it('is never cached', async () => {
    const res = await app.inject({ url: '/api/my/stages', headers: await sup() })
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
