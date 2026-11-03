import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, hashToken, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

let now = new Date('2026-11-04T04:30:00Z')
let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => {
  await resetAndSeed(pg)
  now = new Date('2026-11-04T04:30:00Z')
  app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => now })
  // Buyer C: data that must NEVER appear to buyer B, with markers that are easy to search for
  await pg.query(`insert into warning (order_id, buyer_id, stage, status, maths, buyer_text, confirmed_by, confirmed_at)
                  values ($1, $2, 'sewing', 'red', '{}', 'C-SECRET-WARNING-TEXT', $3, now())`, [ID.orderGreen, ID.buyerC, ID.merch])
  await pg.query(`insert into photo (order_id, buyer_id, storage_key, approved_by) values ($1, $2, 'c-secret-photo', $3)`, [ID.orderGreen, ID.buyerC, ID.merch])
})
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const asBuyer = (token: string) => ({ authorization: `Bearer ${token}` })

async function makeLink(buyerId: string, over: object = {}) {
  const res = await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await merch(), payload: { buyerId, ...over } })
  expect(res.statusCode).toBe(201)
  return res.json() as { id: string; token: string; expiresAt: string }
}
const view = (token: string, url = '/api/buyer/orders') => app.inject({ url, headers: asBuyer(token) })

describe('a buyer sees only their own data', () => {
  it('lists the buyer\'s own orders with their milestones, and nothing of another buyer', async () => {
    const { token } = await makeLink(ID.buyerB)
    const res = await view(token)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.buyer.name).toBe('Buyer B')
    expect(body.orders.map((o: any) => o.po)).toEqual(['B-PO-88240', 'B-PO-88213'])      // by ship date
    expect(body.orders[0].milestones).toEqual([{ stage: 'sewing', plannedEnd: '2026-11-11' }])
    expect(body.orders[0]).toMatchObject({ style: 'tee', colour: 'navy', qty: 4550, exFactory: '2026-11-20' })
    const text = res.body
    for (const secret of ['C-PO-0488', 'Buyer C', 'C-SECRET-WARNING-TEXT', 'c-secret-photo', 'Unit 2', ID.buyerC, ID.orderGreen, ID.unit2]) {
      expect(text).not.toContain(secret)
    }
  })

  it("buyer C gets C's data and none of B's", async () => {
    const res = await view((await makeLink(ID.buyerC)).token)
    const body = res.json()
    expect(body.orders.map((o: any) => o.po)).toEqual(['C-PO-0488'])
    expect(body.orders[0].warnings.map((w: any) => w.text)).toEqual(['C-SECRET-WARNING-TEXT'])
    expect(res.body).not.toMatch(/B-PO|Buyer B/)
  })

  it('shows no internal figures, colours, rates or notes', async () => {
    const res = await view((await makeLink(ID.buyerB)).token)
    expect(res.body).not.toMatch(/need|making|\/day|pcs|short|projected|status|maths|confirmed_by|token|hash|password/i)
    expect(Object.keys(res.json().orders[0]).sort()).toEqual(['colour', 'exFactory', 'milestones', 'photos', 'po', 'qty', 'style', 'warnings'])
  })

  it('cannot be pointed at another buyer through the address or the headers', async () => {
    const { token } = await makeLink(ID.buyerB)
    for (const url of [`/api/buyer/orders?buyerId=${ID.buyerC}`, `/api/buyer/orders?buyer_id=${ID.buyerC}`, `/api/buyer/orders?orderId=${ID.orderGreen}`, `/api/buyer/orders?po=C-PO-0488`]) {
      const res = await view(token, url)
      expect(res.json().orders.map((o: any) => o.po)).toEqual(['B-PO-88240', 'B-PO-88213'])
    }
    const res = await app.inject({ url: '/api/buyer/orders', headers: { ...asBuyer(token), 'x-buyer-id': ID.buyerC } })
    expect(res.json().buyer.name).toBe('Buyer B')
  })

  it('is never cached and never leaks the link through a referrer', async () => {
    const res = await view((await makeLink(ID.buyerB)).token)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
  })
})

