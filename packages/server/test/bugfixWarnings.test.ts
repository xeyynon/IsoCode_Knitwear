import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// Fixes BE-008 (a second confirm), BE-024 (the "300 / 500" wording) and BE-025 (alert order and subject).
const NOW = new Date('2026-11-04T04:30:00Z')
let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW }) })
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const review = async () => (await app.inject({ url: '/api/review', headers: await merch() })).json()
const post = async (url: string, payload: object = {}, h?: Record<string, string>) => app.inject({ method: 'POST', url, payload, headers: h ?? await merch() })
const buyerMail = async () => (await pg.query<any>(`select * from outbox where recipient_kind = 'buyer' order by created_at, id`)).rows
const warningRow = async () => (await pg.query<any>('select confirmed_by, confirmed_at::text as confirmed_at, buyer_text from warning')).rows[0]
const sendUpdate = async (note: object) => app.inject({
  method: 'POST', url: '/api/events', headers: await sup(),
  payload: { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 3, note },
})

describe('BE-008: confirming a warning twice', () => {
  it('BE-008: confirming a warning twice writes one buyer email and keeps who and when', async () => {
    const w = (await review()).needsReview[0]
    expect((await post(`/api/warnings/${w.id}/confirm`)).statusCode).toBe(200)
    const first = await warningRow()
    expect(first.confirmed_by).toBe(ID.merch)
    // Make "when" a value a re-stamp would visibly change.
    await pg.query(`update warning set confirmed_at = '2026-01-01T00:00:00Z'`)
    const second = await post(`/api/warnings/${w.id}/confirm`)
    expect(second.statusCode).toBe(200)
    expect(second.json()).toEqual({ ok: true })
    expect(await buyerMail()).toHaveLength(1)
    expect((await warningRow()).confirmed_at).toMatch(/^2026-01-01/)
  })

  it('BE-008: confirming again with the same words changes nothing and tells nobody', async () => {
    const w = (await review()).needsReview[0]
    await post(`/api/warnings/${w.id}/confirm`)
    const again = await post(`/api/warnings/${w.id}/confirm`, { text: w.buyerText })
    expect(again.statusCode).toBe(200)
    expect(await buyerMail()).toHaveLength(1)
    expect((await warningRow()).confirmed_by).toBe(ID.merch)
  })

  it('BE-008: a reworded re-confirm is sent knowingly: one more email with the new words', async () => {
    const w = (await review()).needsReview[0]
    await post(`/api/warnings/${w.id}/confirm`)
    const res = await post(`/api/warnings/${w.id}/confirm`, { text: 'Sewing may be a day late.' })
    expect(res.statusCode).toBe(200)
    expect((await buyerMail()).map((m) => m.body)).toEqual([w.buyerText, 'Sewing may be a day late.'])
    expect((await warningRow()).buyer_text).toBe('Sewing may be a day late.')
    // and sending those same new words again is once more a no-op
    await post(`/api/warnings/${w.id}/confirm`, { text: 'Sewing may be a day late.' })
    expect(await buyerMail()).toHaveLength(2)
  })

  it('BE-008: the retry of a reworded confirm (the reply was lost) is a no-op even though the screen still shows the old words', async () => {
    const w = (await review()).needsReview[0]
    const body = { text: 'Sewing may be a day late.', seenStatus: 'red', seenText: w.buyerText }
    expect((await post(`/api/warnings/${w.id}/confirm`, body)).statusCode).toBe(200)
    expect((await post(`/api/warnings/${w.id}/confirm`, body)).statusCode).toBe(200)
    expect(await buyerMail()).toHaveLength(1)
  })

  it('BE-008: a re-confirm still refuses when the colour or wording the person saw has changed (409 changed)', async () => {
    const w = (await review()).needsReview[0]
    await post(`/api/warnings/${w.id}/confirm`)
    const stale = await post(`/api/warnings/${w.id}/confirm`, { seenStatus: 'amber', seenText: w.buyerText })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('changed')
    expect(await buyerMail()).toHaveLength(1)
  })

  it('BE-008: two confirms in flight together send one email', async () => {
    const w = (await review()).needsReview[0]
    const h = await merch()
    const both = await Promise.all([post(`/api/warnings/${w.id}/confirm`, {}, h), post(`/api/warnings/${w.id}/confirm`, {}, h)])
    expect(both.map((r) => r.statusCode)).toEqual([200, 200])
    expect(await buyerMail()).toHaveLength(1)
  })

  it('BE-008: confirming a dismissed or unknown warning is still refused', async () => {
    const w = (await review()).needsReview[0]
    await post(`/api/warnings/${w.id}/dismiss`)
    expect((await post(`/api/warnings/${w.id}/confirm`)).statusCode).toBe(409)
    expect((await post('/api/warnings/00000000-0000-0000-0000-00000000dead/confirm')).statusCode).toBe(404)
    expect(await buyerMail()).toHaveLength(0)
  })
})

