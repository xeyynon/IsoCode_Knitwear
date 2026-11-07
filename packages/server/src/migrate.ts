// The migration runner: `npm run migrate` (DATABASE_URL, as the table OWNER, not as app_user).
//
//  - reads packages/server/db/migrations/NNN_name.sql in numeric order;
//  - keeps schema_migrations (version, name, applied_at, checksum): what has been applied, and the sha256 of the file when it was;
//  - runs each migration that has not been applied in its OWN transaction, as one multi-statement query, and records it in the same
//    transaction: a migration is applied completely or not at all, and a failure records nothing;
//  - refuses to go on if a migration that was already applied has since been edited (its checksum changed): change the schema with a
//    new migration, never by editing an old one;
//  - holds a Postgres advisory lock for the whole run, so two deploys started together take turns instead of racing.
//
// The logic works on a small session ({ query, transaction }) so the same code runs over a pg connection in production and over PGlite in
// the tests. `query` with no parameters may carry several statements (a whole file); with parameters it is one statement.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

export interface Sql {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}
export interface MigrationSession extends Sql {
  /** begin, run fn, commit; roll back if fn throws. Everything fn runs through the given Sql is one transaction. */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>
}

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')
/** One number for every run of this runner on a database: a second one waits here until the first has finished. */
export const MIGRATE_LOCK = 7_270_014

export interface MigrationFile { version: string; name: string; file: string; sql: string; checksum: string }
export interface MigrateResult {
  /** The files applied by this run, in order (for example "014_unique_names.sql"). Empty when the database was already up to date. */
  applied: string[]
  /** How many were already applied and unchanged. */
  alreadyApplied: number
  /** Applied earlier but no longer among the files (an older release is deploying over a newer database). Reported, not an error. */
  missing: string[]
}
export interface MigrateOptions { dir?: string; log?: (line: string) => void }

/** sha256 of the file with line endings normalised, so a checkout with CRLF (Windows) and one with LF (Linux) agree. */
export const checksumOf = (sql: string): string => createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')

/** The migration files in numeric order. A .sql file whose name is not NNN_name.sql, or a number used twice, is an error. */
export function readMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const out: MigrationFile[] = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.sql')) continue
    const m = /^(\d+)_([A-Za-z0-9_-]+)\.sql$/.exec(file)
    if (!m) throw new Error(`Migration file "${file}" is not named like 014_what_it_does.sql`)
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    out.push({ version: m[1]!, name: m[2]!, file, sql, checksum: checksumOf(sql) })
  }
  out.sort((a, b) => Number(a.version) - Number(b.version))
  for (let i = 1; i < out.length; i++) {
    if (Number(out[i]!.version) === Number(out[i - 1]!.version)) throw new Error(`Two migrations use the number ${out[i]!.version}: ${out[i - 1]!.file} and ${out[i]!.file}`)
  }
  return out
}

// The table is created with the same protection as every other table here: row-level security forced, so the
// "every table has RLS forced" check holds for it too; only the role that runs the migrations may use it, and nobody else is granted anything.
const CREATE_TABLE = `
create table schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now(),
  checksum text not null
);
alter table schema_migrations enable row level security;
alter table schema_migrations force row level security;
create policy runner_only on schema_migrations for all to current_user using (true) with check (true);
revoke all on schema_migrations from public`

// 001 grants app_user everything on "all tables in schema public", which includes this table when it already exists (it is
// created first). Take that back after every migration, in the same transaction. The forced policy above would hide the rows anyway.
const REVOKE_APP_USER = `
do $$ begin
  if exists (select from pg_roles where rolname = 'app_user') then
    revoke all on schema_migrations from app_user;
  end if;
end $$`

