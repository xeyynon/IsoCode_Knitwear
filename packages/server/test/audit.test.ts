import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, memoryMediaStore, type Ctx, type Db } from '../src/index.js'
import { recordAudit, sentenceFor } from '../src/auditService.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// The audit trail of account administration: one row per successful action, written in the same
// transaction; nothing for a failed one; no secret anywhere in it; insert-only; merchandisers only.
const NOW = new Date('2026-11-08T04:30:00Z')
const SECRET = 'x'.repeat(40)
const MISSING = '00000000-0000-0000-0000-00000000dead'
const NEW_SUP = { phone: '98100 22334', pin: '7391', unitId: ID.unit2, label: 'Ravi, Unit 2' }
const NEW_MERCH = { email: 'Asha@Example.test', password: 'a long enough passphrase', label: 'Asha' }

let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => {
  await resetAndSeed(pg)
  app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, media: memoryMediaStore() })
})
afterAll(async () => { await pg.close() })

const tokenOf = async (b: object) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token as string
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
const merch = async () => bearer(await tokenOf({ email: CREDS.email, password: CREDS.password }))
const sup = async () => bearer(await tokenOf({ phone: CREDS.phone, pin: CREDS.pin }))
const post = async (url: string, payload: object = {}, h?: Record<string, string>) => app.inject({ method: 'POST', url, payload, headers: h ?? await merch() })
const get = async (url: string, h?: Record<string, string>) => app.inject({ url, headers: h ?? await merch() })
/** Every row, read as the database owner (bypasses RLS, so a hidden row would still show). */
const rows = async () => (await pg.query<any>(`select actor_id::text as actor_id, subject_id::text as subject_id, action, detail from account_audit order by at, id`)).rows
const as = (ctx: Ctx, sql: string, params: unknown[] = []) => db.tx(ctx, (tx) => tx.query(sql, params))

describe('each action writes exactly one row, by the right actor about the right person', () => {
  it('adding a supervisor', async () => {
    const id = (await post('/api/accounts/supervisors', NEW_SUP)).json().id
    expect(await rows()).toEqual([{ actor_id: ID.merch, subject_id: id, action: 'supervisor_added', detail: { unitId: ID.unit2, unitName: 'Unit 2', phoneEnd: '2334' } }])
  })
  it('adding a merchandiser', async () => {
    const id = (await post('/api/accounts/merchandisers', NEW_MERCH)).json().id
    expect(await rows()).toEqual([{ actor_id: ID.merch, subject_id: id, action: 'merchandiser_added', detail: {} }])
  })
  it('resetting a PIN', async () => {
    expect((await post(`/api/accounts/${ID.sup1}/pin`, { pin: '5083' })).statusCode).toBe(200)
    expect(await rows()).toEqual([{ actor_id: ID.merch, subject_id: ID.sup1, action: 'pin_reset', detail: {} }])
  })
  it('signing someone out everywhere', async () => {
    expect((await post(`/api/accounts/${ID.sup1}/sign-out`)).statusCode).toBe(200)
    expect(await rows()).toEqual([{ actor_id: ID.merch, subject_id: ID.sup1, action: 'signed_out_everywhere', detail: {} }])
  })
  it('stopping and then allowing an account, in that order', async () => {
    await post(`/api/accounts/${ID.sup1}/disabled`, { disabled: true })
    await post(`/api/accounts/${ID.sup1}/disabled`, { disabled: false })
    expect((await rows()).map((r: any) => [r.actor_id, r.subject_id, r.action])).toEqual([
      [ID.merch, ID.sup1, 'account_stopped'], [ID.merch, ID.sup1, 'account_allowed']])
  })
  it('the actor is whoever signed in, not a fixed account', async () => {
    await post('/api/accounts/merchandisers', NEW_MERCH)
    const second = bearer(await tokenOf({ email: 'asha@example.test', password: NEW_MERCH.password }))
    await post(`/api/accounts/${ID.sup1}/sign-out`, {}, second)
    const last = (await rows()).at(-1)
    expect(last.actor_id).not.toBe(ID.merch)
    expect(last.action).toBe('signed_out_everywhere')
  })
})

