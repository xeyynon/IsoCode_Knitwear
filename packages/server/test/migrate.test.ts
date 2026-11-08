// The migration runner (src/migrate.ts), on PGlite through a small adapter. The runner's logic is the same code that runs
// over a real connection in production (pgSession); only the session differs. What only a real server can prove is listed
// in the last describe, which runs when TEST_DATABASE_URL is set (npm run test:pg).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { MIGRATE_LOCK, MIGRATIONS_DIR, checksumOf, readMigrations, run, runMigrations, type MigrationSession, type Sql } from '../src/migrate.js'
import { createRealPg, migratedDb, requireRealUrl, runSql, sqlFile, usingRealPostgres } from './helpers.js'

/** PGlite as a MigrationSession: with no parameters a string may hold several statements (exec), as on a pg connection. */
type Runner = { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>; exec(sql: string): Promise<Array<{ rows: unknown[] }>> }
const wrap = (x: Runner): Sql['query'] => (async (sql: string, params?: unknown[]) =>
  (params === undefined ? ((await x.exec(sql)).at(-1)?.rows ?? []) : (await x.query(sql, params)).rows)) as Sql['query']
export const pgliteSession = (pg: PGlite): MigrationSession => ({
  query: wrap(pg as unknown as Runner),
  transaction: (fn) => pg.transaction((t) => fn({ query: wrap(t as unknown as Runner) })),
})

const dirs: string[] = []
/** A folder of migration files: { '1_first.sql': '...' }. */
const folder = (files: Record<string, string>): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-migrate-'))
  dirs.push(d)
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(d, name), sql)
  return d
}
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })

let pg: PGlite
beforeEach(() => { pg = new PGlite() })
afterEach(async () => { await pg.close() })

const versions = async (): Promise<string[]> => (await pg.query<{ version: string }>('select version from schema_migrations order by version::int')).rows.map((r) => r.version)
const tableExists = async (t: string): Promise<boolean> => (await pg.query<{ t: string | null }>(`select to_regclass('public.${t}')::text as t`)).rows[0]!.t !== null

const A = 'create table a (n int); insert into a values (1);'
const B = 'create table b (n int); insert into b values (2);'

describe('order and bookkeeping', () => {
  it('applies files in numeric order (not text order), each recorded with its sha256', async () => {
    const dir = folder({
      '10_ten.sql': 'insert into trace values (10);',
      '9_nine.sql': 'create table trace (n int); insert into trace values (9);',
      '100_hundred.sql': 'insert into trace values (100);',
    })
    // text order would be 10, 100, 9 and fail on the missing table; numeric order is 9, 10, 100
    const r = await runMigrations(pgliteSession(pg), { dir })
    expect(r.applied).toEqual(['9_nine.sql', '10_ten.sql', '100_hundred.sql'])
    expect((await pg.query<{ n: number }>('select n from trace')).rows.map((x) => x.n)).toEqual([9, 10, 100])
    const rows = (await pg.query<{ version: string; name: string; checksum: string; applied_at: Date }>('select * from schema_migrations order by version::int')).rows
    expect(rows.map((x) => [x.version, x.name])).toEqual([['9', 'nine'], ['10', 'ten'], ['100', 'hundred']])
    expect(rows[0]!.checksum).toBe(checksumOf('create table trace (n int); insert into trace values (9);'))
    expect(rows[0]!.checksum).toMatch(/^[0-9a-f]{64}$/)
    expect(rows[0]!.applied_at).toBeInstanceOf(Date)
  })

  it('a second run applies nothing, and a new file later is the only thing applied', async () => {
    const dir = folder({ '1_a.sql': A, '2_b.sql': B })
    expect((await runMigrations(pgliteSession(pg), { dir })).applied).toHaveLength(2)
    const again = await runMigrations(pgliteSession(pg), { dir })
    expect(again).toEqual({ applied: [], alreadyApplied: 2, missing: [] })
    expect((await pg.query('select count(*)::int n from a')).rows).toEqual([{ n: 1 }])   // 1_a.sql did not run twice
    fs.writeFileSync(path.join(dir, '3_c.sql'), 'create table c (n int);')
    expect((await runMigrations(pgliteSession(pg), { dir })).applied).toEqual(['3_c.sql'])
    expect(await versions()).toEqual(['1', '2', '3'])
  })

  it('a line-ending change alone is not a change (a Windows checkout and a Linux one agree)', async () => {
    const dir = folder({ '1_a.sql': 'create table a (n int);\ninsert into a values (1);\n' })
    await runMigrations(pgliteSession(pg), { dir })
    fs.writeFileSync(path.join(dir, '1_a.sql'), 'create table a (n int);\r\ninsert into a values (1);\r\n')
    expect((await runMigrations(pgliteSession(pg), { dir })).applied).toEqual([])
  })

  it('reports (does not fail on) an applied migration whose file is gone: an older release over a newer database', async () => {
    const dir = folder({ '1_a.sql': A, '2_b.sql': B })
    await runMigrations(pgliteSession(pg), { dir })
    fs.rmSync(path.join(dir, '2_b.sql'))
    expect(await runMigrations(pgliteSession(pg), { dir })).toEqual({ applied: [], alreadyApplied: 1, missing: ['2_b.sql'] })
  })

  it('refuses file names it cannot order, and a number used twice', () => {
    expect(() => readMigrations(folder({ 'add_things.sql': A }))).toThrow(/not named like/)
    expect(() => readMigrations(folder({ '3_a.sql': A, '03_b.sql': B }))).toThrow(/Two migrations use the number/)
    expect(readMigrations(folder({ 'README.txt': 'x', '1_a.sql': A })).map((f) => f.file)).toEqual(['1_a.sql'])
  })
})

