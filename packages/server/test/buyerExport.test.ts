import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// The weekly file for one buyer: the same isolation as the page, and no more than the page shows.
let now = new Date('2026-11-04T04:30:00Z')
let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => {
  await resetAndSeed(pg)
  now = new Date('2026-11-04T04:30:00Z')
  app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => now })
  await pg.query(`insert into warning (order_id, buyer_id, stage, status, maths, buyer_text, confirmed_by, confirmed_at)
                  values ($1, $2, 'sewing', 'red', '{}', 'C-SECRET-WARNING-TEXT', $3, now())`, [ID.orderGreen, ID.buyerC, ID.merch])
})
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const asBuyer = (token: string) => ({ authorization: `Bearer ${token}` })
async function makeLink(buyerId: string, over: object = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await merch(), payload: { buyerId, ...over } })
  return res.json() as { id: string; token: string }
}
const file = (token: string, url = '/api/buyer/export.csv') => app.inject({ url, headers: asBuyer(token) })
const WORDING = /need|making|\/day|pcs|short|projected|status|maths|rate|colour: |confirmed_by|token|hash|password|note|photo/i

describe('a buyer downloads their own orders', () => {
  it('is a CSV with a byte order mark, named for the buyer, never cached', async () => {
    const res = await file((await makeLink(ID.buyerB)).token)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(res.headers['content-disposition']).toBe('attachment; filename="orders-buyer-b-2026-11-04.csv"')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(res.body.slice(1).split('\r\n').filter(Boolean)).toEqual([
      'PO,Style,Colour,Quantity,Ex-factory,Stage,Planned finish,Notice from the factory',
      'B-PO-88240,tee,navy,4550,2026-11-20,Sewing,2026-11-11,',
      'B-PO-88213,tee,grey,3000,2026-11-25,Sewing,2026-11-20,',
    ])
  })

  it('carries a confirmed notice, with Tamil and a comma kept intact, and not an unconfirmed one', async () => {
    const { token } = await makeLink(ID.buyerB)
    const id = (await app.inject({ url: '/api/review', headers: await merch() })).json().needsReview[0].id
    expect((await file(token)).body).not.toMatch(/at risk|behind|late/i)                  // raised, not yet confirmed
    await app.inject({ method: 'POST', url: `/api/warnings/${id}/confirm`, headers: await merch(), payload: { text: 'Sewing is behind, "adding a shift" இன்று' } })
    expect((await file(token)).body).toContain('Sewing,2026-11-11,"Sewing is behind, ""adding a shift"" இன்று"')
    await app.inject({ method: 'POST', url: `/api/warnings/${id}/dismiss`, headers: await merch() })
    expect((await file(token)).body).not.toContain('adding a shift')                      // withdrawn
  })

  it('shows no buyer another buyer, and no internal wording, note or figure', async () => {
    await app.inject({ method: 'POST', url: '/api/events', headers: await sup(),
      payload: { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 100, note: { text: 'SECRET-NOTE-TEXT', category: 'machine' } } })
    await pg.query(`insert into photo (order_id, buyer_id, storage_key, approved_by) values ($1, $2, 'b-approved-photo', $3)`, [ID.orderRed, ID.buyerB, ID.merch])
    const { token } = await makeLink(ID.buyerB)
    const id = (await app.inject({ url: '/api/review', headers: await merch() })).json().needsReview[0].id
    await app.inject({ method: 'POST', url: `/api/warnings/${id}/confirm`, headers: await merch(), payload: {} })   // the engine's own wording
    const body = (await file(token)).body
    expect(body).toMatch(/risk|late/i)                                                    // the confirmed notice is there ...
    expect(body.replace(/Notice from the factory/, '')).not.toMatch(WORDING)              // ... and none of the maths wording is
    for (const secret of ['C-PO-0488', 'Buyer C', 'C-SECRET-WARNING-TEXT', 'SECRET-NOTE-TEXT', 'b-approved-photo', ID.buyerC, ID.orderGreen, ID.orderRed, ID.unit1, 'Unit']) {
      expect(body).not.toContain(secret)
    }
    // Opening the review queue refreshed the warnings and retired the planted one: plant it again for C.
    await pg.query(`update warning set resolved_at = null where buyer_id = $1`, [ID.buyerC])
    const csv = await file((await makeLink(ID.buyerC)).token)
    expect(csv.body).toContain('C-PO-0488')
    expect(csv.body).toContain('C-SECRET-WARNING-TEXT')
    expect(csv.body).not.toMatch(/B-PO|Buyer B/)
  })

  it('cannot be pointed at another buyer by address, parameter or header', async () => {
    const { token } = await makeLink(ID.buyerB)
    const urls = [`/api/buyer/export.csv?buyerId=${ID.buyerC}`, `/api/buyer/export.csv?buyer_id=${ID.buyerC}`, `/api/buyer/export.csv?orderId=${ID.orderGreen}`,
      '/api/buyer/export.csv?po=C-PO-0488', `/api/buyer/export.csv?id=${ID.buyerC}`]
    for (const url of urls) {
      const res = await file(token, url)
      expect(res.statusCode, url).toBe(200)
      expect(res.body, url).not.toMatch(/C-PO|Buyer C|C-SECRET/)
      expect(res.body, url).toContain('B-PO-88240')
    }
    const res = await app.inject({ url: '/api/buyer/export.csv', headers: { ...asBuyer(token), 'x-buyer-id': ID.buyerC } })
    expect(res.body).not.toContain('C-PO-0488')
    // Buyer B's link opens no route that names a buyer: the merchandiser route refuses it like every other.
    for (const url of [`/api/buyers/${ID.buyerC}/export.csv`, `/api/buyers/${ID.buyerB}/export.csv`]) {
      const refused = await app.inject({ url, headers: asBuyer(token) })
      expect(refused.statusCode, url).toBe(401)
      expect(refused.body).not.toMatch(/C-PO|B-PO|Buyer [BC]/)
    }
  })

  it('refuses unknown, tampered, revoked and expired links with the same answer as the page', async () => {
    const live = await makeLink(ID.buyerB)
    const revoked = await makeLink(ID.buyerB)
    await app.inject({ method: 'POST', url: `/api/buyer-links/${revoked.id}/revoke`, headers: await merch() })
    const short = await makeLink(ID.buyerB, { days: 1 })
    now = new Date(now.getTime() + 2 * 86_400_000)
    const cases: Record<string, Record<string, string>> = {
      none: {}, garbage: asBuyer('garbage'), tampered: asBuyer(live.token.slice(0, -1) + (live.token.endsWith('A') ? 'B' : 'A')),
      revoked: asBuyer(revoked.token), expired: asBuyer(short.token),
      staff: await merch(), supervisor: await sup(),
    }
    const page = await app.inject({ url: '/api/buyer/orders', headers: {} })
    for (const [name, headers] of Object.entries(cases)) {
      const res = await app.inject({ url: '/api/buyer/export.csv', headers })
      expect(res.statusCode, name).toBe(401)
      expect(res.body, name).toBe(page.body)
      expect(res.headers['content-type'], name).toMatch(/json/)
    }
    expect((await file(live.token)).statusCode).toBe(200)
  })
})

