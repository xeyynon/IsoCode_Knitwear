import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ID, RealPg, migratedRealDb, resetAndSeed, runSql, sqlFile, usingRealPostgres } from './helpers.js'

// Only for a real server: `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:pg`.
// Skipped on the default PGlite run. Everything here is something PGlite cannot show: a second
// connection, a connection pool, a role that logs in, and true concurrent transactions.
const real = describe.skipIf(!usingRealPostgres())
const asPg = (r: RealPg) => r as unknown as PGlite

real('real Postgres: the production driver as app_user', () => {
  let pg: RealPg
  beforeAll(async () => { pg = await migratedRealDb() })
  beforeEach(async () => { await resetAndSeed(asPg(pg)) })
  afterAll(async () => { await pg.close() })

  it('is Postgres 16 or newer', () => {
    expect(Math.floor(pg.serverVersionNum / 10_000)).toBeGreaterThanOrEqual(16)
  })

  it('each request acts as app_user: not a superuser, not the owner, and the context is set for the transaction only', async () => {
    const db = pg.db()
    const inside = await db.tx({ role: 'buyer', buyerId: ID.buyerB }, (tx) =>
      tx.query<{ u: string; r: string; b: string }>(`select current_user as u, current_setting('app.role') as r, current_setting('app.buyer_id') as b`))
    expect(inside[0]).toEqual({ u: 'app_user', r: 'buyer', b: ID.buyerB })
    // Nothing leaks to the next user of a pooled connection: after commit set_config(..., true) is gone.
    const after = await Promise.all(Array.from({ length: 8 }, () =>
      pg.appPool.query<{ r: string | null }>(`select current_setting('app.role', true) as r`)))
    for (const a of after) expect(a.rows[0]!.r ?? '').toBe('')
    // And with no context at all the schema fails closed.
    const none = await pg.appPool.query<{ n: number }>(`select count(*)::int as n from orders`)
    expect(none.rows[0]!.n).toBe(0)
  })

  it('a buyer sees only their own orders over a real connection', async () => {
    const rows = await pg.db().tx({ role: 'buyer', buyerId: ID.buyerB }, (tx) => tx.query<{ po: string }>(`select po from orders order by po`))
    expect(rows.map((r) => r.po)).toEqual(['B-PO-88213', 'B-PO-88240'])
  })

  it('a failed transaction rolls back completely', async () => {
    await expect(pg.db().tx({ role: 'merchandiser' }, async (tx) => {
      await tx.query(`insert into buyer (name) values ('rolled back')`)
      throw new Error('boom')
    })).rejects.toThrow('boom')
    expect((await pg.query(`select 1 from buyer where name = 'rolled back'`)).rows).toHaveLength(0)
  })

  it('two sends of the same client_uuid at the same moment store one row (unique index, real concurrency)', async () => {
    const id = randomUUID()
    const send = () => pg.db().tx({ role: 'supervisor', unitId: ID.unit1 }, (tx) => tx.query(
      `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
       values ($1, $2, $3, 'sewing', $4, '2026-11-04', 5) on conflict (client_uuid) do nothing returning id::text as id`,
      [id, ID.orderRed, ID.buyerB, ID.unit1]))
    const results = await Promise.all([send(), send(), send(), send()])
    expect(results.filter((r) => r.length === 1)).toHaveLength(1)
    expect((await pg.query(`select 1 from update_event where client_uuid = $1`, [id])).rows).toHaveLength(1)
  })

  it('without on conflict the loser of the race gets 23505, which a service must treat as "already stored"', async () => {
    const id = randomUUID()
    const send = () => pg.db().tx({ role: 'supervisor', unitId: ID.unit1 }, (tx) => tx.query(
      `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
       values ($1, $2, $3, 'sewing', $4, '2026-11-04', 5)`, [id, ID.orderRed, ID.buyerB, ID.unit1]))
    const settled = await Promise.allSettled([send(), send(), send()])
    expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1)
    for (const s of settled) if (s.status === 'rejected') expect((s.reason as { code?: string }).code).toBe('23505')
  })

  it('one unresolved warning per stage holds when two refreshes insert at once', async () => {
    const open = () => pg.db().tx({ role: 'system' }, (tx) => tx.query(
      `insert into warning (order_id, buyer_id, stage, status, maths) values ($1, $2, 'sewing', 'red', '{}'::jsonb)
       on conflict (order_id, stage) where resolved_at is null do nothing returning id::text as id`, [ID.orderRed, ID.buyerB]))
    const results = await Promise.all([open(), open(), open()])
    expect(results.filter((r) => r.length === 1)).toHaveLength(1)
    expect((await pg.query(`select 1 from warning where order_id = $1 and resolved_at is null`, [ID.orderRed])).rows).toHaveLength(1)
  })

  it('the append-only triggers hold for the owner session too', async () => {
    await expect(pg.exec(`update date_change set reason = 'edited'`)).resolves.toBeUndefined() // no rows yet
    await pg.exec(`insert into date_change (entity, entity_id, field, old, new, reason, user_id)
                   values ('orders', '${ID.orderRed}', 'ex_factory', 'a', 'b', 'because', '${ID.merch}')`)
    await expect(pg.exec(`update date_change set reason = 'edited'`)).rejects.toThrow(/append-only/)
    await expect(pg.exec(`delete from update_event`)).rejects.toThrow(/append-only/)
  })
})

// The same two checks as rls.test.ts, which runs them on PGlite only.
real('real Postgres: migrations and row-level security as a plain table owner', () => {
  it('every migration applies as a non-superuser owner, and the tables are owned by that role', async () => {
    const pg = await migratedRealDb({ asOwner: true })
    try {
      // As a plain owner FORCE RLS binds this session too, so a bare `select` from settings sees no rows; read the catalog instead.
      const owners = await pg.query<{ super: boolean; forced: boolean }>(`select r.rolsuper as super, c.relforcerowsecurity as forced from pg_class c join pg_roles r on r.oid = c.relowner where c.relname = 'orders'`)
      expect(owners.rows).toEqual([{ super: false, forced: true }])
      expect((await pg.query(`select to_regclass('public.account_audit')::text as t`)).rows).toEqual([{ t: 'account_audit' }])
    } finally { await pg.close() }
  })

  it('db/tests/rls.test.sql passes as the superuser', async () => {
    const pg = await migratedRealDb()
    try { await runSql(pg, sqlFile('tests', 'rls.test.sql')) } finally { await pg.close() }
  })

  it('db/tests/rls.test.sql passes as a non-superuser table owner (FORCE RLS binds it)', async () => {
    const pg = await migratedRealDb({ asOwner: true })
    try { await runSql(pg, sqlFile('tests', 'rls.test.sql')) } finally { await pg.close() }
  })
})
