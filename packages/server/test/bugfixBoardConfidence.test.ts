// BE-004 (board half): the board and the order page decide "low confidence" by the same rule, including the unit's closed days.
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

const merch = async () => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token}` })

describe('BE-004: board and order page agree on low confidence', () => {
  it('BE-004: an on-behalf figure on a day the unit had closed is flagged by neither, and one on a working day by both', async () => {
    await pg.exec(`insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ('00000000-0000-0000-0000-0000000000f1', '${ID.buyerB}', 'B-CONF', 's', 'c', 5000, '2026-12-20');
                   insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty)
                   values ('00000000-0000-0000-0000-0000000000f1', '${ID.buyerB}', 'sewing', '${ID.unit1}', '2026-12-18', 0, 5000);
                   insert into calendar_day (unit_id, date, working, note) values ('${ID.unit1}', '2026-11-02', false, 'closed')`)
    const ev = (date: string, qty: number, onBehalf: boolean) => pg.query(
      `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty, on_behalf, entered_by)
       values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000f1', $1, 'sewing', $2, $3, $4, $5, $6)`,
      [ID.buyerB, ID.unit1, date, qty, onBehalf, onBehalf ? ID.merch : null])
    await ev('2026-10-29', 100, false); await ev('2026-10-30', 100, false); await ev('2026-10-31', 100, false)
    await ev('2026-11-02', 900, true)                       // typed for a day the unit had closed: the engine drops it from the rate
    await ev('2026-11-03', 100, false)
    const flaggedOnBoard = async () => (await app.inject({ url: '/api/board', headers: await merch() })).json().rows.find((r: any) => r.po === 'B-CONF').lowConfidenceStages
    const flaggedOnPage = async () => (await app.inject({ url: '/api/orders/00000000-0000-0000-0000-0000000000f1', headers: await merch() })).json().stages[0].lowConfidence
    expect(await flaggedOnPage()).toBe(false)
    expect(await flaggedOnBoard()).toEqual([])

    await ev('2026-11-03', 50, true)                        // a typed figure on a finished working day that feeds the rate
    expect(await flaggedOnPage()).toBe(true)
    expect(await flaggedOnBoard()).toEqual(['sewing'])
  })
})
