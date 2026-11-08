// OPT-LANE C: BE-047, an update or a photo dated more than a year back is refused.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { addDays } from '@isocode/engine/dates'
import { buildApp, memoryMediaStore, type Db } from '../src/index.js'
import { MAX_DAYS_IN_PAST, earliestAllowedDate } from '../src/eventService.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const NOW = new Date('2026-11-04T04:30:00Z')   // the fixed demo clock: 4 Nov 2026, India
const TODAY = '2026-11-04'
const OK_EDGE = addDays(TODAY, -366)           // 2025-11-03: exactly 366 days back
const TOO_OLD = addDays(TODAY, -367)           // 2025-11-02
const jpeg = (size = 2000): Buffer => { const b = Buffer.alloc(size, 0x41); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; b[size - 2] = 0xff; b[size - 1] = 0xd9; return b }

let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW, media: memoryMediaStore() }) })
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const event = async (date: string, h?: Record<string, string>) => app.inject({
  method: 'POST', url: '/api/events', headers: h ?? await sup(),
  payload: { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date, qty: 10 },
})
const photo = async (date: string) => app.inject({
  method: 'POST', url: '/api/photos',
  headers: { ...(await sup()), 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': 'sewing', 'x-date': date },
  payload: jpeg(),
})

describe('BE-047: how far back a date may be', () => {
  it('BE-047: the limit is 366 days and the edge dates are what the test thinks they are', () => {
    expect(MAX_DAYS_IN_PAST).toBe(366)
    expect(earliestAllowedDate(TODAY)).toBe(OK_EDGE)
    expect(OK_EDGE).toBe('2025-11-03')
    expect(TOO_OLD).toBe('2025-11-02')
  })
  it('BE-047: an update dated exactly 366 days back is accepted, 367 days back is refused with a plain 400', async () => {
    expect((await event(OK_EDGE)).statusCode).toBe(200)
    const res = await event(TOO_OLD)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: 'bad_request', message: 'date is more than 366 days in the past' })
    expect((await pg.query('select 1 from update_event where date = $1', [TOO_OLD])).rows).toHaveLength(0)
  })
  it('BE-047: year 0001 style dates, last year, yesterday and today: only the ones inside the year are stored', async () => {
    expect((await event('2002-11-04')).statusCode).toBe(400)   // 2002 typed for 2026
    expect((await event('2026-11-03')).statusCode).toBe(200)
    expect((await event(TODAY)).statusCode).toBe(200)
    expect((await event('2026-11-05')).statusCode).toBe(400)   // the future is still refused, with its own words
    expect((await event('2026-11-05')).json().error.message).toBe('date is in the future')
  })
  it('BE-047: a staff update on behalf follows the same rule', async () => {
    expect((await event(TOO_OLD, await merch())).statusCode).toBe(400)
    expect((await event(OK_EDGE, await merch())).statusCode).toBe(200)
  })
  it('BE-047: in a batch the too-old item is rejected on its own and the rest are kept', async () => {
    const ok = crypto.randomUUID(), old = crypto.randomUUID()
    const res = await app.inject({ method: 'POST', url: '/api/events/batch', headers: await sup(), payload: { events: [
      { clientUuid: ok, orderId: ID.orderRed, stage: 'sewing', date: OK_EDGE, qty: 5 },
      { clientUuid: old, orderId: ID.orderRed, stage: 'sewing', date: TOO_OLD, qty: 5 },
    ] } })
    expect(res.statusCode).toBe(200)
    expect(res.json().results).toEqual([
      { clientUuid: ok, result: 'accepted' },
      { clientUuid: old, result: 'rejected', code: 'bad_request', message: 'date is more than 366 days in the past' },
    ])
  })
  it('BE-047: a photo follows the same rule, and a refused one stores no file', async () => {
    expect((await photo(OK_EDGE)).statusCode).toBe(200)
    const res = await photo(TOO_OLD)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe('date is more than 366 days in the past')
    expect((await pg.query('select 1 from photo')).rows).toHaveLength(1)
  })
  it('BE-047: the limit moves with the factory day (a day later, the old edge date is refused)', async () => {
    const later = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => new Date('2026-11-05T04:30:00Z') })
    const h = { authorization: `Bearer ${(await later.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: CREDS.phone, pin: CREDS.pin } })).json().token}` }
    const post = (date: string) => later.inject({ method: 'POST', url: '/api/events', headers: h, payload: { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date, qty: 1 } })
    expect((await post(OK_EDGE)).statusCode).toBe(400)
    expect((await post(addDays('2026-11-05', -366))).statusCode).toBe(200)
  })
})