describe('only reviewed information reaches a buyer', () => {
  it('shows a warning only after a merchandiser confirms it', async () => {
    const { token } = await makeLink(ID.buyerB)
    const queue = (await app.inject({ url: '/api/review', headers: await merch() })).json()
    const id = queue.needsReview[0].id
    expect((await view(token)).json().orders[0].warnings).toEqual([])                  // raised, not yet confirmed: invisible
    await app.inject({ method: 'POST', url: `/api/warnings/${id}/confirm`, headers: await merch(), payload: { text: 'Sewing is running behind; we are adding a shift.' } })
    const w = (await view(token)).json().orders[0].warnings
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ stage: 'sewing', severity: 'late_risk', text: 'Sewing is running behind; we are adding a shift.' })
    await app.inject({ method: 'POST', url: `/api/warnings/${id}/dismiss`, headers: await merch() })
    expect((await view(token)).json().orders[0].warnings).toEqual([])                  // withdrawn
  })

  it('hides unconfirmed, dismissed and resolved warnings, and unapproved photos', async () => {
    const { token } = await makeLink(ID.buyerB)
    const add = (stage: string, text: string, cols: string, vals: string) => pg.query(
      `insert into warning (order_id, buyer_id, stage, status, maths, buyer_text, ${cols}) values ($1, $2, $3, 'red', '{}', $4, ${vals})`, [ID.orderNew, ID.buyerB, stage, text, ...(vals.includes('$5') ? [ID.merch] : [])])
    await add('cutting', 'UNCONFIRMED', 'created_at', 'now()')
    await add('sewing', 'DISMISSED', 'confirmed_by, dismissed_at', '$5, now()')
    await add('finishing', 'RESOLVED', 'confirmed_by, resolved_at', '$5, now()')
    await add('packing', 'VISIBLE', 'confirmed_by, confirmed_at', '$5, now()')
    await pg.query(`insert into photo (order_id, buyer_id, storage_key, approved_by) values ($1, $2, 'b-unapproved', null), ($1, $2, 'b-approved', $3)`, [ID.orderNew, ID.buyerB, ID.merch])
    const o = (await view(token)).json().orders.find((x: any) => x.po === 'B-PO-88213')
    expect(o.warnings.map((w: any) => w.text)).toEqual(['VISIBLE'])
    expect(o.photos).toHaveLength(1)
  })
})

describe('a link opens the buyer view and nothing else', () => {
  it.each([
    ['GET', '/api/board'], ['GET', '/api/me'], ['GET', '/api/my/stages'], ['GET', '/api/review'], ['GET', '/api/buyer-links'],
    ['GET', '/api/orders/options'], ['GET', `/api/orders/${ID.orderGreen}`], ['GET', `/api/orders/${ID.orderRed}`],
    ['POST', '/api/orders/preview'], ['POST', '/api/orders'], ['POST', '/api/events'], ['POST', '/api/events/batch'],
    ['POST', '/api/buyer-links'], ['POST', `/api/orders/${ID.orderRed}/ex-factory`], ['POST', '/api/warnings/00000000-0000-0000-0000-00000000dead/confirm'],
    ['POST', '/api/buyer-links/00000000-0000-0000-0000-00000000dead/revoke'], ['GET', '/api/anything-added-later'],
  ])('%s %s with a buyer link is refused', async (method, url) => {
    const { token } = await makeLink(ID.buyerB)
    const res = await app.inject({ method: method as 'GET', url, headers: asBuyer(token), payload: method === 'POST' ? {} : undefined })
    expect(res.statusCode).toBe(401)
    expect(res.body).not.toMatch(/B-PO|C-PO|Buyer [BC]/)
  })

  it('a sign-in token (merchandiser or supervisor) does not open the buyer view', async () => {
    expect((await app.inject({ url: '/api/buyer/orders', headers: await merch() })).statusCode).toBe(401)
    expect((await app.inject({ url: '/api/buyer/orders', headers: await sup() })).statusCode).toBe(401)
  })
})

describe('bad links all look the same', () => {
  const bad = async () => {
    const live = await makeLink(ID.buyerB)
    const revoked = await makeLink(ID.buyerB)
    await app.inject({ method: 'POST', url: `/api/buyer-links/${revoked.id}/revoke`, headers: await merch() })
    const short = await makeLink(ID.buyerB, { days: 1 })
    return { live, revoked, short }
  }

  it('unknown, wrong prefix, empty, tampered, revoked and expired links give the same refusal', async () => {
    const { live, revoked, short } = await bad()
    now = new Date(now.getTime() + 2 * 86_400_000)                       // the one-day link has now expired
    const flipped = live.token.slice(0, -1) + (live.token.endsWith('A') ? 'B' : 'A')
    const cases: Record<string, any> = {
      none: {}, empty: { authorization: 'Bearer ' }, garbage: asBuyer('garbage'), unknownWithPrefix: asBuyer('bl_' + 'x'.repeat(32)),
      wrongPrefix: asBuyer(live.token.replace('bl_', 'xx_')), tampered: asBuyer(flipped), revoked: asBuyer(revoked.token), expired: asBuyer(short.token),
      huge: asBuyer('bl_' + 'x'.repeat(5000)),
    }
    const bodies = new Set<string>()
    for (const [name, headers] of Object.entries(cases)) {
      const res = await app.inject({ url: '/api/buyer/orders', headers })
      expect(res.statusCode, name).toBe(401)
      bodies.add(res.body)
    }
    expect(bodies.size).toBe(1)                                           // nothing tells an attacker which case it was
    expect((await view(live.token)).statusCode).toBe(200)                 // and the good one still works
  })
  it('revoking cuts access at once', async () => {
    const { id, token } = await makeLink(ID.buyerB)
    expect((await view(token)).statusCode).toBe(200)
    await app.inject({ method: 'POST', url: `/api/buyer-links/${id}/revoke`, headers: await merch() })
    expect((await view(token)).statusCode).toBe(401)
  })
})