describe('BE-024: the length limits say what they allow', () => {
  it('BE-024: 300 characters of wording are accepted; 301 are refused with words that do not contradict that', async () => {
    const w = (await review()).needsReview[0]
    const long = await post(`/api/warnings/${w.id}/confirm`, { text: 'a'.repeat(301) })
    expect(long.statusCode).toBe(400)
    expect(long.json().error.message).toBe('Keep the wording to 300 characters or fewer')
    expect((await post(`/api/warnings/${w.id}/confirm`, { text: 'a'.repeat(300) })).statusCode).toBe(200)
  })

  it('BE-024: a note of exactly 500 characters is accepted; 501 says "500 characters or fewer"', async () => {
    const res501 = await sendUpdate({ text: 'n'.repeat(501) })
    expect(res501.statusCode).toBe(400)
    expect(res501.json().error.message).toBe('Keep the note to 500 characters or fewer')
    expect((await sendUpdate({ text: 'n'.repeat(500) })).statusCode).toBe(200)
  })

  it('BE-024: the English meaning of a note follows the same wording', async () => {
    await sendUpdate({ text: 'தாமதம்' })
    const id = (await pg.query<{ id: string }>('select id::text as id from note')).rows[0]!.id
    const res = await post(`/api/notes/${id}/confirm`, { textEn: 'e'.repeat(501) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe('Keep it to 500 characters or fewer')
    expect((await post(`/api/notes/${id}/confirm`, { textEn: 'e'.repeat(500) })).statusCode).toBe(200)
  })
})

describe('BE-025: the alert list', () => {
  it('BE-025: alerts written by one refresh are listed newest first, the reverse of the order they were written', async () => {
    for (let i = 0; i < 6; i++) {
      const o = (await pg.query<{ id: string }>(`insert into orders (buyer_id, po, style, colour, qty, ex_factory) values ($1, $2, 's', 'c', 4550, '2026-11-20') returning id::text as id`, [ID.buyerB, `RED-${i}`])).rows[0]!.id
      await pg.query(`insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty) values ($1, $2, 'sewing', $3, '2026-11-11', 1, 4550)`, [o, ID.buyerB, ID.unit1])
      for (const d of ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03']) {
        await pg.query(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty) values (gen_random_uuid(), $1, $2, 'sewing', $3, $4, 350)`, [o, ID.buyerB, ID.unit1, d])
      }
    }
    await review()
    const written = (await pg.query<{ id: string }>('select id::text as id from outbox order by ctid')).rows.map((r) => r.id)
    expect(written).toHaveLength(7)
    const listed = (await app.inject({ url: '/api/outbox', headers: await merch() })).json().alerts.map((a: any) => a.id)
    expect(listed).toEqual([...written].reverse())
  })

  it('BE-025: the red alert subject names the stage the way its body does', async () => {
    await review()
    const [row] = (await pg.query<any>('select subject, body from outbox')).rows
    expect(row.subject).toBe('PO B-PO-88240: Sewing is red')
    expect(row.body).toMatch(/^Sewing for PO B-PO-88240 has turned red\./)
  })
})
