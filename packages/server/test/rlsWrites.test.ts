import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// Row-level security on its own, without the service code: a supervisor session may only write
// rows that match one of its own unit's stages, with that stage's order, unit and buyer.
let pg: PGlite
beforeAll(async () => { pg = await migratedDb() })
beforeEach(async () => { await resetAndSeed(pg) })
afterAll(async () => { await pg.close() })

const asSup = (sql: string, params: unknown[]) =>
  pgliteDb(pg).tx({ role: 'supervisor', unitId: ID.unit1 }, (tx) => tx.query(sql, params))

const event = (order: string, buyer: string, stage: string, unit: string) => asSup(
  `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
   values (gen_random_uuid(), $1, $2, $3, $4, '2026-11-04', 5)`, [order, buyer, stage, unit])
const note = (order: string, buyer: string, stage: string | null, unit: string) => asSup(
  `insert into note (order_id, buyer_id, stage, unit_id, text_en) values ($1, $2, $3, $4, 'x')`, [order, buyer, stage, unit])
const photo = (order: string, buyer: string, stage: string | null, unit: string) => asSup(
  `insert into photo (order_id, buyer_id, stage, unit_id, storage_key) values ($1, $2, $3, $4, 'photos/k.jpg')`, [order, buyer, stage, unit])

describe('supervisor write policies bind the row to its own stage', () => {
  it('allows a row that matches the stage', async () => {
    await expect(event(ID.orderRed, ID.buyerB, 'sewing', ID.unit1)).resolves.toBeDefined()
    await expect(note(ID.orderRed, ID.buyerB, 'sewing', ID.unit1)).resolves.toBeDefined()
    await expect(photo(ID.orderRed, ID.buyerB, 'sewing', ID.unit1)).resolves.toBeDefined()
  })

  it("refuses counts on another unit's order, even tagged with the caller's unit", async () => {
    await expect(event(ID.orderGreen, ID.buyerB, 'sewing', ID.unit1)).rejects.toThrow(/row-level security/)
    await expect(event(ID.orderGreen, ID.buyerC, 'sewing', ID.unit1)).rejects.toThrow(/row-level security/)
  })

  it('refuses a row whose buyer, unit or stage does not match', async () => {
    for (const write of [event, note, photo]) {
      await expect(write(ID.orderRed, ID.buyerC, 'sewing', ID.unit1)).rejects.toThrow(/row-level security/)
      await expect(write(ID.orderRed, ID.buyerB, 'packing', ID.unit1)).rejects.toThrow(/row-level security/)
    }
    await expect(note(ID.orderRed, ID.buyerB, 'sewing', ID.unit2)).rejects.toThrow(/row-level security/)
    await expect(photo(ID.orderRed, ID.buyerB, 'sewing', ID.unit2)).rejects.toThrow(/row-level security/)
  })

  it('refuses a note or photo with no stage', async () => {
    await expect(note(ID.orderRed, ID.buyerB, null, ID.unit1)).rejects.toThrow(/row-level security/)
    await expect(photo(ID.orderRed, ID.buyerB, null, ID.unit1)).rejects.toThrow(/row-level security/)
  })
})

describe("the 'auth' role may change only the sign-in attempt counters", () => {
  const asAuth = (sql: string, params: unknown[] = []) =>
    pgliteDb(pg).tx({ role: 'auth' }, (tx) => tx.query(sql, params))

  it('allows the lockout counters', async () => {
    await expect(asAuth(`update account set failed_attempts = failed_attempts + 1, locked_until = now() where id = $1`, [ID.sup1]))
      .resolves.toBeDefined()
    await expect(asAuth(`update account set failed_attempts = 0, locked_until = null where id = $1`, [ID.sup1])).resolves.toBeDefined()
  })

  it('refuses credentials, version, stop flag and unit', async () => {
    for (const set of [`password_hash = 'y'`, `pin_hash = 'y'`, `token_version = token_version + 1`,
      `disabled_at = now()`, `unit_id = null`, `failed_attempts = 0, label = 'x'`]) {
      await expect(asAuth(`update account set ${set} where id = $1`, [ID.sup1])).rejects.toThrow(/attempt counters/)
    }
    const rows = await pg.query<{ n: number }>(`select count(*)::int as n from account where password_hash = 'y' or pin_hash = 'y'`)
    expect(rows.rows[0]?.n).toBe(0)
  })
})
