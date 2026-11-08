// Fix lane D: start-up checks (BE-035, BE-041, BE-042, BE-043).
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it, vi } from 'vitest'
import { errorReason } from '../src/db.js'
import { run } from '../src/migrate.js'
import { assertSafeDbRole, DB_ROLE_CHECK_SQL, unsafeRoleOverride, type RoleFacts } from '../src/pgDb.js'
import { parsePort, parseTrustProxy, StartupConfigError } from '../src/startup.js'
import { migratedDb } from './helpers.js'

describe('BE-042: PORT', () => {
  it.each([[undefined, 8787], ['', 8787], ['   ', 8787], ['8787', 8787], [' 3000 ', 3000], ['1', 1], ['65535', 65535]])(
    'BE-042: PORT=%j is %j', (raw, want) => { expect(parsePort(raw)).toBe(want) })
  it.each(['abc', '0', '99999', '65536', '-1', '80.5', '1e3', '0x50', '８０８０', '80 80', 'NaN'])(
    'BE-042: PORT=%j is refused with a plain message', (raw) => {
      expect(() => parsePort(raw)).toThrow(StartupConfigError)
      expect(() => parsePort(raw)).toThrow(/PORT/)
    })
  it('BE-042: the default can be changed', () => { expect(parsePort('', 9000)).toBe(9000) })
})

describe('BE-043: TRUST_PROXY', () => {
  it.each([[undefined, false], ['', false], ['  ', false], ['0', false], ['false', false], ['FALSE', false]])(
    'BE-043: TRUST_PROXY=%j means no proxy', (raw, want) => { expect(parseTrustProxy(raw)).toBe(want) })
  it.each([['1', 1], ['true', 1], ['True', 1], [' 2 ', 2], ['10', 10]])(
    'BE-043: TRUST_PROXY=%j trusts that many proxies', (raw, want) => { expect(parseTrustProxy(raw)).toBe(want) })
  it('BE-043: a list of proxy addresses is accepted as a list', () => {
    expect(parseTrustProxy('10.0.0.0/8, 192.168.1.5')).toEqual(['10.0.0.0/8', '192.168.1.5'])
    expect(parseTrustProxy('loopback')).toEqual(['loopback'])
    expect(parseTrustProxy('fd00::/8')).toEqual(['fd00::/8'])
  })
  it.each(['banana', 'yes', 'on', 'enabled', '1.5', '-1', '11', '100', '1e1', '10.0.0.0/33', '10.0.0.0/', '300.1.1.1', '10.0.0.0/8,', ',', 'true,1'])(
    'BE-043: TRUST_PROXY=%j is refused with a plain message', (raw) => {
      expect(() => parseTrustProxy(raw)).toThrow(StartupConfigError)
      expect(() => parseTrustProxy(raw)).toThrow(/TRUST_PROXY/)
    })
})