/** Apply every migration that has not been applied. See the top of the file for the rules. */
export async function runMigrations(session: MigrationSession, opts: MigrateOptions = {}): Promise<MigrateResult> {
  const log = opts.log ?? (() => undefined)
  const files = readMigrations(opts.dir)
  await session.query('select pg_advisory_lock($1)', [MIGRATE_LOCK])
  try {
    if (!(await session.query<{ t: string | null }>(`select to_regclass('public.schema_migrations')::text as t`))[0]?.t) {
      await session.transaction((tx) => tx.query(CREATE_TABLE))
    }
    const applied = await session.query<{ version: string; name: string; checksum: string }>('select version, name, checksum from schema_migrations')
    if (!applied.length && (await session.query<{ t: string | null }>(`select to_regclass('public.buyer')::text as t`))[0]?.t) {
      throw new Error('This database already has the application tables but no migration history (schema_migrations is empty). '
        + 'Run the migrations on an empty database, or record the ones already applied by hand before running this.')
    }
    const byVersion = new Map(applied.map((a) => [Number(a.version), a]))
    const known = new Set(files.map((f) => Number(f.version)))
    for (const f of files) {
      const done = byVersion.get(Number(f.version))
      if (done && done.checksum !== f.checksum) {
        throw new Error(`Migration ${f.file} was already applied, but the file has changed since (it was ${done.checksum.slice(0, 12)}, it is now ${f.checksum.slice(0, 12)}). `
          + 'Never edit a migration that has been applied: put the change in a new migration.')
      }
    }
    const pending = files.filter((f) => !byVersion.has(Number(f.version)))
    const newest = Math.max(0, ...byVersion.keys())
    const late = pending.find((f) => Number(f.version) < newest)
    if (late) throw new Error(`Migration ${late.file} has not been applied, but a newer one (${String(newest).padStart(3, '0')}) has. Migrations must be applied in order; renumber it after the newest.`)
    const missing = applied.filter((a) => !known.has(Number(a.version))).map((a) => `${a.version}_${a.name}.sql`)

    const done: string[] = []
    for (const f of pending) {
      try {
        await session.transaction(async (tx) => {
          await tx.query(f.sql)
          await tx.query('insert into schema_migrations (version, name, checksum) values ($1, $2, $3)', [f.version, f.name, f.checksum])
          await tx.query(REVOKE_APP_USER)
        })
      } catch (e) {
        throw new Error(`Migration ${f.file} failed and was rolled back (nothing of it was kept or recorded): ${(e as Error).message}`, { cause: e })
      }
      done.push(f.file)
      log(`applied ${f.file}`)
    }
    return { applied: done, alreadyApplied: files.length - pending.length, missing }
  } finally {
    await session.query('select pg_advisory_unlock($1)', [MIGRATE_LOCK]).catch(() => undefined)   // also released when the connection closes
  }
}

// ---------------------------------------------------------------- over a real connection

/** One pg connection as a session. The lock and the transactions are per connection, so all of it must be on this one client. */
export function pgSession(client: pg.Client | pg.PoolClient): MigrationSession {
  const q = async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
    const r = await client.query(sql, params as never)   // no parameters: the simple protocol, which accepts several statements
    return ((Array.isArray(r) ? r[r.length - 1] : r)?.rows ?? []) as T[]
  }
  return {
    query: q,
    async transaction(fn) {
      await client.query('begin')
      try { const out = await fn({ query: q }); await client.query('commit'); return out }
      catch (e) { await client.query('rollback').catch(() => undefined); throw e }
    },
  }
}

const redact = (url: string): string => { try { const u = new URL(url); if (u.password) u.password = '***'; return u.toString() } catch { return '(unreadable connection string)' } }

/** Run the migrations against a database URL, or over a pool/client you already have. Connect as the table owner. */
export async function run(target: string | pg.Pool | pg.Client, opts: MigrateOptions = {}): Promise<MigrateResult> {
  if (target instanceof pg.Pool) {
    const client = await target.connect()
    try { return await runMigrations(pgSession(client), opts) } finally { client.release() }
  }
  if (typeof target !== 'string') return runMigrations(pgSession(target), opts)
  const client = new pg.Client({ connectionString: target })
  client.on('error', () => undefined)   // a dropped connection surfaces through the query that was waiting on it
  try { await client.connect() } catch (e) { throw new Error(`Could not connect to ${redact(target)}: ${(e as Error).message}`) }
  try { return await runMigrations(pgSession(client), opts) } finally { await client.end().catch(() => undefined) }
}

// ---------------------------------------------------------------- command line: tsx packages/server/src/migrate.ts

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    console.error('DATABASE_URL is not set. Set it to the connection string of the table OWNER (not app_user), for example postgres://owner:password@host:5432/dbname')
    process.exit(1)
  }
  run(url, { log: (line) => console.log(line) }).then((r) => {
    console.log(r.applied.length ? `${r.applied.length} applied, ${r.alreadyApplied} already applied.` : `Up to date: ${r.alreadyApplied} migrations already applied, nothing to do.`)
    if (r.missing.length) console.warn(`Warning: applied in this database but not among these files: ${r.missing.join(', ')}`)
  }).catch((e: unknown) => {
    console.error((e as Error).message)
    process.exit(1)
  })
}
