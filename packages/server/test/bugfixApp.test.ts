import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { CREDS, ID, TEMPLATE_ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// Fixes in app.ts: BE-011 (CORS headers), BE-015 (one clock reading), BE-021 (HEAD health), BE-026 (201 on a new template),
// BE-027 (a new order refreshes the warnings) and BE-032 (the Bearer word in any case).
const NOW = new Date('2026-11-04T04:30:00Z')
const ORIGIN = 'https://app.example.test'
let pg: PGlite
let db: Db
let app: FastifyInstance
let clockCalls = 0
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => {
  await resetAndSeed(pg)
  clockCalls = 0
  app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => { clockCalls++; return NOW }, allowedOrigins: [ORIGIN] })
})
afterAll(async () => { await pg.close() })

const tokenOf = async (b: object) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token as string
const merch = async () => ({ authorization: `Bearer ${await tokenOf({ email: CREDS.email, password: CREDS.password })}` })

describe('BE-011: the preflight lists every header the photo upload sends', () => {
  it('BE-011: OPTIONS for a photo upload allows the four X- headers as well as Authorization and Content-Type', async () => {
    const res = await app.inject({
      method: 'OPTIONS', url: '/api/photos',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,x-client-uuid,x-date,x-order-id,x-stage' },
    })
    expect(res.statusCode).toBe(204)
    const allowed = String(res.headers['access-control-allow-headers']).toLowerCase().split(/\s*,\s*/)
    for (const h of ['authorization', 'content-type', 'x-client-uuid', 'x-order-id', 'x-stage', 'x-date']) expect(allowed).toContain(h)
  })
  it('BE-011: an origin that is not listed still gets no CORS headers at all', async () => {
    const res = await app.inject({ method: 'OPTIONS', url: '/api/photos', headers: { origin: 'https://evil.example.test', 'access-control-request-method': 'POST' } })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.headers['access-control-allow-headers']).toBeUndefined()
  })
})

describe('BE-015: the board reads the clock once', () => {
  it('BE-015: the rows and "today" come from one reading (the route reads the clock one time more than a route that returns nothing)', async () => {
    const h = await merch()
    clockCalls = 0
    await app.inject({ url: '/api/me', headers: h })
    const authOnly = clockCalls
    clockCalls = 0
    const res = await app.inject({ url: '/api/board', headers: h })
    expect(res.statusCode).toBe(200)
    expect(res.json().today).toBe('2026-11-04')
    expect(clockCalls).toBe(authOnly + 1)
  })
})

describe('BE-021: monitors that probe with HEAD see the service', () => {
  it.each(['/api/health', '/api/status'])('BE-021: HEAD %s answers 200 without a sign-in', async (url) => {
    const head = await app.inject({ method: 'HEAD', url })
    expect(head.statusCode).toBe(200)
    expect(head.body).toBe('')
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200)
  })
  it('BE-021: HEAD on a guarded route is still refused', async () => {
    expect((await app.inject({ method: 'HEAD', url: '/api/board' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'HEAD', url: '/api/me' })).statusCode).toBe(401)
  })
})

describe('BE-026: creating a template answers 201, changing one answers 200', () => {
  const stages = [{ stage: 'cutting', workingDaysBefore: 5, unitId: ID.unit1 }, { stage: 'packing', workingDaysBefore: 0, unitId: ID.unit1 }]
  it('BE-026: a new template is 201', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/templates', headers: await merch(), payload: { name: 'Fleece', stages } })
    expect(res.statusCode).toBe(201)
    expect(res.json().id).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('BE-026: changing an existing one is 200', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/templates', headers: await merch(), payload: { id: TEMPLATE_ID, name: 'Knit tee', stages } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: TEMPLATE_ID })
  })
})

describe('BE-027: a new order brings the warnings up to date', () => {
  it('BE-027: an order that is already late has its warning when it is created, before anyone opens the review', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/orders', headers: await merch(),
      payload: { buyerId: ID.buyerB, po: 'LATE-1', style: 's', colour: 'c', sizes: { M: 1000 }, exFactory: '2026-11-10', templateId: TEMPLATE_ID },
    })
    expect(res.statusCode).toBe(201)
    const n = (await pg.query<{ n: number }>(`select count(*)::int as n from warning where order_id = $1`, [res.json().orderId])).rows[0]!.n
    expect(n).toBeGreaterThan(0)
    // and nothing reached a buyer
    expect((await pg.query(`select 1 from outbox where recipient_kind = 'buyer'`)).rows).toHaveLength(0)
    expect((await pg.query(`select 1 from warning where confirmed_by is not null`)).rows).toHaveLength(0)
  })
  it('BE-027: a failing refresh never fails the order', async () => {
    const failing: Db = { tx: (ctx, fn) => (ctx.role === 'system' ? Promise.reject(new Error('refresh down')) : db.tx(ctx, fn)) }
    const a = buildApp({ db: failing, tokenSecret: 'x'.repeat(40), clock: () => NOW })
    const token = (await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token
    const res = await a.inject({
      method: 'POST', url: '/api/orders', headers: { authorization: `Bearer ${token}` },
      payload: { buyerId: ID.buyerB, po: 'OK-1', style: 's', colour: 'c', sizes: { M: 1000 }, exFactory: '2026-11-27', templateId: TEMPLATE_ID },
    })
    expect(res.statusCode).toBe(201)
  })
})

describe('BE-032: the Bearer word may be written in any case', () => {
  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR'])('BE-032: "%s <token>" signs in', async (word) => {
    const token = (await merch()).authorization.slice(7)
    const res = await app.inject({ url: '/api/me', headers: { authorization: `${word} ${token}` } })
    expect(res.statusCode).toBe(200)
  })
  it.each(['Bearer', 'Basic abc', 'Bearer ', 'Bearertoken', 'Token abc'])('BE-032: "%s" is still not a sign-in', async (value) => {
    expect((await app.inject({ url: '/api/me', headers: { authorization: value } })).statusCode).toBe(401)
  })
  it('BE-032: a buyer link works with a lower-case word too', async () => {
    const link = (await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await merch(), payload: { buyerId: ID.buyerB } })).json().token as string
    expect((await app.inject({ url: '/api/buyer/orders', headers: { authorization: `bearer ${link}` } })).statusCode).toBe(200)
  })
})