describe('BE-035: the database role is checked at start-up', () => {
  const facts = (over: Partial<RoleFacts> = {}): RoleFacts => ({ name: 'app_user', superuser: false, bypassrls: false, owned: 0, ...over })
  const asQuery = (row: RoleFacts) => async () => [row]

  it('BE-035: a plain role is accepted', async () => {
    await expect(assertSafeDbRole(asQuery(facts()))).resolves.toBeUndefined()
  })
  it('BE-035: a superuser is refused', async () => {
    await expect(assertSafeDbRole(asQuery(facts({ name: 'postgres', superuser: true })))).rejects.toThrow(/superuser/)
  })
  it('BE-035: a role that bypasses row-level security is refused', async () => {
    await expect(assertSafeDbRole(asQuery(facts({ bypassrls: true })))).rejects.toThrow(/bypass/i)
  })
  it('BE-035: the owner of tables is refused', async () => {
    await expect(assertSafeDbRole(asQuery(facts({ name: 'owner', owned: 31 })))).rejects.toThrow(/owns 31 tables/)
    await expect(assertSafeDbRole(asQuery(facts({ name: 'owner', owned: 1 })))).rejects.toThrow(/owns 1 table\b/)
  })
  it('BE-035: the message is one line, names the role, and names every problem', async () => {
    const err = await assertSafeDbRole(asQuery(facts({ name: 'postgres', superuser: true, bypassrls: true, owned: 3 }))).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).not.toMatch(/\n/)
    expect(msg).toMatch(/"postgres"/)
    expect(msg).toMatch(/superuser/)
    expect(msg).toMatch(/bypass/i)
    expect(msg).toMatch(/owns 3 tables/)
    expect(msg).toMatch(/Refusing to start/)
    expect(msg).toMatch(/ALLOW_UNSAFE_DB_ROLE/)
  })
  it('BE-035: the override lets a development server start and says so', async () => {
    const warn = vi.fn()
    await expect(assertSafeDbRole(asQuery(facts({ superuser: true })), { allowUnsafe: true, warn })).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatch(/row-level security is NOT protecting/)
  })
  it('BE-035: a check that cannot run stops the server too, with a reason', async () => {
    const down = async () => { throw new AggregateError([new Error('connect ECONNREFUSED ::1:5432'), new Error('connect ECONNREFUSED 127.0.0.1:5432')]) }
    await expect(assertSafeDbRole(down)).rejects.toThrow(/Could not check the database role.*ECONNREFUSED/)
    await expect(assertSafeDbRole(async () => [])).rejects.toThrow(/Could not check the database role/)
  })
  it('BE-035: the override variable is off by default and strict', () => {
    expect(unsafeRoleOverride({})).toBe(false)
    expect(unsafeRoleOverride({ ALLOW_UNSAFE_DB_ROLE: '' })).toBe(false)
    expect(unsafeRoleOverride({ ALLOW_UNSAFE_DB_ROLE: '0' })).toBe(false)
    expect(unsafeRoleOverride({ ALLOW_UNSAFE_DB_ROLE: '1' })).toBe(true)
    expect(() => unsafeRoleOverride({ ALLOW_UNSAFE_DB_ROLE: 'yes' })).toThrow(/ALLOW_UNSAFE_DB_ROLE/)
  })

  // The query itself, on a database that has the real migrations.
  async function factsAs(setup: string): Promise<RoleFacts> {
    const pg = await migratedDb()
    try {
      await pg.exec(`create role boss nosuperuser createrole login; create role boss_rls nosuperuser bypassrls login; ${setup}`)
      return (await pg.query<RoleFacts>(DB_ROLE_CHECK_SQL)).rows[0]!
    } finally { await pg.close() }
  }
  it('BE-035: the query sees app_user as safe, a superuser as unsafe, a bypassrls role as unsafe, and a table owner as unsafe', async () => {
    expect(await factsAs('set role app_user')).toMatchObject({ name: 'app_user', superuser: false, bypassrls: false, owned: 0 })
    expect(await factsAs('')).toMatchObject({ superuser: true })
    expect(await factsAs('set role boss_rls')).toMatchObject({ name: 'boss_rls', superuser: false, bypassrls: true })
    const owner = await (async () => {
      const pg = new PGlite()
      try {
        await pg.exec(`create role owner_role nosuperuser createrole login; grant create on schema public to owner_role; set role owner_role; create table t1 (a int); create table t2 (a int)`)
        return (await pg.query<RoleFacts>(DB_ROLE_CHECK_SQL)).rows[0]!
      } finally { await pg.close() }
    })()
    expect(owner).toMatchObject({ name: 'owner_role', superuser: false, bypassrls: false, owned: 2 })
  })
})

describe('BE-041: a failed connection says why', () => {
  it('BE-041: errorReason falls back from message to code to the inner errors', () => {
    expect(errorReason(new Error('boom'))).toBe('boom')
    expect(errorReason(Object.assign(new Error(''), { code: 'ECONNREFUSED' }))).toBe('ECONNREFUSED')
    const agg = new AggregateError([Object.assign(new Error('connect ECONNREFUSED ::1:1'), {}), new Error('connect ECONNREFUSED 127.0.0.1:1')])
    expect(errorReason(agg)).toBe('connect ECONNREFUSED ::1:1; connect ECONNREFUSED 127.0.0.1:1')
    expect(errorReason(new AggregateError([Object.assign(new Error(''), { code: 'ECONNREFUSED' })]))).toBe('ECONNREFUSED')
    expect(errorReason('plain text')).toBe('plain text')
    expect(errorReason(undefined)).toBe('unknown error')
    expect(errorReason(new Error(''))).toBe('unknown error')
  })
  it('BE-041: the migration runner names the reason when localhost refuses the connection', async () => {
    const err = await run('postgres://u:secret@localhost:1/x').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toMatch(/Could not connect to postgres:\/\/u:\*\*\*@localhost:1\/x: \S/)
    expect(msg).toMatch(/ECONNREFUSED|refused/i)
    expect(msg).not.toMatch(/secret/)
  }, 30_000)
})