describe('an applied migration is never edited', () => {
  it('refuses to go on when its checksum changed, naming the file, and applies nothing else', async () => {
    const dir = folder({ '1_a.sql': A, '2_b.sql': B })
    await runMigrations(pgliteSession(pg), { dir })
    fs.writeFileSync(path.join(dir, '1_a.sql'), `${A} -- tidied`)
    fs.writeFileSync(path.join(dir, '3_c.sql'), 'create table c (n int);')
    await expect(runMigrations(pgliteSession(pg), { dir })).rejects.toThrow(/1_a\.sql was already applied, but the file has changed.*new migration/s)
    expect(await tableExists('c')).toBe(false)
    expect(await versions()).toEqual(['1', '2'])
  })

  it('refuses a new migration numbered below one already applied', async () => {
    const dir = folder({ '1_a.sql': A, '3_c.sql': 'create table c (n int);' })
    await runMigrations(pgliteSession(pg), { dir })
    fs.writeFileSync(path.join(dir, '2_b.sql'), B)
    await expect(runMigrations(pgliteSession(pg), { dir })).rejects.toThrow(/2_b\.sql has not been applied, but a newer one \(003\) has/)
    expect(await tableExists('b')).toBe(false)
  })

  it('refuses a database that has the tables but no history, instead of failing half way through 001', async () => {
    // PGlite on purpose (pgliteSession wraps a PGlite), so not migratedDb(), which is a real server under TEST_DATABASE_URL.
    const built = new PGlite()
    for (const f of fs.readdirSync(MIGRATIONS_DIR).sort()) await built.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    try { await expect(runMigrations(pgliteSession(built))).rejects.toThrow(/already has the application tables but no migration history/) } finally { await built.close() }
  })
})

describe('a failing migration', () => {
  it('rolls back all of itself, records nothing, stops there, and runs fine once fixed', async () => {
    const dir = folder({
      '1_a.sql': A,
      '2_broken.sql': 'create table half (n int); insert into half values (1); select 1/0; create table never (n int);',
      '3_c.sql': 'create table c (n int);',
    })
    await expect(runMigrations(pgliteSession(pg), { dir })).rejects.toThrow(/2_broken\.sql failed and was rolled back.*division by zero/s)
    expect(await versions()).toEqual(['1'])                                  // 1 is kept: it finished and was recorded
    expect([await tableExists('half'), await tableExists('never'), await tableExists('c')]).toEqual([false, false, false])
    fs.writeFileSync(path.join(dir, '2_broken.sql'), 'create table half (n int); insert into half values (1);')
    expect((await runMigrations(pgliteSession(pg), { dir })).applied).toEqual(['2_broken.sql', '3_c.sql'])
    expect(await versions()).toEqual(['1', '2', '3'])
  })
})

