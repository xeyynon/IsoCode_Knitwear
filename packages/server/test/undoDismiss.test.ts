// Undo for the "Don't show" button (UI/UX plan slice 4.1): only for a warning that was still waiting for review.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
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
const row = async () => (await pg.query<any>(`select * from warning order by created_at`)).rows[0]
const firstId = async () => (await review()).needsReview[0].id as string
const undo = (id: string, h?: Record<string, string>) => act(`/api/warnings/${id}/undo-dismiss`, {}, h)

describe('undo of the Dont-show button', () => {
  it('brings a warning that was waiting for review back to waiting, unconfirmed, and nothing reaches a buyer', async () => {
    const id = await firstId()
    await act(`/api/warnings/${id}/dismiss`)
    expect((await review()).needsReview).toEqual([])
    expect((await undo(id)).statusCode).toBe(200)
    const r = await review()
    expect(r.needsReview.map((w: any) => w.id)).toEqual([id])
    expect(r.confirmed).toEqual([])
    const w = await row()
    expect([w.dismissed_at, w.dismissed_was_confirmed, w.confirmed_by, w.confirmed_at]).toEqual([null, null, null, null])
    expect((await pg.query(`select 1 from outbox where recipient_kind = 'buyer'`)).rows).toEqual([])   // undo sends nothing to a buyer
  })

  it('has no undo for a warning that had been confirmed: it stays hidden and needs a fresh confirmation', async () => {
    const id = await firstId()
    await act(`/api/warnings/${id}/confirm`)
    await act(`/api/warnings/${id}/dismiss`)
    const res = await undo(id)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('needs_confirmation')
    const r = await review()
    expect(r.needsReview).toEqual([]); expect(r.confirmed).toEqual([])
    expect((await row()).dismissed_at).not.toBeNull()
  })

  it('treats a warning hidden before the state was recorded as confirmed: no undo (the safe side)', async () => {
    const id = await firstId()
    await act(`/api/warnings/${id}/dismiss`)
    await pg.query(`update warning set dismissed_was_confirmed = null where id = $1`, [id])
    expect((await undo(id)).json().error.code).toBe('needs_confirmation')
  })

  it('refreshes the figures in the same transaction, so what comes back is what the order says now', async () => {
    const id = await firstId()
    const before = (await review()).needsReview[0].maths
    await act(`/api/warnings/${id}/dismiss`)
    // 100 more pieces today: the sum behind the warning changes while it is hidden.
    await pg.exec(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
                   values (gen_random_uuid(), '${ID.orderRed}', '${ID.buyerB}', 'sewing', '${ID.unit1}', '2026-11-04', 100)`)
    expect((await undo(id)).statusCode).toBe(200)
    expect((await row()).maths.text).not.toBe(before)                    // the stored sum was refreshed by the undo itself
    expect((await review()).needsReview[0].maths).toBe((await row()).maths.text)
  })

  it('is refused when the stage recovered while the warning was hidden, and changes nothing', async () => {
    const id = await firstId()
    await act(`/api/warnings/${id}/dismiss`)
    await pg.exec(`insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty)
                   values (gen_random_uuid(), '${ID.orderRed}', '${ID.buyerB}', 'sewing', '${ID.unit1}', '2026-11-04', 2800)`)   // the stage is now complete
    const res = await undo(id)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('not_open')
    expect((await review()).needsReview).toEqual([])
  })

  it('is refused once the colour changed: a person must look at the new warning, which is already waiting', async () => {
    const id = await firstId()
    await act(`/api/warnings/${id}/dismiss`)
    await pg.query(`update warning set status = 'amber' where id = $1`, [id])
    await review()                                                       // the engine says red, so the dismissal is dropped
    const res = await undo(id)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe('not_dismissed')
    expect((await review()).needsReview).toHaveLength(1)
  })

  it('a second undo, or an undo of a warning that was never hidden, is 409 not_dismissed', async () => {
    const id = await firstId()
    expect((await undo(id)).json().error.code).toBe('not_dismissed')
    await act(`/api/warnings/${id}/dismiss`)
    expect((await undo(id)).statusCode).toBe(200)
    expect((await undo(id)).json().error.code).toBe('not_dismissed')
  })

  it('can be hidden and undone again; the state is recorded afresh each time', async () => {
    const id = await firstId()
    await act(`/api/warnings/${id}/dismiss`); await undo(id)
    await act(`/api/warnings/${id}/confirm`); await act(`/api/warnings/${id}/dismiss`)
    expect((await row()).dismissed_was_confirmed).toBe(true)
    expect((await undo(id)).json().error.code).toBe('needs_confirmation')
  })

  it('answers 404 for an unknown warning and 400 for a malformed id', async () => {
    expect((await undo('00000000-0000-0000-0000-00000000dead')).statusCode).toBe(404)
    expect((await undo('nope')).statusCode).toBe(400)
  })

  it('is for merchandisers only: a supervisor is 403 and a stranger 401, and the warning is untouched', async () => {
    const id = await firstId()
    await act(`/api/warnings/${id}/dismiss`)
    expect((await undo(id, await sup())).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/api/warnings/${id}/undo-dismiss`, payload: {} })).statusCode).toBe(401)
    expect((await row()).dismissed_at).not.toBeNull()
  })
})
