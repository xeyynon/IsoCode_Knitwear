// Fix lane D: row-level security and migration 016 (BE-036, BE-037, BE-039, BE-040).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readMigrations, runMigrations, type MigrationSession, type Sql } from '../src/migrate.js'
import { ID, migratedDb, pgliteDb, resetAndSeed, runSql, sqlFile } from './helpers.js'

// PGlite as a MigrationSession (the same adapter migrate.test.ts uses)
type Runner = { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>; exec(sql: string): Promise<Array<{ rows: unknown[] }>> }
const wrap = (x: Runner): Sql['query'] => (async (sql: string, params?: unknown[]) =>
  (params === undefined ? ((await x.exec(sql)).at(-1)?.rows ?? []) : (await x.query(sql, params)).rows)) as Sql['query']
const pgliteSession = (pg: PGlite): MigrationSession => ({
  query: wrap(pg as unknown as Runner),
  transaction: (fn) => pg.transaction((t) => fn({ query: wrap(t as unknown as Runner) })),
})

describe('supervisor writes (policies recreated by 016)', () => {
  let pg: PGlite
  beforeAll(async () => { pg = await migratedDb() })
  beforeEach(async () => { await resetAndSeed(pg) })
  afterAll(async () => { await pg.close() })

  const SUP2 = '00000000-0000-0000-0000-0000000000f2'
  const asSup = (sql: string, params: unknown[] = []) =>
    pgliteDb(pg).tx({ role: 'supervisor', unitId: ID.unit1 }, (tx) => tx.query(sql, params))
  const KEY = 'photos/6f1c2a3b-0000-4000-8000-000000000001.jpg'
  const photo = (cols: string, vals: string, params: unknown[] = []) => asSup(
    `insert into photo (order_id, buyer_id, stage, unit_id, storage_key${cols}) values ($1, $2, 'sewing', $3, $4${vals})`,
    [ID.orderRed, ID.buyerB, ID.unit1, KEY, ...params])
  const note = (cols: string, vals: string, params: unknown[] = []) => asSup(
    `insert into note (order_id, buyer_id, stage, unit_id, text_en${cols}) values ($1, $2, 'sewing', $3, 'x'${vals})`,
    [ID.orderRed, ID.buyerB, ID.unit1, ...params])
  const event = (cols: string, vals: string, params: unknown[] = []) => asSup(
    `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty${cols})
     values (gen_random_uuid(), $1, $2, 'sewing', $3, '2026-11-04', 5${vals})`,
    [ID.orderRed, ID.buyerB, ID.unit1, ...params])

  describe('BE-036: a supervisor cannot skip the photo review or name any file', () => {
    it('BE-036: an ordinary photo upload is still accepted', async () => {
      await expect(photo('', '')).resolves.toBeDefined()
      await expect(photo(', client_uuid, taken_on, bytes', ', gen_random_uuid(), $5, 1200', ['2026-11-04'])).resolves.toBeDefined()
    })
    it('BE-036: refuses a photo that is already approved', async () => {
      await expect(photo(', approved_by, approved_at', ', $5, now()', [ID.merch])).rejects.toThrow(/row-level security/)
      await expect(photo(', approved_by', ', $5', [ID.merch])).rejects.toThrow(/row-level security/)
      await expect(photo(', approved_at', ', now()')).rejects.toThrow(/row-level security/)
    })
    it('BE-036: refuses a photo that is already rejected or purged', async () => {
      await expect(photo(', rejected_at', ', now()')).rejects.toThrow(/row-level security/)
      await expect(photo(', purged_at', ', now()')).rejects.toThrow(/row-level security/)
    })
    it.each(['k', 'other/x.jpg', 'photos/', 'photos/a/b.jpg', 'photos/../x.jpg', '/photos/x.jpg', 'PHOTOS/x.jpg', 'photos/x y.jpg'])(
      'BE-036: refuses the storage key %j', async (key) => {
        await expect(asSup(`insert into photo (order_id, buyer_id, stage, unit_id, storage_key) values ($1, $2, 'sewing', $3, $4)`,
          [ID.orderRed, ID.buyerB, ID.unit1, key])).rejects.toThrow(/row-level security/)
      })
    it('BE-036: a merchandiser can still write any of those (the review itself)', async () => {
      await expect(pgliteDb(pg).tx({ role: 'merchandiser' }, (tx) => tx.query(
        `insert into photo (order_id, buyer_id, stage, unit_id, storage_key, approved_by, approved_at) values ($1, $2, 'sewing', $3, 'any-key', $4, now())`,
        [ID.orderRed, ID.buyerB, ID.unit1, ID.merch]))).resolves.toBeDefined()
    })
    it('BE-036: the earlier stage binding still holds (another unit, another buyer, no stage)', async () => {
      await expect(asSup(`insert into photo (order_id, buyer_id, stage, unit_id, storage_key) values ($1, $2, 'sewing', $3, $4)`,
        [ID.orderGreen, ID.buyerC, ID.unit2, KEY])).rejects.toThrow(/row-level security/)
      await expect(asSup(`insert into photo (order_id, buyer_id, unit_id, storage_key) values ($1, $2, $3, $4)`,
        [ID.orderRed, ID.buyerB, ID.unit1, KEY])).rejects.toThrow(/row-level security/)
    })
  })

  describe('BE-037: a supervisor cannot forge who confirmed a note or who entered a count', () => {
    it('BE-037: an ordinary note is still accepted, with or without a reason chosen by the supervisor', async () => {
      await expect(note('', '')).resolves.toBeDefined()
      await expect(note(', category, category_by, language', `, 'machine', 'supervisor', 'en'`)).resolves.toBeDefined()
    })
    it('BE-037: refuses a note that is already confirmed', async () => {
      await expect(note(', confirmed_by, confirmed_at', ', $4, now()', [ID.merch])).rejects.toThrow(/row-level security/)
      await expect(note(', confirmed_by', ', $4', [ID.merch])).rejects.toThrow(/row-level security/)
      await expect(note(', confirmed_at', ', now()')).rejects.toThrow(/row-level security/)
    })
    it('BE-037: refuses a note whose reason claims a merchandiser chose it', async () => {
      await expect(note(`, category, category_by`, `, 'machine', 'merchandiser'`)).rejects.toThrow(/row-level security/)
    })
    it('BE-037: an ordinary count is accepted, and carries its own supervisor as entered_by (what the service sends)', async () => {
      await expect(event('', '')).resolves.toBeDefined()
      await expect(event(', entered_by', ', $4', [ID.sup1])).resolves.toBeDefined()
    })
    it('BE-037: refuses a count that names a merchandiser, another unit\'s supervisor, or nobody real as the person who entered it', async () => {
      await pg.query(`insert into account (id, role, phone, pin_hash, unit_id) values ($1, 'supervisor', '9000000002', 'x', $2)`, [SUP2, ID.unit2])
      await expect(event(', entered_by', ', $4', [ID.merch])).rejects.toThrow(/row-level security/)
      await expect(event(', entered_by', ', $4', [SUP2])).rejects.toThrow(/row-level security/)
    })
    it('BE-037: refuses a count with a made-up arrival time', async () => {
      await expect(event(', received_at', `, '2020-01-01'`)).rejects.toThrow(/row-level security/)
      await expect(event(', received_at', `, now() + interval '1 hour'`)).rejects.toThrow(/row-level security/)
      await expect(event(', received_at', `, now()`)).resolves.toBeDefined()
    })
    it('BE-037: a merchandiser can still enter a count on behalf, naming themselves', async () => {
      await expect(pgliteDb(pg).tx({ role: 'merchandiser' }, (tx) => tx.query(
        `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty, on_behalf, entered_by)
         values (gen_random_uuid(), $1, $2, 'sewing', $3, '2026-11-04', 5, true, $4)`, [ID.orderRed, ID.buyerB, ID.unit1, ID.merch]))).resolves.toBeDefined()
    })
    it('BE-037: the lookup function that checks entered_by tells a supervisor nothing about accounts', async () => {
      // a supervisor still sees no account rows; the check answers only yes or no about the one id it is given
      expect((await asSup('select count(*)::int as n from account'))[0]).toEqual({ n: 0 })
    })
  })
})

