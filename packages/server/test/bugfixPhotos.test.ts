import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, memoryMediaStore, savePhoto, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// Fixes BE-009 (purge days), BE-010 (photo ids), BE-012 (approve / reject twice), BE-014 (too large), BE-031 (503 before the role check).
const NOW = new Date('2026-11-04T04:30:00Z')
const jpeg = (size = 2000): Buffer => { const b = Buffer.alloc(size, 0x41); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[size - 2] = 0xff; b[size - 1] = 0xd9; return b }

let pg: PGlite
let db: Db
let app: FastifyInstance
let media: ReturnType<typeof memoryMediaStore>
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => {
  await resetAndSeed(pg)
  media = memoryMediaStore()
  app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW, media })
})
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const upload = async (body: Buffer = jpeg(), app2: FastifyInstance = app) => app2.inject({
  method: 'POST', url: '/api/photos',
  headers: { ...(await sup()), 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': 'sewing', 'x-date': '2026-11-04' },
  payload: body,
})
const rejectedPhoto = async () => {
  const id = (await upload()).json().id as string
  await app.inject({ method: 'POST', url: `/api/photos/${id}/reject`, headers: await merch() })
  await pg.query(`update photo set rejected_at = now() - interval '2 days' where id = $1`, [id])
  return id
}
const purge = async (payload: unknown) => app.inject({ method: 'POST', url: '/api/photos/purge', headers: { ...(await merch()), 'content-type': 'application/json' }, payload: JSON.stringify(payload) })
const photo = async (id: string) => (await pg.query<any>(`select approved_by, approved_at::text as approved_at, rejected_at::text as rejected_at, purged_at from photo where id = $1`, [id])).rows[0]

describe('BE-009: the purge never reads a blank as zero days', () => {
  it.each([['an empty string', ''], ['an empty list', []], ['false', false], ['a hex string', '0x10'], ['an exponent string', '1e1'], ['true', true], ['an object', {}], ['a spaced string', ' ']])(
    'BE-009: days as %s is refused and the file stays', async (_label, days) => {
      await rejectedPhoto()
      const res = await purge({ days })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.message).toBe('days must be a whole number from 0 to 3650')
      expect(media.files.size).toBe(1)
      expect((await pg.query('select 1 from photo where purged_at is not null')).rows).toHaveLength(0)
    })

  it('BE-009: a number, a digit string, nothing and null still work as before', async () => {
    await rejectedPhoto()
    expect((await purge({ days: 3 })).json()).toEqual({ purged: 0 })      // rejected 2 days ago
    expect((await purge({ days: '3' })).json()).toEqual({ purged: 0 })
    expect((await purge({})).json()).toEqual({ purged: 0 })               // default 7 days
    expect((await purge({ days: null })).json()).toEqual({ purged: 0 })
    expect((await purge({ days: 1 })).json()).toEqual({ purged: 1 })
    expect(media.files.size).toBe(0)
  })
})

