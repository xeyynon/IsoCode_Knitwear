import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, memoryMediaStore, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// Fixes BE-010 (an id sent as a list) and BE-023 (the wording for a mistyped stage).
const NOW = new Date('2026-11-04T04:30:00Z')
const jpeg = (size = 2000): Buffer => { const b = Buffer.alloc(size, 0x41); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[size - 2] = 0xff; b[size - 1] = 0xd9; return b }

let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW, media: memoryMediaStore() }) })
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const good = (over: object = {}) => ({ clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 7, ...over })
const events = async () => (await pg.query<{ qty: number }>(`select qty from update_event where date = '2026-11-04'`)).rows

describe('BE-010: an id sent as a list is a 400, and does not sink a batch', () => {
  const uuid = crypto.randomUUID()
  it.each([
    ['a clientUuid in a list', { clientUuid: [uuid] }],
    ['an orderId in a list', { orderId: [ID.orderRed] }],
    ['a clientUuid that is an object', { clientUuid: { a: 1 } }],
    ['a photoId in a list', { photoId: [uuid] }],
    ['a stage in a list', { stage: ['sewing'] }],
    ['a date in a list', { date: ['2026-11-04'] }],
  ])('BE-010: %s is a plain 400 on a single update', async (_l, over) => {
    const res = await app.inject({ method: 'POST', url: '/api/events', headers: await sup(), payload: good(over) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
    expect(await events()).toHaveLength(0)
  })

  it('BE-010: in a batch the bad item is rejected alone and the good one is kept', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/events/batch', headers: await sup(), payload: { events: [good({ clientUuid: [uuid] }), good({ qty: 11 })] } })
    expect(res.statusCode).toBe(200)
    expect(res.json().results.map((r: any) => r.result)).toEqual(['rejected', 'accepted'])
    expect((await events()).map((e) => e.qty)).toEqual([11])
  })

  it('BE-010: a merchandiser sending for someone else gets the same answer', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/events', headers: await merch(), payload: good({ clientUuid: [uuid] }) })
    expect(res.statusCode).toBe(400)
  })

  it('BE-010: a retry of a good update is still a duplicate, once', async () => {
    const item = good()
    const send = async () => (await app.inject({ method: 'POST', url: '/api/events', headers: await sup(), payload: item })).json()
    expect((await send()).duplicate).toBe(false)
    expect((await send()).duplicate).toBe(true)
    expect(await events()).toHaveLength(1)
  })
})

describe('BE-023: the words for a stage that is not there', () => {
  it('BE-023: a merchandiser who mistypes a stage is not told it is "for your unit"', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/events', headers: await merch(), payload: good({ stage: 'sewng' }) })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.message).toBe('No such stage on this order')
  })
  it('BE-023: the same for a photo', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/photos',
      headers: { ...(await merch()), 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': 'sewng', 'x-date': '2026-11-04' },
      payload: jpeg(),
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.message).toBe('No such stage on this order')
  })
  it('BE-023: a supervisor still hears "for your unit", because the stage may exist in another unit', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/events', headers: await sup(), payload: good({ orderId: ID.orderGreen }) })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.message).toBe('No such stage for your unit')
  })
})