// ---------------------------------------------------------------- migration 016 on a database that was migrated by a non-superuser

describe('016 as a table owner that is not a superuser', () => {
  const dirs: string[] = []
  let pg: PGlite
  beforeEach(() => { pg = new PGlite() })
  afterEach(async () => { await pg.close() })
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })

  const upTo = (n: number): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-016-'))
    dirs.push(d)
    for (const f of readMigrations().filter((m) => Number(m.version) <= n)) fs.writeFileSync(path.join(d, f.file), f.sql)
    return d
  }
  const FILE_016 = (): string => readMigrations().find((m) => m.version === '016')!.file
  /** Hand every table to a role that is not a superuser, as a managed Postgres owner is. */
  async function becomeOwner(): Promise<void> {
    await pg.exec(`create role mig_owner nosuperuser login; grant usage, create on schema public to mig_owner;`)
    for (const t of (await pg.query<{ t: string }>(`select tablename t from pg_tables where schemaname = 'public'`)).rows) await pg.exec(`alter table ${t.t} owner to mig_owner`)
    for (const f of (await pg.query<{ f: string }>(`select p.oid::regprocedure::text f from pg_proc p where pronamespace = 'public'::regnamespace`)).rows) await pg.exec(`alter function ${f.f} owner to mig_owner`)
  }
  const asOwner = async (file: string): Promise<void> => {
    await pg.exec('set role mig_owner')
    try { await runSql(pg, sqlFile('migrations', file)) } finally { await pg.exec('reset role') }
  }
  const B = '00000000-0000-0000-0000-0000000000b1', O = '00000000-0000-0000-0000-0000000000d1'

  it('BE-039: the backfill reaches old dismissed warnings even when 015 itself could not see them', async () => {
    await runMigrations(pgliteSession(pg), { dir: upTo(14) })
    await pg.exec(`
      insert into buyer (id, name) values ('${B}', 'B');
      insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ('${O}', '${B}', 'P', 's', 'c', 1, '2026-12-01');
      insert into warning (id, order_id, buyer_id, stage, status, maths, dismissed_at) values
        ('00000000-0000-0000-0000-0000000000a1', '${O}', '${B}', 'sewing', 'red', '{}', now()),
        ('00000000-0000-0000-0000-0000000000a2', '${O}', '${B}', 'cutting', 'red', '{}', null);`)
    await becomeOwner()
    await asOwner('015_warning_undo.sql')                       // as a managed owner: forced row-level security hides every row from the update
    const state = async () => (await pg.query<{ id: string; v: boolean | null }>(`select right(id::text, 2) id, dismissed_was_confirmed v from warning order by id`)).rows
    expect(await state()).toEqual([{ id: 'a1', v: null }, { id: 'a2', v: null }])   // the trap 014 describes: zero rows updated
    await asOwner(FILE_016())
    expect(await state()).toEqual([{ id: 'a1', v: true }, { id: 'a2', v: null }])
  })

  it('BE-039: running the backfill again changes nothing that was decided since (idempotent)', async () => {
    await runMigrations(pgliteSession(pg), { dir: upTo(15) })
    await pg.exec(`
      insert into buyer (id, name) values ('${B}', 'B');
      insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ('${O}', '${B}', 'P', 's', 'c', 1, '2026-12-01');
      insert into warning (id, order_id, buyer_id, stage, status, maths, dismissed_at, dismissed_was_confirmed) values
        ('00000000-0000-0000-0000-0000000000a1', '${O}', '${B}', 'sewing', 'red', '{}', now(), false),
        ('00000000-0000-0000-0000-0000000000a2', '${O}', '${B}', 'cutting', 'red', '{}', now(), null);`)
    await becomeOwner()
    await asOwner(FILE_016())
    await asOwner(FILE_016())
    expect((await pg.query<{ v: boolean | null }>(`select dismissed_was_confirmed v from warning order by id`)).rows).toEqual([{ v: false }, { v: true }])
  })

  describe('BE-040: email is unique ignoring case', () => {
    const A1 = '10000000-0000-0000-0000-0000000000e1', A2 = '20000000-0000-0000-0000-0000000000e2', A3 = '30000000-0000-0000-0000-0000000000e3'
    it('BE-040: on a database with case-variant duplicates, keeps one account per email, renames the others, deletes nothing', async () => {
      await runMigrations(pgliteSession(pg), { dir: upTo(15) })
      await pg.exec(`
        insert into account (id, role, email, password_hash, disabled_at) values ('${A1}', 'merchandiser', 'M@Example.test', 'h1', now());
        insert into account (id, role, email, password_hash) values ('${A2}', 'merchandiser', 'm@example.test', 'h2'), ('${A3}', 'merchandiser', 'M@EXAMPLE.TEST', 'h3');
        insert into account (id, role, email, password_hash) values ('40000000-0000-0000-0000-0000000000e4', 'merchandiser', 'solo@example.test', 'h4')`)
      await becomeOwner()
      await asOwner(FILE_016())
      const rows = (await pg.query<{ id: string; email: string; h: string }>(`select left(id::text, 1) id, email, password_hash h from account order by id`)).rows
      expect(rows).toHaveLength(4)                                                    // nothing deleted
      expect(rows.find((r) => r.id === '2')!.email).toBe('m@example.test')            // the enabled account that sorts first keeps its email
      expect(rows.find((r) => r.id === '4')!.email).toBe('solo@example.test')
      expect(rows.find((r) => r.id === '1')!.email).toBe('M@Example.test.duplicate-10000000')   // the stopped one and the later one are renamed, not removed
      expect(rows.find((r) => r.id === '3')!.email).toBe('M@EXAMPLE.TEST.duplicate-30000000')
      expect(rows.map((r) => r.h).sort()).toEqual(['h1', 'h2', 'h3', 'h4'])
      expect(new Set(rows.map((r) => r.email.toLowerCase())).size).toBe(4)
      await expect(pg.query(`insert into account (role, email, password_hash) values ('merchandiser', 'M@example.TEST', 'x')`)).rejects.toMatchObject({ code: '23505', constraint: 'account_email_lower_key' })
    })
    it('BE-040: a database without duplicates is unchanged, and the index refuses a case variant', async () => {
      await runMigrations(pgliteSession(pg))
      await pg.exec(`insert into account (role, email, password_hash) values ('merchandiser', 'a@example.test', 'x')`)
      await expect(pg.query(`insert into account (role, email, password_hash) values ('merchandiser', 'A@Example.test', 'x')`)).rejects.toMatchObject({ code: '23505' })
      expect((await pg.query<{ email: string }>(`select email from account`)).rows).toEqual([{ email: 'a@example.test' }])
    })
    it('BE-040: the sign-in lookup can use the new index', async () => {
      await runMigrations(pgliteSession(pg))
      const idx = (await pg.query<{ indexdef: string }>(`select indexdef from pg_indexes where indexname = 'account_email_lower_key'`)).rows
      expect(idx[0]?.indexdef).toMatch(/UNIQUE.*lower\(email\)/i)
    })
  })
})
