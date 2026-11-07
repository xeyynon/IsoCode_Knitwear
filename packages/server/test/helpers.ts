import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import pgDriver from 'pg'
import { hashSecret } from '../src/auth.js'
import { CONTEXT_SQL, contextParams, type Db } from '../src/db.js'
import { pgDb } from '../src/pgDb.js'

const DB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db')

/**
 * Split SQL the way psql does: on ';' outside quotes, comments and $$ bodies.
 * PGlite's exec() would otherwise wrap a multi-statement string in one implicit
 * transaction, so a later ROLLBACK would undo earlier DDL.
 */
export function statements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!
    if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; cur += '\n'; continue }
    if (c === "'") { const j = sql.indexOf("'", i + 1); const end = j === -1 ? sql.length : j; cur += sql.slice(i, end + 1); i = end; continue }
    if (c === '$' && sql[i + 1] === '$') { const j = sql.indexOf('$$', i + 2); const end = j === -1 ? sql.length : j + 1; cur += sql.slice(i, end + 1); i = end; continue }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export const sqlFile = (...parts: string[]): string =>
  fs.readFileSync(path.join(DB_DIR, ...parts), 'utf8').split('\n').filter((l) => !l.startsWith('\\')).join('\n')

export async function runSql(pg: { exec(sql: string): Promise<unknown> }, sql: string): Promise<void> {
  for (const stmt of statements(sql)) {
    try { await pg.exec(stmt) } catch (e) { throw new Error(`${(e as Error).message}\n  in: ${stmt.split('\n')[0]!.slice(0, 100)}`) }
  }
}

// ------------------------------------------------------------------ which database the tests run on
//
// Default: PGlite (Postgres in WebAssembly), in process, nothing to install.
// TEST_DATABASE_URL set: a REAL Postgres server. Point it at a SUPERUSER connection string for a
// disposable server, for example  postgres://postgres:postgres@localhost:5432/postgres . Every
// migratedDb() then creates its own uniquely named database on that server (isotest_...), applies the
// migrations with the same runSql the PGlite path uses, and drops the database again on close(). The
// app's Db is the production driver (pgDb.ts over a pg.Pool) connected AS app_user, exactly as
// DATABASE_URL does in production, so no `set local role` is needed there. Run it with `npm run test:pg`.
// The cluster-wide role app_user is created (its password reset) on that server: never point this at
// a server you care about.

export const TEST_DATABASE_URL_ENV = 'TEST_DATABASE_URL'

export type Backend = { kind: 'pglite' } | { kind: 'postgres'; url: string }

/** A connection string with the password hidden, safe to put in an error message. */
function redact(raw: string): string {
  try { const u = new URL(raw); if (u.password) u.password = '***'; return u.toString() } catch { return raw.replace(/:[^:@/]*@/, ':***@') }
}

/** Pure: which database do the tests use? Unset or blank means PGlite. A bad URL is an error, never a silent fallback. */
export function selectBackend(env: Record<string, string | undefined> = process.env): Backend {
  const raw = env[TEST_DATABASE_URL_ENV]?.trim()
  if (!raw) return { kind: 'pglite' }
  let u: URL
  try { u = new URL(raw) } catch {
    throw new Error(`${TEST_DATABASE_URL_ENV} is set but is not a connection string (${redact(raw)}). Expected postgres://user:password@host:5432/database for a superuser on an empty, disposable server; unset it to use PGlite.`)
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new Error(`${TEST_DATABASE_URL_ENV} must start with postgres:// or postgresql:// (got ${u.protocol}//). Unset it to use PGlite.`)
  }
  if (!u.hostname && !u.searchParams.get('host')) {
    throw new Error(`${TEST_DATABASE_URL_ENV} has no host (${redact(raw)}). Expected postgres://user:password@host:5432/database.`)
  }
  return { kind: 'postgres', url: raw }
}

/** The server URL the real-Postgres tests need; throws the clear error when the switch is off. */
export function requireRealUrl(): string {
  const b = selectBackend()
  if (b.kind !== 'postgres') throw new Error(`${TEST_DATABASE_URL_ENV} is not set: these tests need a real Postgres 16 (see npm run test:pg).`)
  return b.url
}

