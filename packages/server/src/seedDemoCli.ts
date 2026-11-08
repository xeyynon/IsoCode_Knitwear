// npm run seed:demo  loads the brief's demo data (demoSeed.ts) into a real, migrated, EMPTY Postgres.
//   DATABASE_URL  the app's own login (app_user, not the owner): the rows go in through the same row-level security as the app.
// Without a flag it refuses a database that already has orders, so it can never mix demo rows into real ones. For staging and the review demo only.
// --if-empty is what every production deploy runs (scripts/vercel_build.mjs), and it keeps a shared demo usable (demoSeed.ts ensureDemo):
//   an empty database                  the demo is loaded
//   a database this seed made          the demo accounts, PINs and buyer links are put back as published, and the seeded notes come back
//   any other database                 left alone, quietly
// The check and the insert are one transaction behind an advisory lock, so two deploys close together cannot both pass the check.
import pg from 'pg'
import { pgDb } from './pgDb.js'
import { DEMO_TODAY, ensureDemo, seedDemo } from './demoSeed.js'
import { errorReason } from './db.js'

const url = process.env.DATABASE_URL?.trim()
if (!url) { console.error('DATABASE_URL is not set. Refusing to start.'); process.exit(1) }
const today = process.env.DEMO_TODAY?.trim() || DEMO_TODAY
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) { console.error('DEMO_TODAY must be a date (YYYY-MM-DD).'); process.exit(1) }

const ifEmpty = process.argv.includes('--if-empty')   // the deploy passes this: see the top of this file
const pool = new pg.Pool({ connectionString: url, max: 1 })
try {
  if (ifEmpty) {
    const r = await pgDb(pool).tx({ role: 'system' }, (tx) => ensureDemo(tx, today))
    if (r.action === 'skipped') console.log('Demo seed skipped: the database already has orders that are not the demo.')
    else if (r.action === 'refreshed') console.log('Demo already loaded: the demo accounts, PINs and buyer links are as published, and the notes are back for review.')
    else console.log(`Demo data loaded: ${r.orders} orders, ${r.events} daily updates, ${r.notes} notes (today = ${today}).`)
  } else {
    const r = await pgDb(pool).tx({ role: 'system' }, async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['isocode', 'seed_demo'])
      return seedDemo(tx, today)
    })
    console.log(`Demo data loaded: ${r.orders} orders, ${r.events} daily updates, ${r.notes} notes (today = ${today}).`)
  }
} catch (e) {
  console.error(`Demo seed failed: ${errorReason(e)}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
