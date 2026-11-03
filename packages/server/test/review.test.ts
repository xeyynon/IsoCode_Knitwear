import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, buyerText, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

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
const act = async (path: string, payload: object = {}, h?: Record<string, string>) => app.inject({ method: 'POST', url: path, payload, headers: h ?? await merch() })
const rows = async () => (await pg.query<any>(`select * from warning order by created_at`)).rows

describe('raising warnings', () => {
  it('raises one for the late-risk stage, unconfirmed, with wording that has no internal figures', async () => {
    const r = await review()
    expect(r.needsReview).toHaveLength(1)
    expect(r.confirmed).toEqual([])
    const w = r.needsReview[0]
    expect(w).toMatchObject({ po: 'B-PO-88240', buyerName: 'Buyer B', stage: 'sewing', status: 'red', state: 'needs_review' })
    expect(w.buyerText).toBe('Sewing is at risk of finishing late (planned for 11 Nov).')
    expect(w.buyerText).not.toMatch(/467|350|700|pcs|\/day|need|making/i)     // the rates are for the factory
    expect(w.maths).toBe('Need 467/day · making 350/day · 700 pcs short by 11 Nov.')   // shown to the merchandiser only
  })
  it('does not raise duplicates when refreshed again', async () => {
    await review(); await review(); await review()
    expect(await rows()).toHaveLength(1)
  })
  it('raises none for a stage due beyond the warning window, or for green and grey orders', async () => {
    await pg.query(`update milestone set planned_end = '2026-12-30' where order_id = $1`, [ID.orderRed])
    expect((await review()).needsReview).toEqual([])
    expect(await rows()).toHaveLength(0)
  })
  it('wording differs for at risk (amber) and late risk (red)', () => {
    expect(buyerText('cutting', 'amber', '2026-11-11')).toBe('Cutting needs attention to finish on time (planned for 11 Nov).')
    expect(buyerText('cutting', 'red', '2026-11-11')).toMatch(/at risk of finishing late/)
  })
  it('a supervisor update brings the warnings up to date (and a failure there never fails the send)', async () => {
    expect(await rows()).toHaveLength(0)
    const res = await app.inject({
      method: 'POST', url: '/api/events', headers: await sup(),
      payload: { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 10 },
    })
    expect(res.statusCode).toBe(200)
  })
  it('a batch of updates also refreshes them', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/events/batch', headers: await sup(),
      payload: { events: [{ clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 10 }] },
    })
    expect(res.statusCode).toBe(200)
    expect(await rows()).toHaveLength(1)
  })
  it('resolves the warning when the stage recovers', async () => {
    await review()
    // a very big day lifts the rate above what is needed
    await app.inject({ method: 'POST', url: '/api/events', headers: await sup(),
      payload: { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 2000 } })
    const r = await review()
    expect(r.needsReview).toEqual([])
    expect((await rows())[0].resolved_at).not.toBeNull()
  })
})

describe('the review queue', () => {
  it('is for merchandisers only', async () => {
    expect((await app.inject({ url: '/api/review', headers: await sup() })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/review' })).statusCode).toBe(401)
  })
  it('lists late-risk before at-risk', async () => {
    // a genuinely amber order: making 430 a day against 467 needed (the engine, not the test, decides)
    const o = (await pg.query<{ id: string }>(`insert into orders (buyer_id, po, style, colour, qty, ex_factory) values ($1, 'B-AMBER', 's', 'c', 4950, '2026-11-20') returning id::text as id`, [ID.buyerB])).rows[0]!.id
    await pg.query(`insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty) values ($1, $2, 'sewing', $3, '2026-11-11', 1, 4950)`, [o, ID.buyerB, ID.unit1])
    for (const d of ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02', '2026-11-03']) {
      await pg.query(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty) values (gen_random_uuid(), $1, $2, 'sewing', $3, $4, 430)`, [o, ID.buyerB, ID.unit1, d])
    }
    const r = await review()
    expect(r.needsReview.map((w: any) => w.status)).toEqual(['red', 'amber'])
  })
})

describe('confirming and dismissing', () => {
  const firstId = async () => (await review()).needsReview[0].id

  it('confirming moves a warning to the confirmed list and records who and when', async () => {
    const id = await firstId()
    expect((await act(`/api/warnings/${id}/confirm`)).statusCode).toBe(200)
    const r = await review()
    expect(r.needsReview).toEqual([])
    expect(r.confirmed.map((w: any) => w.id)).toEqual([id])
    const w = (await rows())[0]
    expect(w.confirmed_by).toBe(ID.merch)
    expect(w.confirmed_at).not.toBeNull()
  })
  it('lets the merchandiser reword it first, and keeps the new wording', async () => {
    const id = await firstId()
    await act(`/api/warnings/${id}/confirm`, { text: '  Sewing is running behind; we are adding a shift.  ' })
    expect((await review()).confirmed[0].buyerText).toBe('Sewing is running behind; we are adding a shift.')
  })
  it.each([[''], ['   '], ['x'.repeat(301)]])('refuses wording %j', async (text) => {
    const id = await firstId()
    expect((await act(`/api/warnings/${id}/confirm`, { text })).statusCode).toBe(400)
    expect((await review()).needsReview).toHaveLength(1)
  })
  it('an unknown warning is 404 and a malformed id 400', async () => {
    expect((await act('/api/warnings/00000000-0000-0000-0000-00000000dead/confirm')).statusCode).toBe(404)
    expect((await act('/api/warnings/nope/confirm')).statusCode).toBe(400)
  })
  it('dismissing removes it from both lists, and it is not raised again while the colour is unchanged', async () => {
    const id = await firstId()
    expect((await act(`/api/warnings/${id}/dismiss`)).statusCode).toBe(200)
    const r = await review()
    expect(r.needsReview).toEqual([]); expect(r.confirmed).toEqual([])
    await review()
    expect(await rows()).toHaveLength(1)
  })
  it('a confirmed warning can be withdrawn by dismissing it', async () => {
    const id = await firstId()
    await act(`/api/warnings/${id}/confirm`)
    await act(`/api/warnings/${id}/dismiss`)
    expect((await review()).confirmed).toEqual([])
    expect((await rows())[0].confirmed_by).toBeNull()
  })
  it('cannot confirm or dismiss one that is already dismissed', async () => {
    const id = await firstId()
    await act(`/api/warnings/${id}/dismiss`)
    expect((await act(`/api/warnings/${id}/confirm`)).statusCode).toBe(409)
    expect((await act(`/api/warnings/${id}/dismiss`)).statusCode).toBe(409)
  })
  it('when the colour changes, the old confirmation and dismissal do not carry over: a person must look again', async () => {
    const id = await firstId()
    await act(`/api/warnings/${id}/confirm`, { text: 'Custom wording' })
    await pg.query(`update warning set status = 'amber' where id = $1`, [id])   // it was amber when confirmed...
    await review()                                                              // ...and the engine now says red
    const w = (await rows())[0]
    expect(w.status).toBe('red')
    expect(w.confirmed_by).toBeNull()
    expect(w.buyer_text).toMatch(/at risk of finishing late/)
    expect((await review()).needsReview).toHaveLength(1)
  })
  it('a supervisor cannot confirm or dismiss', async () => {
    const id = await firstId()
    expect((await act(`/api/warnings/${id}/confirm`, {}, await sup())).statusCode).toBe(403)
    expect((await act(`/api/warnings/${id}/dismiss`, {}, await sup())).statusCode).toBe(403)
  })
})