describe('a failed action writes nothing', () => {
  it.each([
    ['a weak PIN', () => post('/api/accounts/supervisors', { ...NEW_SUP, pin: '1234' }), 400],
    ['a duplicate phone', () => post('/api/accounts/supervisors', { ...NEW_SUP, phone: CREDS.phone }), 409],
    ['an unknown unit', () => post('/api/accounts/supervisors', { ...NEW_SUP, unitId: MISSING }), 404],
    ['a weak password', () => post('/api/accounts/merchandisers', { ...NEW_MERCH, password: 'short' }), 400],
    ['a duplicate email', () => post('/api/accounts/merchandisers', { ...NEW_MERCH, email: CREDS.email }), 409],
    ['a weak reset PIN', () => post(`/api/accounts/${ID.sup1}/pin`, { pin: '1111' }), 400],
    ['a reset PIN for a merchandiser', () => post(`/api/accounts/${ID.merch}/pin`, { pin: '5083' }), 404],
    ['a sign-out of nobody', () => post(`/api/accounts/${MISSING}/sign-out`), 404],
    ['stopping your own account', () => post(`/api/accounts/${ID.merch}/disabled`, { disabled: true }), 400],
    ['a stop that is not true or false', () => post(`/api/accounts/${ID.sup1}/disabled`, { disabled: 'yes' }), 400],
    ['stopping nobody', () => post(`/api/accounts/${MISSING}/disabled`, { disabled: true }), 404],
  ])('%s', async (_label, attempt, status) => {
    expect((await attempt()).statusCode).toBe(status)
    expect(await rows()).toEqual([])
  })
  it('a supervisor trying every action writes nothing', async () => {
    const h = await sup()
    for (const [url, body] of [['/api/accounts/supervisors', NEW_SUP], ['/api/accounts/merchandisers', NEW_MERCH], [`/api/accounts/${ID.sup1}/pin`, { pin: '5083' }],
      [`/api/accounts/${ID.sup1}/sign-out`, {}], [`/api/accounts/${ID.sup1}/disabled`, { disabled: true }]] as const) {
      expect((await post(url, body, h)).statusCode).toBe(403)
    }
    expect(await rows()).toEqual([])
  })
  it('an audit row that cannot be written undoes the action itself', async () => {
    await pg.exec(`create or replace function account_audit_fail() returns trigger language plpgsql as $$ begin raise exception 'audit down'; end $$;
                   create trigger account_audit_fail before insert on account_audit for each row execute function account_audit_fail()`)
    try {
      const res = await post(`/api/accounts/${ID.sup1}/sign-out`)
      expect(res.statusCode).toBe(500)
      expect((await pg.query<any>(`select token_version from account where id = $1`, [ID.sup1])).rows[0].token_version).toBe(0)
    } finally { await pg.exec(`drop trigger account_audit_fail on account_audit`) }
  })
})

