import { describe, expect, it } from 'vitest'
import { migratedDb, runSql, sqlFile } from './helpers.js'

// The SQL assertions live in db/tests/rls.test.sql so they also run under psql on a
// real server. Any failed assertion raises, which rejects here.
describe('row-level security (db/tests/rls.test.sql)', () => {
  it('every assertion passes', async () => {
    const pg = await migratedDb()
    await runSql(pg, sqlFile('tests', 'rls.test.sql'))
    await pg.close()
  })
})
