import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, memoryMediaStore, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// Mocked alerts: rows in the outbox, written in the same transaction as the change they report.
// Nothing is ever sent. Only merchandisers can read them.
const NOW = new Date('2026-11-04T04:30:00Z')
const jpeg = (size = 2000): Buffer => { const b = Buffer.alloc(size, 0x41); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[size - 2] = 0xff; b[size - 1] = 0xd9; return b }
// the engine's figures for the red seed order: these must never reach a buyer-bound body
const FIGURES = /467|350|700|pcs|\/day|need|making|short/i

let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW, media: memoryMediaStore() }) })
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const review = async () => (await app.inject({ url: '/api/review', headers: await merch() })).json()
const post = async (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload, headers: await merch() })
const outbox = async () => (await pg.query<any>('select * from outbox order by created_at, id')).rows
const alerts = async () => (await app.inject({ url: '/api/outbox', headers: await merch() })).json().alerts as any[]
const uploadPhoto = async () => (await app.inject({
  method: 'POST', url: '/api/photos',
  headers: { ...(await sup()), 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': 'sewing', 'x-date': '2026-11-04' },
  payload: jpeg(),
})).json().id as string

describe('an order turning red', () => {
  it('tells the merchandisers once, with a label and no real address', async () => {
    await review(); await review(); await review()
    const rows = await outbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ channel: 'whatsapp', recipient_kind: 'merchandiser', recipient: 'Merchandisers', order_id: ID.orderRed })
    expect(rows[0].subject).toBe('PO B-PO-88240: Sewing is red')
    expect(rows[0].body).toMatch(/^Sewing for PO B-PO-88240 has turned red\./)
    expect(rows[0].recipient).not.toMatch(/@|\d{5}/)
  })
  it('says nothing for an amber warning', async () => {
    const o = (await pg.query<{ id: string }>(`insert into orders (buyer_id, po, style, colour, qty, ex_factory) values ($1, 'B-AMBER', 's', 'c', 4950, '2026-11-20') returning id::text as id`, [ID.buyerB])).rows[0]!.id
    await pg.query(`insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty) values ($1, $2, 'sewing', $3, '2026-11-11', 1, 4950)`, [o, ID.buyerB, ID.unit1])
    for (const d of ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03']) {
      await pg.query(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty) values (gen_random_uuid(), $1, $2, 'sewing', $3, $4, 430)`, [o, ID.buyerB, ID.unit1, d])
    }
    await review()
    expect((await outbox()).filter((r) => r.order_id === o)).toEqual([])
  })
  it('tells them again when an amber warning turns red', async () => {
    await review()
    await pg.query(`update warning set status = 'amber'`)   // as if it had been amber until now
    await review()
    expect((await outbox()).filter((r) => r.recipient_kind === 'merchandiser')).toHaveLength(2)
  })
})

describe('a warning confirmed for buyers', () => {
  const firstId = async () => (await review()).needsReview[0].id as string

  it('writes an email to the buyer carrying the confirmed wording and no internal figures', async () => {
    const id = await firstId()
    expect((await post(`/api/warnings/${id}/confirm`)).statusCode).toBe(200)
    const mail = (await outbox()).filter((r) => r.recipient_kind === 'buyer')
    expect(mail).toHaveLength(1)
    expect(mail[0]).toMatchObject({ channel: 'email', recipient: 'Buyer B', order_id: ID.orderRed, subject: 'Update on PO B-PO-88240' })
    expect(mail[0].body).toBe('Sewing is at risk of finishing late (planned for 11 Nov).')
    expect(`${mail[0].subject} ${mail[0].body}`).not.toMatch(FIGURES)
  })
  it('carries the reworded text when the merchandiser changed it', async () => {
    const id = await firstId()
    await post(`/api/warnings/${id}/confirm`, { text: 'Sewing is running behind; we are adding a shift.' })
    expect((await outbox()).find((r) => r.recipient_kind === 'buyer').body).toBe('Sewing is running behind; we are adding a shift.')
  })
  it('writes nothing when the confirm is refused, so the alert and the change stand or fall together', async () => {
    const id = await firstId()
    const res = await post(`/api/warnings/${id}/confirm`, { seenStatus: 'amber' })
    expect(res.statusCode).toBe(409)
    expect((await outbox()).filter((r) => r.recipient_kind === 'buyer')).toEqual([])
  })
  it('is rolled back with the confirm if the alert cannot be written', async () => {
    const id = await firstId()
    await pg.exec('alter table outbox add constraint zz_no_buyer_mail check (recipient_kind <> \'buyer\')')
    try {
      expect((await post(`/api/warnings/${id}/confirm`)).statusCode).toBe(500)
      expect((await pg.query<any>('select confirmed_by from warning')).rows[0].confirmed_by).toBeNull()
    } finally { await pg.exec('alter table outbox drop constraint zz_no_buyer_mail') }
  })
})

describe('a photo approved', () => {
  it('writes an email to the buyer that only says a photo is ready', async () => {
    const id = await uploadPhoto()
    expect((await outbox()).filter((r) => r.recipient_kind === 'buyer')).toEqual([])   // not before approval
    expect((await post(`/api/photos/${id}/approve`)).statusCode).toBe(200)
    const mail = (await outbox()).filter((r) => r.recipient_kind === 'buyer')
    expect(mail).toHaveLength(1)
    expect(mail[0]).toMatchObject({ channel: 'email', recipient: 'Buyer B', order_id: ID.orderRed, subject: 'New photo for PO B-PO-88240' })
    expect(mail[0].body).toBe('A new photo of sewing for PO B-PO-88240 is ready for you to see.')
    expect(`${mail[0].subject} ${mail[0].body}`).not.toMatch(FIGURES)
  })
  it('does not repeat the alert when an approved photo is approved again, but does after a withdraw', async () => {
    const id = await uploadPhoto()
    await post(`/api/photos/${id}/approve`); await post(`/api/photos/${id}/approve`)
    expect(await outbox()).toHaveLength(1)
    await post(`/api/photos/${id}/reject`); await post(`/api/photos/${id}/approve`)
    expect(await outbox()).toHaveLength(2)
  })
  it('an unknown photo writes nothing', async () => {
    expect((await post('/api/photos/00000000-0000-0000-0000-00000000dead/approve')).statusCode).toBe(404)
    expect(await outbox()).toEqual([])
  })
})

describe('GET /api/outbox', () => {
  it('lists the alerts newest first, with the order, and is never cached', async () => {
    await post(`/api/warnings/${(await review()).needsReview[0].id}/confirm`)
    const res = await app.inject({ url: '/api/outbox', headers: await merch() })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const list = res.json().alerts
    expect(list.map((a: any) => a.recipientKind)).toEqual(['buyer', 'merchandiser'])
    expect(list[0]).toMatchObject({ channel: 'email', recipient: 'Buyer B', po: 'B-PO-88240', orderId: ID.orderRed })
    expect(list[0].createdAt).toMatch(/^\d{4}-\d\d-\d\dT[\d:]+Z$/)
  })
  it('returns the latest 50 only', async () => {
    for (let i = 0; i < 55; i++) {
      await pg.query(`insert into outbox (channel, recipient_kind, recipient, subject, body, created_at) values ('email', 'buyer', 'Buyer B', $1, 'x', now() - make_interval(mins => $2::int))`, [`n${i}`, 100 - i])
    }
    const list = await alerts()
    expect(list).toHaveLength(50)
    expect(list[0].subject).toBe('n54')
    expect(list[49].subject).toBe('n5')
  })
  it('is for merchandisers only', async () => {
    await review()
    expect((await app.inject({ url: '/api/outbox', headers: await sup() })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/outbox' })).statusCode).toBe(401)
    const token = (await post('/api/buyer-links', { buyerId: ID.buyerB })).json().token as string
    expect((await app.inject({ url: '/api/outbox', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)
  })
})

describe('the outbox table and row-level security', () => {
  const as = (ctx: Parameters<Db['tx']>[0], sql: string, params: unknown[] = []) => db.tx(ctx, (tx) => tx.query(sql, params))
  const NEW_ROW = `insert into outbox (channel, recipient_kind, recipient, subject, body) values ('email', 'buyer', 'Buyer B', 's', 'b')`
  beforeEach(async () => { await pg.exec(`insert into outbox (channel, recipient_kind, recipient, subject, body) values ('email', 'buyer', 'Buyer B', 's', 'b')`) })

  it('is forced on, and shows buyers, supervisors and sign-in lookups no rows at all', async () => {
    const flags = (await pg.query<any>(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'outbox'`)).rows[0]
    expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
    expect(await as({ role: 'merchandiser' }, 'select id from outbox')).toHaveLength(1)
    expect(await as({ role: 'buyer', buyerId: ID.buyerB }, 'select id from outbox')).toEqual([])
    expect(await as({ role: 'supervisor', unitId: ID.unit1 }, 'select id from outbox')).toEqual([])
    expect(await as({ role: 'auth' }, 'select id from outbox')).toEqual([])
  })
  it('refuses a write from a buyer, a supervisor or a sign-in lookup', async () => {
    for (const ctx of [{ role: 'buyer', buyerId: ID.buyerB }, { role: 'supervisor', unitId: ID.unit1 }, { role: 'auth' }] as const) {
      await expect(as(ctx, NEW_ROW)).rejects.toThrow(/row-level security/)
    }
  })
  it('is a record: not even a merchandiser can rewrite or delete a row through the app', async () => {
    await expect(as({ role: 'merchandiser' }, `update outbox set body = 'changed'`)).rejects.toThrow(/permission denied/)
    await expect(as({ role: 'merchandiser' }, 'delete from outbox')).rejects.toThrow(/permission denied/)
  })
  it('only knows the two channels and the two kinds of recipient', async () => {
    await expect(as({ role: 'merchandiser' }, NEW_ROW.replace("'email'", "'sms'"))).rejects.toThrow(/outbox_channel_known/)
    await expect(as({ role: 'merchandiser' }, NEW_ROW.replace("'buyer', 'Buyer B'", "'supervisor', 'x'"))).rejects.toThrow(/check/)
  })
})