describe('no secret is ever kept', () => {
  it('searching every row for the PINs, password, hashes and phone number finds nothing', async () => {
    await post('/api/accounts/supervisors', NEW_SUP)
    await post('/api/accounts/merchandisers', NEW_MERCH)
    await post(`/api/accounts/${ID.sup1}/pin`, { pin: '5083' })
    await post(`/api/accounts/${ID.sup1}/sign-out`)
    await post(`/api/accounts/${ID.sup1}/disabled`, { disabled: true })
    const dump = JSON.stringify((await pg.query(`select * from account_audit`)).rows)
    const api = (await get('/api/accounts/audit')).body
    for (const text of [dump, api]) {
      for (const secret of ['7391', '5083', NEW_MERCH.password, '9810022334', '98100 22334', CREDS.pin, CREDS.password]) expect(text).not.toContain(secret)
      expect(text).not.toMatch(/scrypt|hash|password|pin_hash/i)
    }
    expect(dump).toContain('2334')                                           // only the last four digits of a phone
  })
  it('the service refuses a detail with a secret-looking key, at any depth', async () => {
    for (const detail of [{ pin: '1' }, { password: 'x' }, { pinHash: 'x' }, { nested: { passwordHash: 'x' } }, { list: [{ token: 'x' }] }]) {
      await expect(db.tx({ role: 'merchandiser' }, (tx) => recordAudit(tx, ID.merch, ID.sup1, 'pin_reset', detail))).rejects.toThrow(/never hold/)
    }
    expect(await rows()).toEqual([])
  })
  it('and so does the table, for a top-level key', async () => {
    for (const key of ['pin', 'password', 'hash', 'pin_hash', 'secret']) {
      await expect(pg.query(`insert into account_audit (actor_id, action, detail) values ($1, 'pin_reset', $2::jsonb)`, [ID.merch, JSON.stringify({ [key]: 'x' })])).rejects.toThrow(/check constraint/)
    }
  })
})

describe('GET /api/accounts/audit', () => {
  it('lists the latest entries newest first with a plain sentence, and is never cached', async () => {
    await post('/api/accounts/supervisors', NEW_SUP)
    await post(`/api/accounts/${ID.sup1}/disabled`, { disabled: true })
    const res = await get('/api/accounts/audit')
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const { entries } = res.json()
    expect(entries.map((e: any) => e.action)).toEqual(['account_stopped', 'supervisor_added'])
    expect(entries[0]).toMatchObject({ actor: CREDS.email, subject: 'the phone ending 3210', subjectId: ID.sup1, sentence: `${CREDS.email} stopped the account of the phone ending 3210.` })
    expect(entries[1]).toMatchObject({ actor: CREDS.email, subject: 'Ravi, Unit 2', sentence: `${CREDS.email} added Ravi, Unit 2 as a supervisor in Unit 2.` })
    expect(new Date(entries[0].at).getTime()).toBeGreaterThanOrEqual(new Date(entries[1].at).getTime())
  })
  it('uses a name when the account has one', async () => {
    await pg.query(`update account set label = 'Meena' where id = $1`, [ID.merch])
    await post(`/api/accounts/${ID.sup1}/sign-out`)
    expect((await get('/api/accounts/audit')).json().entries[0].sentence).toBe('Meena signed the phone ending 3210 out on every phone.')
  })
  it('?subject narrows it to one person, and a malformed one is refused', async () => {
    const id = (await post('/api/accounts/supervisors', NEW_SUP)).json().id
    await post(`/api/accounts/${ID.sup1}/sign-out`)
    expect((await get(`/api/accounts/audit?subject=${id}`)).json().entries.map((e: any) => e.action)).toEqual(['supervisor_added'])
    expect((await get(`/api/accounts/audit?subject=${MISSING}`)).json().entries).toEqual([])
    expect((await get('/api/accounts/audit?subject=nope')).statusCode).toBe(400)
  })
  it('returns at most 100 entries', async () => {
    await pg.query(`insert into account_audit (at, actor_id, subject_id, action) select now() - make_interval(secs => g), $1, $2, 'signed_out_everywhere' from generate_series(1, 130) g`, [ID.merch, ID.sup1])
    const { entries } = (await get('/api/accounts/audit')).json()
    expect(entries).toHaveLength(100)
    expect(new Date(entries[0].at).getTime()).toBeGreaterThan(new Date(entries[99].at).getTime())
  })
  it('refuses a supervisor and a signed-out caller, and is not read as an account id', async () => {
    await post(`/api/accounts/${ID.sup1}/sign-out`)
    expect((await get('/api/accounts/audit', await sup())).statusCode).toBe(403)
    expect((await get('/api/accounts/audit', {})).statusCode).toBe(401)
    expect((await get('/api/accounts/audit', { authorization: 'Bearer bl_whatever' })).statusCode).toBe(401)
    expect((await post('/api/accounts/audit', {})).statusCode).toBe(404)
    expect((await get('/api/accounts')).json().accounts.length).toBe(2)       // the plain list still works
  })
})

