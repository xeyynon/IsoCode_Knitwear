// OPT-LANE C: O-4, gzip for big JSON and validators (ETag, 304) for the polled routes.
import { gunzipSync } from 'node:zlib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, hashToken, memoryMediaStore, type Db } from '../src/index.js'
import { GZIP_MIN_BYTES, acceptsGzip, matchesTag } from '../src/httpCache.js'
import { CREDS, ID, TEMPLATE_ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const NOW = new Date('2026-11-04T04:30:00Z')
const SECRET = 'x'.repeat(40)
const ORIGIN = 'https://app.example.test'
const SUP2 = '00000000-0000-0000-0000-0000000000f2'
const MERCH2 = '00000000-0000-0000-0000-0000000000f3'
let pg: PGlite
let db: Db
let app: FastifyInstance
let media: ReturnType<typeof memoryMediaStore>
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => {
  await resetAndSeed(pg)
  media = memoryMediaStore()
  app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, media, allowedOrigins: [ORIGIN] })
})
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const get = (url: string, headers: Record<string, string>) => app.inject({ url, headers })
const post = (url: string, headers: Record<string, string>, payload: object = {}) => app.inject({ method: 'POST', url, headers, payload })
const etag = (r: { headers: Record<string, unknown> }) => String(r.headers.etag)

/** Plenty of fake orders (and their milestones) so the board is well over 1 KB. */
async function manyOrders(n: number) {
  for (let i = 0; i < n; i++) {
    const id = `00000000-0000-0000-0000-${String(0xa000 + i).padStart(12, '0')}`
    await pg.query(`insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ($1, $2, $3, 'tee', 'navy', 1000, '2026-11-25')`, [id, i % 2 ? ID.buyerB : ID.buyerC, `PO-GEN-${i}`])
    await pg.query(`insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty) values ($1, $2, 'sewing', $3, '2026-11-20', 1, 1000)`, [id, i % 2 ? ID.buyerB : ID.buyerC, i % 2 ? ID.unit1 : ID.unit2])
  }
}
const buyerLink = async (buyerId: string) => (await post('/api/buyer-links', await merch(), { buyerId })).json().token as string
const asBuyer = (t: string) => ({ authorization: `Bearer ${t}` })