export const usingRealPostgres = (): boolean => selectBackend().kind === 'postgres'

const APP_USER_PASSWORD = 'app_user_test_only'
const OWNER_PASSWORD = 'owner_role_test_only'
const ROLE_LOCK = 727_001   // serialises the cluster-wide role setup across test files running in parallel

/** The result shapes the tests read from PGlite: int8 as a number, a date as a Date at UTC midnight. */
const pgliteLikeTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (oid === 20) return (s: string) => { const n = BigInt(s); return n < BigInt(Number.MIN_SAFE_INTEGER) || n > BigInt(Number.MAX_SAFE_INTEGER) ? n : Number(n) }
    if (oid === 1082) return (s: string) => new Date(`${s}T00:00:00Z`)
    return pgDriver.types.getTypeParser(oid as never, format as never)
  },
}

/**
 * The slice of PGlite's API the tests use (query, exec, transaction, close), over ONE session on a real
 * server, so `begin; ...; commit;` sent as separate statements stays in one transaction like on PGlite.
 * Tests are typed against PGlite; migratedDb() hands this object out through that type.
 * `appPool` is the production path: a pool logged in as app_user, driven by pgDb.ts.
 */
export class RealPg {
  private appDb: Db | undefined
  constructor(
    readonly databaseName: string,
    readonly serverVersionNum: number,
    private readonly session: pgDriver.Client,
    readonly appPool: pgDriver.Pool,
    private readonly teardown: () => Promise<void>,
  ) {}

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows: number }> {
    const r = await this.session.query(sql, params)
    return { rows: r.rows as T[], affectedRows: r.rowCount ?? 0 }
  }
  /** Simple protocol: several statements in one string run as one implicit transaction, as on PGlite. */
  async exec(sql: string): Promise<void> { await this.session.query(sql) }
  async transaction<T>(fn: (t: { query: RealPg['query'] }) => Promise<T>): Promise<T> {
    await this.session.query('begin')
    try { const out = await fn({ query: (s, p) => this.query(s, p) }); await this.session.query('commit'); return out }
    catch (e) { await this.session.query('rollback').catch(() => undefined); throw e }
  }
  /** The production Db (pgDb over app_user's pool), made once so its pool error listener is added once. */
  db(): Db { return (this.appDb ??= pgDb(this.appPool)) }
  async close(): Promise<void> { await this.teardown() }
}

const withDatabase = (raw: string, database: string, user?: string, password?: string): string => {
  const u = new URL(raw)
  u.pathname = `/${database}`
  if (user) { u.username = user; u.password = password ?? '' }
  return u.toString()
}

let counter = 0

/**
 * A fresh, empty, uniquely named database on the server in TEST_DATABASE_URL (not migrated yet).
 * `asOwner`: the session is a plain table owner (not a superuser, so FORCE RLS binds it), as on
 * managed Postgres; the default session is the superuser, like PGlite.
 */