describe('BE-010: an id sent as a list is a 400, not a crash', () => {
  it('BE-010: savePhoto answers a clear refusal for a clientUuid or orderId that is not text', async () => {
    const ctx = { role: 'supervisor' as const, unitId: ID.unit1 }
    for (const over of [{ clientUuid: [crypto.randomUUID()] }, { orderId: [ID.orderRed] }, { clientUuid: { toString: () => crypto.randomUUID() } }]) {
      const run = () => (savePhoto(db, ctx, media, { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', bytes: jpeg(), ...over } as never, '2026-11-04'))
      await expect(run()).rejects.toMatchObject({ status: 400, code: 'bad_request' })
    }
    expect(media.files.size).toBe(0)
  })
})

describe('BE-012: approving or rejecting twice changes nothing', () => {
  it('BE-012: approving an approved photo keeps the first approver and time, and tells nobody again', async () => {
    const id = (await upload()).json().id as string
    expect((await app.inject({ method: 'POST', url: `/api/photos/${id}/approve`, headers: await merch() })).statusCode).toBe(200)
    const other = '00000000-0000-0000-0000-0000000000e2'
    await pg.query(`insert into account (id, role, email, password_hash) select $1, 'merchandiser', 'm2@example.test', password_hash from account where id = $2`, [other, ID.merch])
    await pg.query(`update photo set approved_at = '2026-01-01T00:00:00Z' where id = $1`, [id])
    const h2 = { authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'm2@example.test', password: CREDS.password } })).json().token}` }
    const again = await app.inject({ method: 'POST', url: `/api/photos/${id}/approve`, headers: h2 })
    expect(again.statusCode).toBe(200)
    const row = await photo(id)
    expect(row.approved_by).toBe(ID.merch)
    expect(row.approved_at).toMatch(/^2026-01-01/)
    expect((await pg.query(`select 1 from outbox where recipient_kind = 'buyer'`)).rows).toHaveLength(1)
  })

  it('BE-012: rejecting a rejected photo keeps the first time, so the purge date does not move', async () => {
    const id = (await upload()).json().id as string
    await app.inject({ method: 'POST', url: `/api/photos/${id}/reject`, headers: await merch() })
    await pg.query(`update photo set rejected_at = '2026-01-01T00:00:00Z' where id = $1`, [id])
    const again = await app.inject({ method: 'POST', url: `/api/photos/${id}/reject`, headers: await merch() })
    expect(again.statusCode).toBe(200)
    expect((await photo(id)).rejected_at).toMatch(/^2026-01-01/)
  })

  it('BE-012: two approvals in flight together send one email', async () => {
    const id = (await upload()).json().id as string
    const h = await merch()
    const both = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: `/api/photos/${id}/approve`, headers: h })))
    expect(both.map((r) => r.statusCode)).toEqual([200, 200])
    expect((await pg.query(`select 1 from outbox where recipient_kind = 'buyer'`)).rows).toHaveLength(1)
  })

  it('BE-012: approving a rejected photo still brings it back, and a purged or unknown one is still not found', async () => {
    const id = (await upload()).json().id as string
    await app.inject({ method: 'POST', url: `/api/photos/${id}/reject`, headers: await merch() })
    expect((await app.inject({ method: 'POST', url: `/api/photos/${id}/approve`, headers: await merch() })).statusCode).toBe(200)
    const row = await photo(id)
    expect(row.rejected_at).toBeNull()
    expect(row.approved_by).toBe(ID.merch)
    await pg.query(`update photo set purged_at = now(), approved_by = null, approved_at = null, rejected_at = now() where id = $1`, [id])
    expect((await app.inject({ method: 'POST', url: `/api/photos/${id}/approve`, headers: await merch() })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/api/photos/00000000-0000-0000-0000-00000000dead/reject`, headers: await merch() })).statusCode).toBe(404)
  })
})

describe('BE-014: a photo that is too large has one stable answer', () => {
  it('BE-014: 4 MB answers 413 photo_too_large, which the phone reads as permanent', async () => {
    const res = await upload(jpeg(4 * 1024 * 1024))
    expect(res.statusCode).toBe(413)
    expect(res.json().error).toEqual({ code: 'photo_too_large', message: 'That photo is too large' })
    expect(media.files.size).toBe(0)
  })
  it('BE-014: a photo just over 3 MB, inside the transport margin, answers the same', async () => {
    const res = await upload(jpeg(3 * 1024 * 1024 + 500))
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('photo_too_large')
  })
  it('BE-014: any other oversized body is a 413 too_large and the message holds no internals', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/events', headers: { ...(await sup()), 'content-type': 'application/json' }, payload: JSON.stringify({ pad: 'x'.repeat(1_300_000) }) })
    expect(res.statusCode).toBe(413)
    expect(res.json().error).toEqual({ code: 'too_large', message: 'That request is too large' })
  })
  it('BE-014: a 3 MB photo is still accepted', async () => {
    expect((await upload(jpeg(3 * 1024 * 1024))).statusCode).toBe(200)
  })
})

describe('BE-031: the role is checked before the server says what it is set up for', () => {
  it('BE-031: a supervisor on a server with no photo storage gets 403 from the purge, not 503', async () => {
    const bare = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW })
    const res = await bare.inject({ method: 'POST', url: '/api/photos/purge', headers: await sup(), payload: { days: 7 } })
    expect(res.statusCode).toBe(403)
    // a merchandiser is still told, plainly
    const staff = await bare.inject({ method: 'POST', url: '/api/photos/purge', headers: await merch(), payload: { days: 7 } })
    expect(staff.statusCode).toBe(503)
  })
})