describe('making and managing links', () => {
  it('stores only a hash of the token, and never returns the token again', async () => {
    const { id, token } = await makeLink(ID.buyerB, { label: 'Anna at Buyer B' })
    const { rows } = await pg.query<{ token_hash: string }>(`select token_hash from buyer_link where id = $1`, [id])
    expect(rows[0]!.token_hash).toBe(hashToken(token))
    expect(rows[0]!.token_hash).not.toBe(token)
    expect((await pg.query(`select 1 from buyer_link where token_hash = $1`, [token])).rows).toHaveLength(0)
    const list = (await app.inject({ url: '/api/buyer-links', headers: await merch() })).json()
    expect(JSON.stringify(list)).not.toContain(token)
    expect(JSON.stringify(list)).not.toContain(rows[0]!.token_hash)
    expect(list.links[0]).toMatchObject({ id, buyerName: 'Buyer B', label: 'Anna at Buyer B', revoked: false, expired: false })
  })
  it('tokens are long, random and unique', async () => {
    const tokens = await Promise.all([1, 2, 3, 4, 5].map(async () => (await makeLink(ID.buyerB)).token))
    expect(new Set(tokens).size).toBe(5)
    for (const t of tokens) expect(t).toMatch(/^bl_[A-Za-z0-9_-]{32}$/)
  })
  it('lasts 30 days by default and up to 180, and no more', async () => {
    const d = await makeLink(ID.buyerB)
    expect(Date.parse(d.expiresAt) - now.getTime()).toBe(30 * 86_400_000)
    expect((await makeLink(ID.buyerB, { days: 180 })).id).toBeTruthy()
    for (const days of [0, 181, 1.5, -3, 'x']) {
      expect((await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await merch(), payload: { buyerId: ID.buyerB, days } })).statusCode).toBe(400)
    }
  })
  it('refuses an unknown buyer (404) and a malformed one (400)', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await merch(), payload: { buyerId: '00000000-0000-0000-0000-00000000dead' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await merch(), payload: { buyerId: 'x' } })).statusCode).toBe(400)
  })
  it('is for merchandisers: a supervisor cannot make, list or revoke links', async () => {
    const { id } = await makeLink(ID.buyerB)
    expect((await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await sup(), payload: { buyerId: ID.buyerB } })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/buyer-links', headers: await sup() })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/api/buyer-links/${id}/revoke`, headers: await sup() })).statusCode).toBe(403)
  })
  it('marks an expired link as expired in the list', async () => {
    await makeLink(ID.buyerB, { days: 1 })
    now = new Date(now.getTime() + 3 * 86_400_000)
    expect((await app.inject({ url: '/api/buyer-links', headers: await merch() })).json().links[0].expired).toBe(true)
  })
})

describe('the database itself refuses cross-buyer reads, whatever the code does', () => {
  it('a buyer-scoped transaction cannot read another buyer even with a hand-written query', async () => {
    const ctx = { role: 'buyer' as const, buyerId: ID.buyerB }
    const seen = await db.tx(ctx, async (tx) => ({
      orders: await tx.query('select po from orders'),
      cOrderById: await tx.query('select po from orders where id = $1', [ID.orderGreen]),
      cMilestones: await tx.query('select 1 from milestone where buyer_id = $1', [ID.buyerC]),
      cWarnings: await tx.query('select 1 from warning where buyer_id = $1', [ID.buyerC]),
      cPhotos: await tx.query('select 1 from photo where buyer_id = $1', [ID.buyerC]),
      events: await tx.query('select 1 from update_event'),
      links: await tx.query('select 1 from buyer_link'),
      accounts: await tx.query('select 1 from account'),
    }))
    expect(seen.orders.map((r: any) => r.po).sort()).toEqual(['B-PO-88213', 'B-PO-88240'])
    for (const k of ['cOrderById', 'cMilestones', 'cWarnings', 'cPhotos', 'events', 'links', 'accounts'] as const) expect(seen[k], k).toHaveLength(0)
  })
})