export async function createRealPg(url: string, opts: { asOwner?: boolean } = {}): Promise<RealPg> {
  const admin = new pgDriver.Client({ connectionString: url })
  admin.on('error', () => undefined)
  try { await admin.connect() } catch (e) {
    throw new Error(`${TEST_DATABASE_URL_ENV} is set but the server did not accept the connection (${redact(url)}): ${(e as Error).message}`)
  }
  const suffix = `${process.pid}_${Date.now().toString(36)}_${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const name = `isotest_${suffix}`
  const ownerRole = `isoowner_${suffix}`
  const opened: Array<{ end(): Promise<void> }> = []
  try {
    const { rows: [who] } = await admin.query<{ super: boolean; v: string }>(
      `select rolsuper as super, current_setting('server_version_num') as v from pg_roles where rolname = current_user`)
    if (!who?.super) throw new Error(`${TEST_DATABASE_URL_ENV} must connect as a superuser: the tests create databases and roles (${redact(url)}).`)
    await admin.query('select pg_advisory_lock($1)', [ROLE_LOCK])
    try {
      await admin.query(`do $$ begin if not exists (select from pg_roles where rolname = 'app_user') then create role app_user nologin; end if; end $$`)
      await admin.query(`alter role app_user login password '${APP_USER_PASSWORD}'`)
      if (opts.asOwner) {
        await admin.query(`create role ${ownerRole} nosuperuser createrole login password '${OWNER_PASSWORD}'`)
        await admin.query(`grant app_user to ${ownerRole}`)
      }
    } finally { await admin.query('select pg_advisory_unlock($1)', [ROLE_LOCK]) }
    await admin.query(`create database ${name}${opts.asOwner ? ` owner ${ownerRole}` : ''}`)

    const session = new pgDriver.Client({
      connectionString: opts.asOwner ? withDatabase(url, name, ownerRole, OWNER_PASSWORD) : withDatabase(url, name),
      types: pgliteLikeTypes as never,
    })
    session.on('error', () => undefined)
    await session.connect()
    opened.push({ end: () => session.end() })
    const appPool = new pgDriver.Pool({ connectionString: withDatabase(url, name, 'app_user', APP_USER_PASSWORD), max: 4 })
    opened.push({ end: () => appPool.end() })

    const teardown = async () => {
      await appPool.end().catch(() => undefined)
      await session.end().catch(() => undefined)
      try {
        await admin.query(`drop database if exists ${name} with (force)`)
        if (opts.asOwner) await admin.query(`drop role if exists ${ownerRole}`)
      } finally { await admin.end().catch(() => undefined) }
    }
    return new RealPg(name, Number(who.v), session, appPool, teardown)
  } catch (e) {
    for (const o of opened) await o.end().catch(() => undefined)
    await admin.query(`drop database if exists ${name} with (force)`).catch(() => undefined)
    if (opts.asOwner) await admin.query(`drop role if exists ${ownerRole}`).catch(() => undefined)
    await admin.end().catch(() => undefined)
    throw e
  }
}

const migrationFiles = (): string[] => fs.readdirSync(path.join(DB_DIR, 'migrations')).sort()

/** A real-Postgres database with every migration applied, optionally as a non-superuser owner. */
export async function migratedRealDb(opts: { asOwner?: boolean } = {}): Promise<RealPg> {
  const real = await createRealPg(requireRealUrl(), opts)
  try { for (const f of migrationFiles()) await runSql(real, sqlFile('migrations', f)) }
  catch (e) { await real.close().catch(() => undefined); throw e }
  return real
}

/**
 * An empty database with every migration applied. PGlite is a superuser, so fixtures bypass RLS.
 * With TEST_DATABASE_URL set it is a fresh database on that real server instead (see above).
 */
export async function migratedDb(): Promise<PGlite> {
  if (usingRealPostgres()) return (await migratedRealDb()) as unknown as PGlite
  const pg = new PGlite()
  for (const f of migrationFiles()) await runSql(pg, sqlFile('migrations', f))
  return pg
}

/**
 * The app's Db interface. Each call acts as the non-owner app_user, like production: on PGlite by
 * `set local role app_user`, on a real server through the production pgDb driver logged in as app_user.
 */
export function pgliteDb(pg: PGlite): Db {
  if ((pg as unknown) instanceof RealPg) return (pg as unknown as RealPg).db()
  return {
    tx: (ctx, fn) =>
      pg.transaction(async (t) => {
        await t.query('set local role app_user')
        await t.query(CONTEXT_SQL, contextParams(ctx))
        return fn({ query: async (sql, params) => (await t.query(sql, params)).rows as never })
      }),
  }
}

export const ID = {
  buyerB: '00000000-0000-0000-0000-0000000000b1',
  buyerC: '00000000-0000-0000-0000-0000000000c1',
  unit1: '00000000-0000-0000-0000-00000000aa01',
  unit2: '00000000-0000-0000-0000-00000000aa02',
  orderRed: '00000000-0000-0000-0000-0000000000d1',    // B-PO-88240: making 350/day, needs 467
  orderGreen: '00000000-0000-0000-0000-0000000000d2',  // C-PO-0488: making 500/day on unit 2
  orderNew: '00000000-0000-0000-0000-0000000000d3',    // B-PO-88213: set up, nothing sent yet
  merch: '00000000-0000-0000-0000-0000000000ee',
  sup1: '00000000-0000-0000-0000-0000000000ef',
}
export const TEMPLATE_ID = '00000000-0000-0000-0000-0000000000f1'
export const CREDS = { email: 'm@example.test', password: 'correct horse battery', phone: '98765 43210', pin: '4321' }
export const TODAY = '2026-11-04' // a Wednesday; Sundays 1 and 8 Nov closed

/**
 * Illustrative data built to match the figures quoted in the build plan. These are
 * NOT the companion brief's sample POs, which are not in the repo yet.
 */
export async function seed(pg: PGlite): Promise<void> {
  await pg.exec(`
    insert into buyer (id, name, country) values ('${ID.buyerB}', 'Buyer B', 'DE'), ('${ID.buyerC}', 'Buyer C', 'FR');
    insert into unit (id, name, type) values ('${ID.unit1}', 'Unit 1', 'own'), ('${ID.unit2}', 'Unit 2', 'own');
    insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values
      ('${ID.orderRed}',   '${ID.buyerB}', 'B-PO-88240', 'tee', 'navy', 4550, '2026-11-20'),
      ('${ID.orderGreen}', '${ID.buyerC}', 'C-PO-0488',  'tee', 'red',  5300, '2026-11-20'),
      ('${ID.orderNew}',   '${ID.buyerB}', 'B-PO-88213', 'tee', 'grey', 3000, '2026-11-25');
    insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty) values
      ('${ID.orderRed}',   '${ID.buyerB}', 'sewing', '${ID.unit1}', '2026-11-11', 1, 4550),
      ('${ID.orderGreen}', '${ID.buyerC}', 'sewing', '${ID.unit2}', '2026-11-11', 1, 5300),
      ('${ID.orderNew}',   '${ID.buyerB}', 'sewing', '${ID.unit1}', '2026-11-20', 1, 3000);
  `)
  await pg.query(`insert into account (id, role, email, password_hash) values ($1, 'merchandiser', $2, $3)`, [ID.merch, CREDS.email, hashSecret(CREDS.password)])
  await pg.query(`insert into account (id, role, phone, pin_hash, unit_id) values ($1, 'supervisor', '9876543210', $2, $3)`, [ID.sup1, hashSecret(CREDS.pin), ID.unit1])
  await pg.query(`insert into tna_template (id, name, offsets) values ($1, 'Knit tee', $2::jsonb)`, [TEMPLATE_ID, JSON.stringify([
    { stage: 'cutting', sequence: 1, working_days_before: 12, unit_id: ID.unit1 },
    { stage: 'sewing', sequence: 2, working_days_before: 6, unit_id: ID.unit1 },
    { stage: 'finishing', sequence: 3, working_days_before: 2, unit_id: ID.unit1 },
    { stage: 'packing', sequence: 4, working_days_before: 0, unit_id: ID.unit1 },
  ])])
  const days = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03']
  for (const [order, buyer, unit, qty] of [
    [ID.orderRed, ID.buyerB, ID.unit1, 350],
    [ID.orderGreen, ID.buyerC, ID.unit2, 500],
  ] as const) {
    for (const d of days) {
      await pg.query(
        `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
         values (gen_random_uuid(), $1, $2, 'sewing', $3, $4, $5)`,
        [order, buyer, unit, d, qty],
      )
    }
  }
}

const DATA_TABLES = ['update_event', 'photo', 'note', 'warning', 'date_change', 'buyer_link', 'outbox',
  'calendar_day', 'milestone', 'orders', 'tna_template', 'account', 'unit', 'buyer']

/** Wipe every data table (as the superuser; truncate skips the append-only triggers), restore default settings, seed. */
export async function resetAndSeed(pg: PGlite): Promise<void> {
  await pg.exec(`truncate ${DATA_TABLES.join(', ')} cascade`)
  await pg.exec(`update settings set value = '0.9' where key = 'red_below'`)
  await seed(pg)
}
