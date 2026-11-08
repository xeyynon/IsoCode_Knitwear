// Final bug cycle: BE-079 and BE-080.
//   BE-079  GET /api/me had no Cache-Control, so a host (Vercel) added "public, max-age=0, must-revalidate". Every authenticated or private
//           reply now says no-store: one hook, so a route added later cannot forget it. The health and status probes are left as they are.
//   BE-080  A bad URL component or an over-long id got Fastify's own error body, which echoes the path and has another shape from every
//           other error. They now answer with the app's one error shape and say nothing about the address.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, memoryMediaStore, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const NOW = new Date('2026-11-04T04:30:00Z')
let pg: PGlite, db: Db, app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW, media: memoryMediaStore() }) })
afterAll(async () => { await pg.close() })

const merch = async () => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token as string}` })
const sup = async () => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: CREDS.phone, pin: CREDS.pin } })).json().token as string}` })

describe('BE-079: private replies are not cached', () => {
  it('BE-079: /api/me says no-store, for a merchandiser and for a supervisor', async () => {
    for (const h of [await merch(), await sup()]) {
      const res = await app.inject({ url: '/api/me', headers: h })
      expect(res.statusCode).toBe(200)
      expect(res.headers['cache-control']).toBe('no-store')
    }
  })

  it('BE-079: a sign-in reply (it carries the token), a refusal and an unknown route all say no-store too', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })
    expect(login.headers['cache-control']).toBe('no-store')
    const noToken = await app.inject({ url: '/api/me' })
    expect(noToken.statusCode).toBe(401)
    expect(noToken.headers['cache-control']).toBe('no-store')
    const missing = await app.inject({ url: '/api/nothing-here', headers: await merch() })
    expect(missing.statusCode).toBe(404)
    expect(missing.headers['cache-control']).toBe('no-store')
  })

  it('BE-079: the probes are left as they were (no forced header), and a route that sets its own keeps it', async () => {
    for (const url of ['/api/health', '/api/status']) {
      const res = await app.inject({ url })
      expect(res.statusCode).toBe(200)
      expect(res.headers['cache-control']).toBeUndefined()
    }
    const board = await app.inject({ url: '/api/board', headers: await merch() })
    expect(board.headers['cache-control']).toBe('no-store')
    expect(board.headers.etag).toBeTruthy()   // the validators still work beside it
    const again = await app.inject({ url: '/api/board', headers: { ...(await merch()), 'if-none-match': board.headers.etag as string } })
    expect(again.statusCode).toBe(304)
  })
})

describe('BE-080: a bad address answers in the app\'s error shape and does not echo it', () => {
  const shape = (body: unknown) => body as { error?: { code?: string; message?: string } }

  it('BE-080: a broken percent-escape in an id is a 400 in the standard shape, with no part of the address in the answer', async () => {
    const res = await app.inject({ url: '/api/orders/%E0%A4%A', headers: await merch() })
    expect(res.statusCode).toBe(400)
    expect(shape(res.json())).toEqual({ error: { code: 'bad_request', message: 'Invalid request' } })
    expect(res.body).not.toContain('%E0')
    expect(res.body).not.toContain('/api/orders')
  })

  it('BE-080: an over-long id is a 400 in the same shape (it was a 414 with Fastify\'s own code)', async () => {
    const res = await app.inject({ url: `/api/orders/${'a'.repeat(300)}`, headers: await merch() })
    expect(res.statusCode).toBe(400)
    expect(shape(res.json())).toEqual({ error: { code: 'bad_request', message: 'Invalid request' } })
    expect(res.body).not.toContain('aaaaaaaa')
  })

  it('BE-080: the same on a public route and for a signed-out caller, and ordinary errors are unchanged', async () => {
    const res = await app.inject({ url: '/api/photos/%E0%A4%A' })
    expect([400, 401]).toContain(res.statusCode)
    expect(shape(res.json()).error?.code).toBeTruthy()
    expect(res.body).not.toContain('FST_ERR')
    const unknown = await app.inject({ url: `/api/orders/${ID.orderRed.replace(/.$/, '9')}`, headers: await merch() })
    expect(unknown.statusCode).toBe(404)
    expect(shape(unknown.json()).error?.code).toBe('not_found')
  })
})
