// BE-074: a supervisor's phone number must be an Indian mobile number (starts with 6 to 9) when the account is made.
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

const merch = async () => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token}` })
const add = async (phone: string) => app.inject({ method: 'POST', url: '/api/accounts/supervisors', headers: await merch(), payload: { phone, pin: '7391', unitId: ID.unit1, label: 'Test' } })

describe('BE-074: Indian mobile numbers only, when an account is made', () => {
  it.each(['0123456789', '1234567890', '2345678901', '3456789012', '4567890123', '5678901234'])('BE-074: %s is refused with a plain message', async (phone) => {
    const r = await add(phone)
    expect(r.statusCode).toBe(400)
    expect(r.json().error.message).toMatch(/Indian mobile number/)
  })
  it.each(['6123456789', '7123456789', '8123456789', '9123456789', '+91 98100 22334', '98100 22334'])('BE-074: %s is accepted', async (phone) => {
    const r = await add(phone)
    expect(r.statusCode, r.body).toBe(201)
  })
  it('BE-074: a number that is not ten digits still gets the ten-digit message', async () => {
    const r = await add('12345')
    expect(r.statusCode).toBe(400)
    expect(r.json().error.message).toBe('Enter a 10-digit phone number')
  })
  it('BE-074: sign-in still takes any ten digits, so an existing account with another kind of number is not locked out', async () => {
    await pg.query(`update account set phone = '1234509876' where phone is not null`)
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: '12345 09876', pin: CREDS.pin } })
    expect(r.statusCode, r.body).toBe(200)
  })
})