describe('the database itself', () => {
  beforeEach(async () => { await post(`/api/accounts/${ID.sup1}/sign-out`) })

  it('shows one row to a merchandiser and none to anyone else', async () => {
    expect(await as({ role: 'merchandiser' }, 'select id from account_audit')).toHaveLength(1)
    for (const ctx of [{ role: 'supervisor', unitId: ID.unit1 }, { role: 'buyer', buyerId: ID.buyerB }, { role: 'auth' }, { role: 'system' }] as Ctx[]) {
      expect(await as(ctx, 'select id from account_audit'), ctx.role).toHaveLength(0)
    }
  })
  it('refuses an insert from anyone but a merchandiser', async () => {
    const add = (ctx: Ctx) => as(ctx, `insert into account_audit (actor_id, subject_id, action) values ($1, $2, 'pin_reset')`, [ID.merch, ID.sup1])
    for (const ctx of [{ role: 'supervisor', unitId: ID.unit1 }, { role: 'buyer', buyerId: ID.buyerB }, { role: 'auth' }, { role: 'system' }] as Ctx[]) {
      await expect(add(ctx), ctx.role).rejects.toThrow(/row-level security|permission denied/)
    }
    await expect(add({ role: 'merchandiser' })).resolves.toBeDefined()
  })
  it('refuses UPDATE and DELETE even for a merchandiser', async () => {
    await expect(as({ role: 'merchandiser' }, `update account_audit set action = 'account_allowed'`)).rejects.toThrow(/permission denied/)
    await expect(as({ role: 'merchandiser' }, `delete from account_audit`)).rejects.toThrow(/permission denied/)
    await expect(as({ role: 'merchandiser' }, `truncate account_audit`)).rejects.toThrow(/permission denied/)
    expect(await rows()).toHaveLength(1)
  })
  it('refuses UPDATE and DELETE even for the table owner (the append-only trigger)', async () => {
    await expect(pg.exec(`update account_audit set action = 'account_allowed'`)).rejects.toThrow(/append-only/)
    await expect(pg.exec(`delete from account_audit`)).rejects.toThrow(/append-only/)
  })
  it('refuses an action the table does not know and a detail that is not an object', async () => {
    await expect(pg.query(`insert into account_audit (actor_id, action) values ($1, 'account_deleted')`, [ID.merch])).rejects.toThrow(/check constraint/)
    await expect(pg.query(`insert into account_audit (actor_id, action, detail) values ($1, 'pin_reset', '[]')`, [ID.merch])).rejects.toThrow(/check constraint/)
    await expect(pg.query(`insert into account_audit (actor_id, action) values (null, 'pin_reset')`)).rejects.toThrow(/null value/)
  })
  it('has forced row-level security, and no policy that could allow a change', async () => {
    expect((await pg.query<any>(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'account_audit'`)).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
    const policies = (await pg.query<any>(`select cmd from pg_policies where tablename = 'account_audit' order by cmd`)).rows.map((p: any) => p.cmd)
    expect(policies).toEqual(['INSERT', 'SELECT'])
  })
})

describe('the sentences', () => {
  it('say what happened in plain English, for every action', () => {
    expect(sentenceFor('merchandiser_added', 'Asha', 'Bala', {})).toBe('Asha added Bala as a merchandiser.')
    expect(sentenceFor('pin_reset', 'Asha', 'Ravi', {})).toMatch(/^Asha reset the PIN for Ravi/)
    expect(sentenceFor('account_allowed', 'Asha', 'Ravi', {})).toBe('Asha allowed the account of Ravi again.')
    expect(sentenceFor('signed_out_everywhere', 'Asha', null, {})).toBe('Asha signed an account out on every phone.')
  })
})