describe('a merchandiser downloads a buyer\'s file', () => {
  it('gets the same file the buyer would, by buyer id', async () => {
    const { token } = await makeLink(ID.buyerB)
    const mine = await app.inject({ url: `/api/buyers/${ID.buyerB}/export.csv`, headers: await merch() })
    expect(mine.statusCode).toBe(200)
    expect(mine.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(mine.headers['content-disposition']).toBe('attachment; filename="orders-buyer-b-2026-11-04.csv"')
    expect(mine.body).toBe((await file(token)).body)
    const other = await app.inject({ url: `/api/buyers/${ID.buyerC}/export.csv`, headers: await merch() })
    expect(other.body).toContain('C-PO-0488')
    expect(other.body).not.toMatch(/B-PO/)
  })
  it('is for merchandisers only', async () => {
    expect((await app.inject({ url: `/api/buyers/${ID.buyerB}/export.csv`, headers: await sup() })).statusCode).toBe(403)
    expect((await app.inject({ url: `/api/buyers/${ID.buyerB}/export.csv` })).statusCode).toBe(401)
  })
  it('says no for an unknown or malformed buyer', async () => {
    expect((await app.inject({ url: '/api/buyers/00000000-0000-0000-0000-00000000dead/export.csv', headers: await merch() })).statusCode).toBe(404)
    expect((await app.inject({ url: '/api/buyers/x/export.csv', headers: await merch() })).statusCode).toBe(400)
  })
})

describe('the database still scopes the file to its buyer', () => {
  it('a buyer-scoped transaction cannot read the other buyer even when asked for them by id', async () => {
    const { getBuyerViewFor } = await import('../src/buyerService.js')
    // The code asks as staff would, but the transaction is B's: the database answers as if C did not exist.
    await expect(db.tx({ role: 'buyer', buyerId: ID.buyerB }, (tx) => getBuyerViewFor(tx, { role: 'merchandiser' }, ID.buyerC))).rejects.toMatchObject({ status: 404 })
  })
})
