// npm run seed:demo  loads the brief's demo data (demoSeed.ts) into a real, migrated, EMPTY Postgres.
//   DATABASE_URL  the app's own login (app_user, not the owner): the rows go in through the same row-level security as the app.
// It refuses a database that already has orders, so it can never mix demo rows into real ones (--if-empty: skip it quietly instead). For staging and the review demo only.
import pg from 'pg'
import { pgDb } from './pgDb.js'
import { DEMO_TODAY, seedDemo } from './demoSeed.js'
import { errorReason } from './db.js'

const url = process.env.DATABASE_URL?.trim()
if (!url) { console.error('DATABASE_URL is not set. Refusing to start.'); process.exit(1) }
const today = process.env.DEMO_TODAY?.trim() || DEMO_TODAY
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) { console.error('DEMO_TODAY must be a date (YYYY-MM-DD).'); process.exit(1) }

const ifEmpty = process.argv.includes('--if-empty')   // the deploy passes this: a database that already has orders is left alone, not an error
const pool = new pg.Pool({ connectionString: url, max: 1 })
try {
  if (ifEmpty && (await pgDb(pool).tx({ role: 'system' }, (tx) => tx.query('select 1 from orders limit 1'))).length) {
    console.log('Demo seed skipped: the database already has orders.')
    process.exit(0)
  }
  const r = await pgDb(pool).tx({ role: 'system' }, (tx) => seedDemo(tx, today))
  console.log(`Demo data loaded: ${r.orders} orders, ${r.events} daily updates, ${r.notes} notes (today = ${today}).`)
} catch (e) {
  console.error(`Demo seed failed: ${errorReason(e)}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
