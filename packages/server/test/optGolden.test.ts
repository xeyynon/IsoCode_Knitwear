// OPT-A golden test: the board (and every order page) built from a fixed dataset must equal what the code produced BEFORE the
// speed-ups of O-1 (date maths), O-9 (buyer view), O-10 (the load query), O-17 (istDate). The fixture was written from the
// old code; OPT_WRITE_GOLDEN=1 rewrites it, which is only right after a change that is MEANT to change the output.
import fs from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.js'
import { TODAY, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'
import { GEN_TODAY, seedGenerated, snapshot } from './optData.js'

const GOLDEN = new URL('./fixtures/optBoardGolden.json', import.meta.url)
describe('OPT-A golden: board and order pages did not change', () => {
  let pg: PGlite
  let db: Db
  beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
  afterAll(async () => { await pg.close() })

  it('the seeded dataset (3 orders): the whole board is equal', async () => {
    await resetAndSeed(pg)
    const now = { seeded: await snapshot(db, TODAY, 10) }
    const want = readGolden('seeded', now)
    expect(now.seeded.sample).toEqual(want.seeded.sample)
    expect(now.seeded).toEqual(want.seeded)
  })

  it('a generated dataset of 300 orders: board and all 300 order pages are equal', async () => {
    await resetAndSeed(pg)
    await pg.exec('truncate update_event, milestone, orders, calendar_day, tna_template, account, unit, buyer cascade')
    await seedGenerated(pg, 300)
    const now = { generated: await snapshot(db, GEN_TODAY, 6) }
    expect(now.generated.orders).toBe(300)
    const want = readGolden('generated', now)
    expect(now.generated.sample).toEqual(want.generated.sample)
    expect(now.generated).toEqual(want.generated)
    // the fixture is only worth something if the data exercises the engine: all colours, and on-behalf figures, appear
    expect(Object.keys(now.generated.statuses).length).toBeGreaterThanOrEqual(3)
    expect(now.generated.lowConfidenceOrders).toBeGreaterThan(0)
  }, 120_000)
})

/** Reads the fixture; with OPT_WRITE_GOLDEN=1 first stores `now` under its key (merged into what is there). */
function readGolden(key: string, now: Record<string, unknown>): Record<string, any> {
  let have: Record<string, unknown> = {}
  try { have = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) } catch { /* first run */ }
  if (process.env.OPT_WRITE_GOLDEN === '1') {
    fs.mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true })
    fs.writeFileSync(GOLDEN, JSON.stringify({ ...have, [key]: now[key] }, null, 1) + '\n')
    have = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))
  }
  return have
}
