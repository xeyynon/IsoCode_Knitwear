// A self-contained demo of the real app: the actual API on an in-memory Postgres (PGlite)
// with illustrative data. Used by `npm run dev:api` and by the browser tests. NOT for production.
import type { PGlite } from '@electric-sql/pglite'
import { buildApp } from './app.js'
import { memoryMediaStore } from './mediaStore.js'
import { migratedDb, pgliteDb, resetAndSeed, ID, TODAY } from '../test/helpers.js'

export interface Demo { pg: PGlite; port: number; close: () => Promise<void> }

export async function startDemoApi(opts: { port?: number; origins?: string[] } = {}): Promise<Demo> {
  const pg = await migratedDb()
  await resetAndSeed(pg)

  // More orders so the board shows every colour. Illustrative figures, not client data.
  const extra = async (po: string, buyer: string, unit: string, qty: number, rate: number, days: string[]) => {
    const o = await pg.query<{ id: string }>(
      `insert into orders (buyer_id, po, style, colour, qty, ex_factory) values ($1, $2, 'tee', 'black', $3, '2026-11-20') returning id::text as id`, [buyer, po, qty])
    const id = o.rows[0]!.id
    await pg.query(`insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty) values ($1, $2, 'sewing', $3, '2026-11-11', 1, $4)`, [id, buyer, unit, qty])
    for (const d of days) {
      await pg.query(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty) values (gen_random_uuid(), $1, $2, 'sewing', $3, $4, $5)`, [id, buyer, unit, d, rate])
    }
  }
  const week = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03']
  await extra('B-PO-88290', ID.buyerB, ID.unit1, 4950, 430, week)                                      // amber
  await extra('C-PO-0511', ID.buyerC, ID.unit2, 4000, 800, ['2026-10-27', '2026-10-28', '2026-10-29']) // good rate, gone quiet: grey
  await extra('C-PO-0520', ID.buyerC, ID.unit2, 5300, 500, week)                                       // green

  const app = buildApp({
    db: pgliteDb(pg),
    tokenSecret: 'dev-only-secret-dev-only-secret-dev-only',
    allowedOrigins: opts.origins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'],
    clock: () => new Date(`${TODAY}T04:30:00Z`),   // fixed so the seeded figures line up
    logger: false,
    media: memoryMediaStore(),   // photos live in memory in the demo and vanish with it
  })
  const port = opts.port ?? 8787
  await app.listen({ port, host: '127.0.0.1' })
  return { pg, port, close: async () => { await app.close(); await pg.close() } }
}
