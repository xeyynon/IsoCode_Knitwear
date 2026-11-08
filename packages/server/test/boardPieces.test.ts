// Board rows carry the pieces of the current stage (UI/UX plan slice 3.4), from the same engine result as the order page.
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

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const board = async () => (await app.inject({ url: '/api/board', headers: await merch() })).json().rows as any[]
const detail = async (id: string) => (await app.inject({ url: `/api/orders/${id}`, headers: await merch() })).json()

describe('the pieces of the current stage on the board', () => {
  it('match the order page for every order, so a row and its page cannot disagree', async () => {
    for (const row of await board()) {
      const d = await detail(row.orderId)
      const current = d.stages.find((s: any) => !s.complete)
      expect(row.currentStageQty).toBe(current ? current.qty : null)
      expect(row.currentStageProduced).toBe(current ? current.produced : null)
      expect(row.currentStageMadeIsEstimate).toBe(current ? current.madeIsEstimate : null)
    }
  })

  it('give the red order its real numbers (the bar must not be empty at 1,750 of 4,550)', async () => {
    const red = (await board()).find((r) => r.po === 'B-PO-88240')!
    expect([red.currentStage, red.currentStageQty, red.currentStageProduced, red.currentStageMadeIsEstimate]).toEqual(['sewing', 4550, 1750, false])
  })

  it('say nothing has been reported as zero, and an estimate as an estimate', async () => {
    await pg.exec(`insert into orders (buyer_id, po, style, colour, qty, ex_factory) values ('${ID.buyerB}', 'B-NEW', 's', 'c', 500, '2026-12-20');
                   insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty)
                   select id, buyer_id, 'sewing', '${ID.unit1}', '2026-12-18', 0, 500 from orders where po = 'B-NEW'`)
    const fresh = (await board()).find((r) => r.po === 'B-NEW')!
    expect([fresh.currentStageQty, fresh.currentStageProduced]).toEqual([500, 0])
    await pg.exec(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
                   select gen_random_uuid(), id, buyer_id, 'sewing', '${ID.unit1}', '2026-11-03', 40 from orders where po = 'B-NEW'`)
    const one = (await board()).find((r) => r.po === 'B-NEW')!
    expect([one.currentStageProduced, one.currentStageMadeIsEstimate]).toEqual([40, true])    // one day of updates is an estimate
  })

  it('are null when there is no current stage: every stage finished, or none set up', async () => {
    await pg.exec(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
                   values (gen_random_uuid(), '${ID.orderGreen}', '${ID.buyerC}', 'sewing', '${ID.unit2}', '2026-11-03', 5300);
                   insert into orders (buyer_id, po, style, colour, qty, ex_factory) values ('${ID.buyerC}', 'C-EMPTY', 's', 'c', 10, '2026-12-01')`)
    const rows = await board()
    for (const po of ['C-PO-0488', 'C-EMPTY']) {
      const r = rows.find((x) => x.po === po)!
      expect([r.currentStage, r.currentStageQty, r.currentStageProduced, r.currentStageMadeIsEstimate]).toEqual([null, null, null, null])
    }
  })

  it('stay off the buyer and supervisor views: they cannot read the board at all', async () => {
    expect((await app.inject({ url: '/api/board', headers: await sup() })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/board' })).statusCode).toBe(401)
  })
})
