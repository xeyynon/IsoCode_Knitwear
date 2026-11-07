import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { migratedDb, runSql, sqlFile } from './helpers.js'

// Managed Postgres runs migrations as an owner that is not a superuser, so FORCE RLS binds it.
// migratedDb() runs as the PGlite superuser, which would hide a migration that needs the bypass.
describe('migrations as a non-superuser table owner', () => {
  it('every migration applies', async () => {
    const pg = new PGlite()
    await pg.exec(`create role owner_role nosuperuser createrole nologin; grant create on schema public to owner_role; set role owner_role`)
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')
    for (const f of fs.readdirSync(dir).sort()) await runSql(pg, sqlFile('migrations', f))
    await pg.exec(`reset role`)
    expect((await pg.query(`select 1 from settings where key = 'reason_categories'`)).rows).toHaveLength(1)
    await pg.close()
  })
})

// The SQL assertions live in db/tests/rls.test.sql so they also run under psql on a
// real server. Any failed assertion raises, which rejects here.
describe('row-level security (db/tests/rls.test.sql)', () => {
  it('every assertion passes', async () => {
    const pg = await migratedDb()
    await runSql(pg, sqlFile('tests', 'rls.test.sql'))
    await pg.close()
  })

  // The file is documented to run as the owner. A superuser bypasses even FORCE RLS,
  // so run it again as a plain owner, which must act through app.role like everyone else.
  it('every assertion passes as a non-superuser table owner', async () => {
    const pg = new PGlite()
    await pg.exec(`create role owner_role nosuperuser createrole nologin; grant create on schema public to owner_role; set role owner_role`)
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')
    for (const f of fs.readdirSync(dir).sort()) await runSql(pg, sqlFile('migrations', f))
    await pg.exec(`reset role; grant app_user to owner_role; set role owner_role`)
    await runSql(pg, sqlFile('tests', 'rls.test.sql'))
    await pg.close()
  })
})
