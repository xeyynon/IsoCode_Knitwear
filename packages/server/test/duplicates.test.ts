// Two people (or two taps) creating the same thing at the same moment can both pass the "does it exist?" check.
// The loser then meets the database's unique rule. That must be the same plain 409 the check gives, never a 500,
// and never a second row.
//
// PGlite has one connection, so the race is made deterministic: the pre-check is blinded (it is told "nothing
// there") while the conflicting row really is in the table. That is exactly what the loser of a real race sees.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { AppError, duplicateFault } from '../src/errors.js'
import { CREDS, ID, TEMPLATE_ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const NOW = new Date('2026-11-04T04:30:00Z')
const SECRET = 'x'.repeat(40)

let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); app = appOver(db) })
afterAll(async () => { await pg.close() })

const appOver = (d: Db) => buildApp({ db: d, tokenSecret: SECRET, clock: () => NOW })

/** A Db whose reads matching `hide` come back empty, as if the other request had not committed yet when the check ran. */
const blind = (inner: Db, hide: RegExp): Db => ({
  tx: (ctx, fn) => inner.tx(ctx, (tx) => fn({
    query: async (sql, params) => { const rows = await tx.query(sql, params); return (hide.test(sql) ? [] : rows) as never },
  })),
})

const login = async (a: FastifyInstance) =>
  ({ authorization: `Bearer ${((await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json() as { token: string }).token}` })
const count = async (sql: string): Promise<number> => Number((await pg.query<{ n: number }>(sql)).rows[0]!.n)

const stages = () => [{ stage: 'sewing', workingDaysBefore: 5, unitId: ID.unit1 }]
const ORDER = { buyerId: ID.buyerB, po: 'B-PO-88240', style: 'tee', colour: 'navy', sizes: { M: 100 }, exFactory: '2026-11-20', templateId: TEMPLATE_ID }

const CASES: Array<{ what: string; hide: RegExp; url: string; body: object; message: string; code: string; rows: string }> = [
  { what: 'a unit with an existing name', hide: /from unit where lower\(name\)/, url: '/api/units', body: { name: 'UNIT 1', type: 'own' },
    message: 'A unit with that name already exists', code: 'duplicate', rows: `select count(*)::int n from unit where lower(name) = 'unit 1'` },
  { what: 'a template with an existing name', hide: /from tna_template where lower\(name\)/, url: '/api/templates', body: { name: 'knit TEE', stages: stages() },
    message: 'A template with that name already exists', code: 'duplicate', rows: `select count(*)::int n from tna_template where lower(name) = 'knit tee'` },
  { what: 'a supervisor with an existing phone number', hide: /^select 1 from account where phone/, url: '/api/accounts/supervisors',
    body: { phone: CREDS.phone, pin: '7391', unitId: ID.unit2, label: 'Ravi' },
    message: 'That phone number already has an account', code: 'duplicate', rows: `select count(*)::int n from account where phone = '9876543210'` },
  { what: 'a merchandiser with an existing email', hide: /^select 1 from account where lower\(email\)/, url: '/api/accounts/merchandisers',
    body: { email: 'M@Example.test', password: 'a long enough passphrase', label: 'Asha' },
    message: 'That email already has an account', code: 'duplicate', rows: `select count(*)::int n from account where lower(email) = 'm@example.test'` },
  { what: 'an order that already exists for the buyer', hide: /^select 1 from orders where buyer_id/, url: '/api/orders', body: ORDER,
    message: 'PO B-PO-88240 (tee, navy) already exists for this buyer', code: 'duplicate_order', rows: `select count(*)::int n from orders where po = 'B-PO-88240'` },
]

describe('the loser of a create race', () => {
  it.each(CASES)('gets the same plain 409 as the check for $what, and no second row is made', async (c) => {
    const before = await count(c.rows)
    expect(before).toBe(1)
    const racing = appOver(blind(db, c.hide))
    const res = await racing.inject({ method: 'POST', url: c.url, headers: await login(racing), payload: c.body })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: { code: c.code, message: c.message } })
    expect(res.body).not.toMatch(/violates|constraint|_key|unique|duplicate key|insert into|23505/i)
    expect(await count(c.rows)).toBe(1)
  })

  it('the check itself still gives the same answer when it does see the row', async () => {
    for (const c of CASES) {
      const res = await app.inject({ method: 'POST', url: c.url, headers: await login(app), payload: c.body })
      expect([res.statusCode, res.json().error.message]).toEqual([409, c.message])
    }
  })

  it('renaming a template to another template\'s name is refused the same way, not saved twice', async () => {
    const h = await login(app)
    const other = (await app.inject({ method: 'POST', url: '/api/templates', headers: h, payload: { name: 'Second', stages: stages() } })).json().id as string
    const res = await app.inject({ method: 'POST', url: '/api/templates', headers: h, payload: { id: other, name: 'KNIT TEE', stages: stages() } })
    expect([res.statusCode, res.json().error.message]).toEqual([409, 'A template with that name already exists'])
    expect(await count(`select count(*)::int n from tna_template where lower(name) = 'knit tee'`)).toBe(1)
  })

  it('the database itself refuses two units, or two templates, whose names differ only in case', async () => {
    await expect(pg.query(`insert into unit (name, type) values ('uNiT 1', 'own')`)).rejects.toMatchObject({ code: '23505' })
    await expect(pg.query(`insert into tna_template (name, offsets) values ('KNIT TEE', '[]')`)).rejects.toMatchObject({ code: '23505' })
  })
})

describe('duplicateFault: the net under every create', () => {
  const unique = (constraint?: string) => Object.assign(new Error(`duplicate key value violates unique constraint "${constraint ?? 'x'}"`), { code: '23505', constraint })

  it('turns a unique violation into a plain 409 that names the thing and never the constraint', () => {
    for (const [constraint, thing] of [
      ['account_phone_key', /phone number/], ['account_email_key', /email/], ['orders_buyer_id_po_style_colour_key', /order/],
      ['unit_name_lower_key', /unit/], ['tna_template_name_lower_key', /template/], ['something_else_key', /already exists/],
    ] as const) {
      const f = duplicateFault(unique(constraint))
      expect(f).toBeInstanceOf(AppError)
      expect([f!.status, f!.code]).toEqual([409, 'duplicate'])
      expect(f!.message).toMatch(thing)
      expect(f!.message).not.toMatch(/_key|violates|constraint|sql/i)
    }
    expect(duplicateFault(unique())!.status).toBe(409)
  })

  it('ignores everything that is not a unique violation', () => {
    expect(duplicateFault(Object.assign(new Error('x'), { code: '23503' }))).toBeNull()
    expect(duplicateFault(new Error('boom'))).toBeNull()
    expect(duplicateFault(null)).toBeNull()
    expect(duplicateFault('23505')).toBeNull()
  })

  it('a unique violation from anywhere in a request reaches the caller as a 409, not a 500', async () => {
    const boom = unique('some_table_other_key')
    const broken: Db = { tx: async () => { throw boom } }
    const a = appOver(db)
    const h = await login(a)
    const failing = appOver({ tx: (ctx, fn) => (ctx.role === 'auth' ? db.tx(ctx, fn) : broken.tx(ctx, fn)) })
    const res = await failing.inject({ url: '/api/units', headers: h })
    expect(res.statusCode).toBe(409)
    expect(res.body).not.toMatch(/some_table|violates|constraint/i)
  })
})
