import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { hashSecret } from '../src/auth.js'
import { CONTEXT_SQL, contextParams, type Db } from '../src/db.js'

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

export async function runSql(pg: PGlite, sql: string): Promise<void> {
  for (const stmt of statements(sql)) {
    try { await pg.exec(stmt) } catch (e) { throw new Error(`${(e as Error).message}\n  in: ${stmt.split('\n')[0]!.slice(0, 100)}`) }
  }
}

/** An empty database with every migration applied. PGlite is a superuser, so fixtures bypass RLS. */
export async function migratedDb(): Promise<PGlite> {
  const pg = new PGlite()
  for (const f of fs.readdirSync(path.join(DB_DIR, 'migrations')).sort()) await runSql(pg, sqlFile('migrations', f))
  return pg
}

/** The app's Db interface over PGlite. Each call acts as the non-owner app_user, like production. */
export function pgliteDb(pg: PGlite): Db {
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