describe('O-4: compression', () => {
  it('O-4: a big JSON body is gzipped for a client that accepts gzip, and unzipped it is the plain body byte for byte', async () => {
    await manyOrders(40)
    const h = await merch()
    const plain = await get('/api/board', h)
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.rawPayload.length).toBeGreaterThan(GZIP_MIN_BYTES)
    const zipped = await get('/api/board', { ...h, 'accept-encoding': 'gzip, deflate, br' })
    expect(zipped.statusCode).toBe(200)
    expect(zipped.headers['content-encoding']).toBe('gzip')
    expect(String(zipped.headers.vary).toLowerCase()).toContain('accept-encoding')
    expect(zipped.headers['content-type']).toMatch(/^application\/json/)
    expect(gunzipSync(zipped.rawPayload).equals(plain.rawPayload)).toBe(true)
    expect(Number(zipped.headers['content-length'])).toBe(zipped.rawPayload.length)
    expect(zipped.rawPayload.length).toBeLessThan(plain.rawPayload.length / 2)
    expect(etag(zipped)).toBe(etag(plain))
  })
  it('O-4: every JSON route that can be big compresses and decompresses to the plain body (board, review, my stages, buyer orders, orders, accounts)', async () => {
    await manyOrders(40)
    const m = await merch(), s = await sup(), b = asBuyer(await buyerLink(ID.buyerB))
    for (const [url, h] of [['/api/board', m], ['/api/review', m], ['/api/my/stages', s], ['/api/buyer/orders', b], ['/api/accounts', m], ['/api/templates', m]] as const) {
      const plain = await get(url, h)
      const zipped = await get(url, { ...h, 'accept-encoding': 'gzip' })
      expect(plain.statusCode, url).toBe(200)
      if (plain.rawPayload.length >= GZIP_MIN_BYTES) {
        expect(zipped.headers['content-encoding'], url).toBe('gzip')
        expect(gunzipSync(zipped.rawPayload).equals(plain.rawPayload), url).toBe(true)
      } else {
        expect(zipped.headers['content-encoding'], url).toBeUndefined()
        expect(zipped.rawPayload.equals(plain.rawPayload), url).toBe(true)
      }
    }
  })
  it('O-4: no gzip when the client does not ask for it, or ranks it zero; small bodies are left alone', async () => {
    await manyOrders(40)
    const h = await merch()
    for (const ae of [undefined, 'identity', 'br', 'gzip;q=0', 'deflate']) {
      const r = await get('/api/board', ae ? { ...h, 'accept-encoding': ae } : h)
      expect(r.headers['content-encoding'], String(ae)).toBeUndefined()
    }
    expect((await get('/api/board', { ...h, 'accept-encoding': 'GZIP;q=0.5' })).headers['content-encoding']).toBe('gzip')
    const small = await get('/api/me', { ...h, 'accept-encoding': 'gzip' })
    expect(small.headers['content-encoding']).toBeUndefined()
    expect(String(small.headers.vary ?? '').toLowerCase()).not.toContain('accept-encoding')   // BE-071: Vary: Origin is now on every answer when an allow-list is set; what matters here is that nothing varies on the encoding
    expect(acceptsGzip('gzip;q=0')).toBe(false)
    expect(acceptsGzip('br, gzip;q=0.8')).toBe(true)
  })
  it('O-4: photo bytes and CSV are never compressed, even when the client accepts gzip', async () => {
    const m = await merch(), s = await sup()
    const big = Buffer.alloc(8000, 0x41); big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff; big[big.length - 2] = 0xff; big[big.length - 1] = 0xd9
    const up = await app.inject({ method: 'POST', url: '/api/photos', headers: { ...s, 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': 'sewing', 'x-date': '2026-11-04' }, payload: big })
    expect(up.statusCode).toBe(200)
    const f = await get(`/api/photos/${up.json().id}/file`, { ...m, 'accept-encoding': 'gzip' })
    expect(f.statusCode).toBe(200)
    expect(f.headers['content-encoding']).toBeUndefined()
    expect(f.headers.etag).toBeUndefined()
    expect(f.rawPayload.equals(big)).toBe(true)
    await manyOrders(40)
    const csv = await get(`/api/buyers/${ID.buyerB}/export.csv`, { ...m, 'accept-encoding': 'gzip' })
    expect(csv.headers['content-type']).toMatch(/^text\/csv/)
    expect(csv.headers['content-encoding']).toBeUndefined()
  })
  it('O-4: the CORS Vary header is kept and Accept-Encoding is added to it; the validator can be read and sent back across origins', async () => {
    await manyOrders(40)
    const h = await merch()
    const r = await get('/api/board', { ...h, origin: ORIGIN, 'accept-encoding': 'gzip' })
    expect(String(r.headers.vary).split(/,\s*/).sort()).toEqual(['Accept-Encoding', 'Origin'])
    expect(r.headers['access-control-expose-headers']).toBe('ETag')
    const pre = await app.inject({ method: 'OPTIONS', url: '/api/board', headers: { origin: ORIGIN, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization,if-none-match' } })
    expect(String(pre.headers['access-control-allow-headers']).toLowerCase()).toContain('if-none-match')
  })
  it('O-4: compress: false switches it off', async () => {
    await manyOrders(40)
    const off = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, compress: false })
    const h = { authorization: `Bearer ${(await off.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token}`, 'accept-encoding': 'gzip' }
    expect((await off.inject({ url: '/api/board', headers: h })).headers['content-encoding']).toBeUndefined()
  })
})

describe('O-4: validators', () => {
  const routes = async (): Promise<[string, Record<string, string>][]> => [
    ['/api/board', await merch()], ['/api/review', await merch()], ['/api/my/stages', await sup()], ['/api/buyer/orders', asBuyer(await buyerLink(ID.buyerB))],
  ]
  it('O-4: the four polled routes carry an ETag, answer 304 with no body when it matches, and still say no-store', async () => {
    for (const [url, h] of await routes()) {
      const first = await get(url, h)
      expect(first.statusCode, url).toBe(200)
      const tag = etag(first)
      expect(tag, url).toMatch(/^W\/"[A-Za-z0-9_-]{20,}"$/)
      expect(first.headers['cache-control'], url).toBe('no-store')
      const again = await get(url, h)
      expect(etag(again), url).toBe(tag)                               // same answer, same tag
      const cond = await get(url, { ...h, 'if-none-match': tag })
      expect(cond.statusCode, url).toBe(304)
      expect(cond.rawPayload.length, url).toBe(0)
      expect(etag(cond), url).toBe(tag)
      expect(cond.headers['cache-control'], url).toBe('no-store')
      expect(cond.headers['content-type'], url).toBeUndefined()
      // other spellings of the same validator, a list, and the wildcard
      for (const inm of [tag.slice(2), `"nope", ${tag}`, `W/"nope",${tag}`, '*']) expect((await get(url, { ...h, 'if-none-match': inm })).statusCode, `${url} ${inm}`).toBe(304)
      expect((await get(url, { ...h, 'if-none-match': 'W/"something-else"' })).statusCode, url).toBe(200)
    }
    expect(matchesTag('W/"a", "b"', 'W/"b"')).toBe(true)
    expect(matchesTag(undefined, 'W/"b"')).toBe(false)
  })
  it('O-4: a 304 also saves the compression, and keeps the CORS headers', async () => {
    await manyOrders(40)
    const h = await merch()
    const tag = etag(await get('/api/board', h))
    const r = await get('/api/board', { ...h, 'if-none-match': tag, 'accept-encoding': 'gzip', origin: ORIGIN })
    expect(r.statusCode).toBe(304)
    expect(r.headers['content-encoding']).toBeUndefined()
    expect(r.headers['access-control-allow-origin']).toBe(ORIGIN)
  })
  it('O-4: other routes have no validator, and an error is never a 304', async () => {
    const h = await merch()
    expect((await get('/api/units', h)).headers.etag).toBeUndefined()
    expect((await get('/api/accounts', h)).headers.etag).toBeUndefined()
    const sup1 = await sup()
    const refused = await get('/api/board', { ...sup1, 'if-none-match': '*' })
    expect(refused.statusCode).toBe(403)
    expect((await app.inject({ url: '/api/board', headers: { 'if-none-match': '*' } })).statusCode).toBe(401)
  })

  // The tag moves whenever the answer does, after every kind of write.
  async function movesAfter(url: string, h: Record<string, string>, write: () => Promise<unknown>) {
    const a = await get(url, h)
    expect(a.statusCode).toBe(200)
    const t1 = etag(a)
    expect((await get(url, { ...h, 'if-none-match': t1 })).statusCode).toBe(304)
    await write()
    const b = await get(url, { ...h, 'if-none-match': t1 })
    expect(b.statusCode, `${url} after the write`).toBe(200)
    expect(b.rawPayload.equals(a.rawPayload)).toBe(false)
    expect(etag(b)).not.toBe(t1)
    expect((await get(url, { ...h, 'if-none-match': etag(b) })).statusCode).toBe(304)
  }
  const ev = (qty: number, date = '2026-11-04') => ({ clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date, qty })

  it('O-4: an update (event) moves the board and the stage list', async () => {
    const m = await merch(), s = await sup()
    await movesAfter('/api/board', m, () => post('/api/events', s, ev(900)))
    await movesAfter('/api/my/stages', s, () => post('/api/events', s, ev(40)))
  })
  it('O-4: an update that clears a warning moves the review', async () => {
    const m = await merch(), s = await sup()
    await movesAfter('/api/review', m, () => post('/api/events', s, ev(9000)))
  })
  it('O-4: a batch of updates moves the board', async () => {
    const m = await merch(), s = await sup()
    await movesAfter('/api/board', m, () => post('/api/events/batch', s, { events: [ev(300), ev(200, '2026-11-03')] }))
  })
  it('O-4: an ex-factory change moves the board and what the buyer sees', async () => {
    const m = await merch()
    const link = asBuyer(await buyerLink(ID.buyerB))
    await movesAfter('/api/board', m, () => post(`/api/orders/${ID.orderRed}/ex-factory`, m, { exFactory: '2026-11-27', reason: 'Buyer moved the ship date' }))
    await movesAfter('/api/buyer/orders', link, () => post(`/api/orders/${ID.orderRed}/ex-factory`, m, { exFactory: '2026-11-30', reason: 'Buyer moved it again' }))
  })
  it('O-4: a calendar change moves the board', async () => {
    const m = await merch()
    await movesAfter('/api/board', m, () => post('/api/calendar', m, { unitId: ID.unit1, date: '2026-11-06', working: false, note: 'Closed' }))
    await movesAfter('/api/board', m, () => post('/api/calendar/clear', m, { unitId: ID.unit1, date: '2026-11-06' }))
  })
  it('O-4: a new order moves the board, the stage list and what the buyer sees', async () => {
    const m = await merch(), s = await sup()
    const link = asBuyer(await buyerLink(ID.buyerB))
    let n = 0
    const create = () => post('/api/orders', m, { buyerId: ID.buyerB, po: `B-PO-9${n++}`, style: 'polo', colour: 'white', sizes: { S: 500, M: 1200 }, exFactory: '2026-11-20', templateId: TEMPLATE_ID })
    await movesAfter('/api/board', m, create)
    await movesAfter('/api/my/stages', s, create)
    await movesAfter('/api/buyer/orders', link, create)
  })
  it('O-4: confirming, dismissing and undoing a warning move the review, and confirming moves the buyer view', async () => {
    const m = await merch()
    const link = asBuyer(await buyerLink(ID.buyerB))
    const queue = async () => (await get('/api/review', m)).json()
    const id = (await queue()).needsReview[0].id as string
    await movesAfter('/api/review', m, () => post(`/api/warnings/${id}/dismiss`, m))
    await movesAfter('/api/review', m, () => post(`/api/warnings/${id}/undo-dismiss`, m))
    await movesAfter('/api/buyer/orders', link, () => post(`/api/warnings/${id}/confirm`, m))
    await movesAfter('/api/review', m, () => post(`/api/warnings/${id}/confirm`, m, { text: 'We are adding a shift on sewing.' }))
  })
  it('O-4: approving, withdrawing a photo moves the review and what the buyer sees', async () => {
    const m = await merch()
    const link = asBuyer(await buyerLink(ID.buyerB))
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = await pg.query<{ id: string }>(`insert into photo (client_uuid, order_id, buyer_id, storage_key, stage, unit_id, taken_on, bytes) values ($1, $2, $3, $4, 'sewing', $5, '2026-11-04', 2000) returning id::text as id`,
        [crypto.randomUUID(), ID.orderRed, ID.buyerB, `photos/${crypto.randomUUID()}.jpg`, ID.unit1])
      ids.push(r.rows[0]!.id)
    }
    await movesAfter('/api/review', m, () => post(`/api/photos/${ids[0]}/approve`, m))
    await movesAfter('/api/buyer/orders', link, () => post(`/api/photos/${ids[1]}/approve`, m))
    await movesAfter('/api/review', m, () => post(`/api/photos/${ids[0]}/reject`, m))
    await movesAfter('/api/buyer/orders', link, () => post(`/api/photos/${ids[1]}/reject`, m))
  })
  it('O-4: a change made behind the app (SQL, another process) moves the tag too, because it is a hash of the body just built', async () => {
    const m = await merch()
    await movesAfter('/api/board', m, () => pg.query(`update orders set colour = 'green-ish' where id = $1`, [ID.orderRed]))
  })
  it('O-4: a note or a revoked link: a revoked buyer link is a 401, never a 304', async () => {
    const m = await merch()
    const made = (await post('/api/buyer-links', m, { buyerId: ID.buyerB })).json() as { id: string; token: string }
    const h = asBuyer(made.token)
    const tag = etag(await get('/api/buyer/orders', h))
    expect((await get('/api/buyer/orders', { ...h, 'if-none-match': tag })).statusCode).toBe(304)
    await post(`/api/buyer-links/${made.id}/revoke`, m)
    expect((await get('/api/buyer/orders', { ...h, 'if-none-match': tag })).statusCode).toBe(401)
    void hashToken
  })

  it('O-4: no 304 across people: one person\'s tag sent by another, on the same address, gets that other person\'s own answer', async () => {
    await pg.query(`insert into account (id, role, phone, pin_hash, unit_id) select $1, 'supervisor', '9123456780', pin_hash, $2 from account where id = $3`, [SUP2, ID.unit2, ID.sup1])
    await pg.query(`insert into account (id, role, email, password_hash) select $1, 'merchandiser', 'm2@example.test', password_hash from account where id = $2`, [MERCH2, ID.merch])
    const s1 = await sup()
    const s2 = await login({ phone: '9123456780', pin: CREDS.pin })
    const a = await get('/api/my/stages', s1), b = await get('/api/my/stages', s2)
    expect(a.json().stages.length).toBeGreaterThan(0)
    expect(a.rawPayload.equals(b.rawPayload)).toBe(false)               // different units, different lists
    expect(etag(a)).not.toBe(etag(b))
    const cross = await get('/api/my/stages', { ...s2, 'if-none-match': etag(a) })
    expect(cross.statusCode).toBe(200)
    expect(cross.json()).toEqual(b.json())
    // two people whose bodies are identical still do not share a tag
    const m1 = await merch()
    const m2 = await login({ email: 'm2@example.test', password: CREDS.password })
    const ba = await get('/api/board', m1), bb = await get('/api/board', m2)
    expect(ba.rawPayload.equals(bb.rawPayload)).toBe(true)
    expect(etag(ba)).not.toBe(etag(bb))
    expect((await get('/api/board', { ...m2, 'if-none-match': etag(ba) })).statusCode).toBe(200)
    // two buyers
    const lb = asBuyer(await buyerLink(ID.buyerB)), lc = asBuyer(await buyerLink(ID.buyerC))
    const vb = await get('/api/buyer/orders', lb), vc = await get('/api/buyer/orders', lc)
    const crossBuyer = await get('/api/buyer/orders', { ...lc, 'if-none-match': etag(vb) })
    expect(crossBuyer.statusCode).toBe(200)
    expect(crossBuyer.body).toBe(vc.body)
    expect(crossBuyer.body).not.toContain('Buyer B')
  })
})