describe('the lock', () => {
  const spy = (): { session: MigrationSession; seen: string[] } => {
    const seen: string[] = []
    const inner = pgliteSession(pg)
    const note = (sql: string, params?: unknown[]) => { if (/advisory/.test(sql)) seen.push(`${sql.includes('unlock') ? 'unlock' : 'lock'} ${params?.[0]}`); else if (/^insert into schema_migrations/.test(sql)) seen.push('record') }
    return {
      seen,
      session: {
        query: (sql, params) => { note(sql, params); return inner.query(sql, params) },
        transaction: (fn) => inner.transaction((tx) => fn({ query: (sql, params) => { note(sql, params); return tx.query(sql, params) } })),
      },
    }
  }

  it('is taken before anything is applied and let go afterwards', async () => {
    const { session, seen } = spy()
    await runMigrations(session, { dir: folder({ '1_a.sql': A, '2_b.sql': B }) })
    expect(seen).toEqual([`lock ${MIGRATE_LOCK}`, 'record', 'record', `unlock ${MIGRATE_LOCK}`])
  })
  it('is let go when a migration fails', async () => {
    const { session, seen } = spy()
    await expect(runMigrations(session, { dir: folder({ '1_a.sql': 'select 1/0' }) })).rejects.toThrow(/1_a\.sql failed/)
    expect(seen).toEqual([`lock ${MIGRATE_LOCK}`, `unlock ${MIGRATE_LOCK}`])
  })
})

describe('the real migrations', () => {
  it('build the same schema as the test helper does, from empty, and the history table is protected like every other table', async () => {
    const r = await runMigrations(pgliteSession(pg))
    const files = readMigrations()
    expect(r.applied).toEqual(files.map((f) => f.file))
    expect(files.at(-1)!.file).toBe('017_read_indexes.sql')
    expect(await versions()).toEqual(files.map((f) => f.version))

    const shape = async (db: PGlite): Promise<string[]> => (await db.query<{ s: string }>(
      `select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable as s from information_schema.columns
        where table_schema = 'public' and table_name <> 'schema_migrations' order by 1`)).rows.map((x) => x.s)
    const indexes = async (db: PGlite): Promise<string[]> => (await db.query<{ i: string }>(
      `select indexname || ' ' || indexdef as i from pg_indexes where schemaname = 'public' and tablename <> 'schema_migrations' order by 1`)).rows.map((x) => x.i)
    const reference = await migratedDb()
    try {
      expect(await shape(pg)).toEqual(await shape(reference))
      expect(await indexes(pg)).toEqual(await indexes(reference))
    } finally { await reference.close() }

    expect((await pg.query<{ f: boolean; r: boolean }>(`select relforcerowsecurity f, relrowsecurity r from pg_class where relname = 'schema_migrations'`)).rows[0]).toEqual({ f: true, r: true })
    expect((await pg.query<{ n: number }>(`select count(*)::int n from information_schema.role_table_grants where table_name = 'schema_migrations' and grantee in ('app_user', 'PUBLIC')`)).rows[0]!.n).toBe(0)
    expect((await runMigrations(pgliteSession(pg))).applied).toEqual([])
  }, 60_000)
})

describe('014: unique names, on a database that already has duplicates', () => {
  const upTo13 = (): string => {
    const d = folder({})
    for (const f of readMigrations().filter((m) => Number(m.version) <= 13)) fs.writeFileSync(path.join(d, f.file), f.sql)
    return d
  }
  const U1 = '00000000-0000-0000-0000-00000000aa01', U2 = 'a2000000-0000-0000-0000-00000000aa02', U3 = 'a3000000-0000-0000-0000-00000000aa03'
  const T1 = '00000000-0000-0000-0000-0000000000f1', T2 = 'f2000000-0000-0000-0000-0000000000f2'

  it('renames the later duplicates (nothing deleted, no id changed), then the index refuses new ones', async () => {
    const dir = upTo13()
    await runMigrations(pgliteSession(pg), { dir })
    await pg.exec(`
      insert into unit (id, name, type) values ('${U1}', 'Unit 1', 'own'), ('${U2}', 'unit 1', 'own'), ('${U3}', 'UNIT 1', 'subcontractor');
      insert into tna_template (id, name, offsets) values ('${T1}', 'Knit tee', '[]'), ('${T2}', 'KNIT TEE', '[]');
      insert into buyer (id, name) values ('00000000-0000-0000-0000-0000000000b1', 'B');
      insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'P', 's', 'c', 1, '2026-12-01');
      insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'sewing', '${U3}', '2026-11-30', 1, 1);`)
    const r = await runMigrations(pgliteSession(pg))                      // the real directory: only 014 is new
    expect(r.applied).toEqual(readMigrations().map((f) => f.file).filter((f) => f >= '014'))   // 014 and everything after it
    expect((await pg.query<{ id: string; name: string }>('select id::text id, name from unit order by id')).rows).toEqual([
      { id: U1, name: 'Unit 1' }, { id: U2, name: 'unit 1 (a2000000)' }, { id: U3, name: 'UNIT 1 (a3000000)' }])
    expect((await pg.query<{ id: string; name: string }>('select id::text id, name from tna_template order by id')).rows).toEqual([
      { id: T1, name: 'Knit tee' }, { id: T2, name: 'KNIT TEE (f2000000)' }])
    expect((await pg.query('select unit_id::text u from milestone')).rows).toEqual([{ u: U3 }])    // still points at the same unit
    await expect(pg.query(`insert into unit (name, type) values ('unit 1', 'own')`)).rejects.toMatchObject({ code: '23505' })
  })

  it('does it as a table owner that is not a superuser, where forced row-level security would otherwise hide every row', async () => {
    const dir = upTo13()
    await runMigrations(pgliteSession(pg), { dir })
    await pg.exec(`
      insert into unit (id, name, type) values ('${U1}', 'Unit 1', 'own'), ('${U2}', 'unit 1', 'own');
      insert into tna_template (id, name, offsets) values ('${T1}', 'Knit tee', '[]'), ('${T2}', 'KNIT TEE', '[]');
      create role mig_owner nosuperuser login;
      grant usage, create on schema public to mig_owner;`)
    for (const t of (await pg.query<{ t: string }>(`select tablename t from pg_tables where schemaname = 'public'`)).rows) await pg.exec(`alter table ${t.t} owner to mig_owner`)
    await pg.exec('set role mig_owner')
    try {
      await runSql(pg, sqlFile('migrations', '014_unique_names.sql'))
    } finally { await pg.exec('reset role') }
    expect((await pg.query<{ name: string }>('select name from unit order by id')).rows.map((x) => x.name)).toEqual(['Unit 1', 'unit 1 (a2000000)'])
    expect((await pg.query<{ name: string }>('select name from tna_template order by id')).rows.map((x) => x.name)).toEqual(['Knit tee', 'KNIT TEE (f2000000)'])
  })

  it('changes nothing on a database without duplicates', async () => {
    await runMigrations(pgliteSession(pg), { dir: upTo13() })
    await pg.exec(`insert into unit (id, name, type) values ('${U1}', 'Unit 1', 'own'), ('${U2}', 'Unit 2', 'own')`)
    await runMigrations(pgliteSession(pg))
    expect((await pg.query<{ name: string }>('select name from unit order by name')).rows.map((x) => x.name)).toEqual(['Unit 1', 'Unit 2'])
  })
})

// Needs a real server. Runs under `npm run test:pg` (TEST_DATABASE_URL set); skipped on PGlite.
describe.skipIf(!usingRealPostgres())('over a real connection', () => {
  const urlFor = (database: string): string => { const u = new URL(requireRealUrl()); u.pathname = `/${database}`; return u.toString() }

  it('applies every migration through pg, records them, and a second run applies nothing', async () => {
    const real = await createRealPg(requireRealUrl())
    try {
      const url = urlFor(real.databaseName)
      const first = await run(url)
      expect(first.applied).toEqual(readMigrations().map((f) => f.file))
      expect((await real.query<{ n: number }>('select count(*)::int n from schema_migrations')).rows[0]!.n).toBe(first.applied.length)
      expect((await run(url)).applied).toEqual([])
    } finally { await real.close() }
  }, 120_000)

  it('two runs started together take turns: every migration is applied exactly once', async () => {
    const real = await createRealPg(requireRealUrl())
    try {
      const url = urlFor(real.databaseName)
      const [a, b] = await Promise.all([run(url), run(url)])
      expect([...a.applied, ...b.applied].sort()).toEqual(readMigrations().map((f) => f.file).sort())
    } finally { await real.close() }
  }, 120_000)
})
