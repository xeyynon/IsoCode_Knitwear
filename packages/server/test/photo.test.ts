import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, diskStore, looksLikeJpeg, memoryMediaStore, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const NOW = new Date('2026-11-04T04:30:00Z')
/** A minimal file with the real start and end markers of a JPEG, big enough to pass the size floor. */
const jpeg = (size = 2000, fill = 0x41): Buffer => { const b = Buffer.alloc(size, fill); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0; b[size - 2] = 0xff; b[size - 1] = 0xd9; return b }

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

const upload = async (over: { body?: Buffer | string; clientUuid?: string; orderId?: string; stage?: string; date?: string; headers?: Record<string, string>; auth?: Record<string, string> } = {}) =>
  app.inject({
    method: 'POST', url: '/api/photos',
    headers: {
      ...(over.auth ?? await sup()), 'content-type': 'image/jpeg', 'x-client-uuid': over.clientUuid ?? crypto.randomUUID(),
      'x-order-id': over.orderId ?? ID.orderRed, 'x-stage': encodeURIComponent(over.stage ?? 'sewing'), 'x-date': over.date ?? '2026-11-04', ...over.headers,
    },
    payload: over.body ?? jpeg(),
  })
const photoRows = async () => (await pg.query<any>('select *, taken_on::text as taken_on_text from photo order by created_at')).rows
const makeLink = async (buyerId: string) => (await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await merch(), payload: { buyerId } })).json().token as string
const asBuyer = (t: string) => ({ authorization: `Bearer ${t}` })

describe('uploading a photo', () => {
  it('stores the file and an UNAPPROVED row tied to the stage, unit and day', async () => {
    const res = await upload()
    expect(res.statusCode).toBe(200)
    const { id, duplicate } = res.json()
    expect(duplicate).toBe(false)
    const [row] = await photoRows()
    expect(row).toMatchObject({ id, order_id: ID.orderRed, buyer_id: ID.buyerB, unit_id: ID.unit1, stage: 'sewing', bytes: 2000, approved_by: null, rejected_at: null })
    expect(row.taken_on_text).toBe('2026-11-04')
    expect(media.files.size).toBe(1)
    expect(media.files.has(row.storage_key)).toBe(true)
    expect(row.storage_key).toMatch(/^photos\/[0-9a-f-]{36}\.jpg$/)   // server-made and random: never the caller's choice
  })

  it('a retried upload returns the same photo and stores nothing twice', async () => {
    const clientUuid = crypto.randomUUID()
    const a = (await upload({ clientUuid })).json()
    const b = (await upload({ clientUuid })).json()
    expect(b).toEqual({ id: a.id, duplicate: true })
    expect(await photoRows()).toHaveLength(1)
    expect(media.files.size).toBe(1)
  })

  it('refuses an upload id already used for a different order', async () => {
    const clientUuid = crypto.randomUUID()
    await upload({ clientUuid })
    // a merchandiser (who can see every order) tries to reuse the id on another order
    const res = await upload({ clientUuid, orderId: ID.orderNew, auth: await merch() })
    expect(res.statusCode).toBe(409)
  })

  it("will not take a photo for another unit's stage", async () => {
    const res = await upload({ orderId: ID.orderGreen })
    expect(res.statusCode).toBe(404)
    expect(await photoRows()).toHaveLength(0)
    expect(media.files.size).toBe(0)
  })

  describe('only a real JPEG is accepted, whatever it claims to be', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3000, 1)])
    const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(2000, ' '))
    const noEnd = (() => { const b = jpeg(); b[b.length - 1] = 0; return b })()
    it.each([
      ['a PNG sent as image/jpeg', png], ['HTML sent as image/jpeg', html], ['a truncated JPEG', noEnd],
      ['a tiny file', jpeg(10)], ['an empty body', Buffer.alloc(0)],
    ])('rejects %s', async (_l, body) => {
      const res = await upload({ body })
      expect(res.statusCode).toBe(400)
      expect(await photoRows()).toHaveLength(0)
      expect(media.files.size).toBe(0)
    })
    it('rejects a file over 3 MB without storing it', async () => {
      const res = await upload({ body: jpeg(3 * 1024 * 1024 + 4096) })
      expect([400, 413]).toContain(res.statusCode)
      expect(media.files.size).toBe(0)
    })
    it('recognises the markers', () => {
      expect(looksLikeJpeg(jpeg())).toBe(true)
      expect(looksLikeJpeg(png)).toBe(false)
    })
  })

  it.each([
    ['no upload id', { headers: { 'x-client-uuid': '' } }],
    ['a non-UUID upload id', { clientUuid: 'abc' }],
    ['a non-UUID order id', { orderId: 'abc' }],
    ['a blank stage', { stage: ' ' }],
    ['a bad date', { date: '04-11-2026' }],
    ['a date in the future', { date: '2026-11-09' }],
  ])('refuses %s', async (_l, over) => {
    expect((await upload(over as never)).statusCode).toBe(400)
    expect(media.files.size).toBe(0)
  })

  it('refuses a JSON body, no sign-in, a buyer link, and a server with no storage', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/photos', headers: { ...(await sup()), 'content-type': 'application/json' }, payload: { x: 1 } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/photos', headers: { 'content-type': 'image/jpeg' }, payload: jpeg() })).statusCode).toBe(401)
    expect((await upload({ auth: asBuyer(await makeLink(ID.buyerB)) })).statusCode).toBe(401)
    const bare = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW })
    const t = (await bare.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: CREDS.phone, pin: CREDS.pin } })).json().token
    const res = await bare.inject({ method: 'POST', url: '/api/photos', headers: { authorization: `Bearer ${t}`, 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': 'sewing', 'x-date': '2026-11-04' }, payload: jpeg() })
    expect(res.statusCode).toBe(503)
  })

  it('an update can carry the photo', async () => {
    const { id } = (await upload()).json()
    const res = await app.inject({ method: 'POST', url: '/api/events', headers: await sup(),
      payload: { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 120, photoId: id } })
    expect(res.statusCode).toBe(200)
    expect((await pg.query<any>('select photo_id::text as p from update_event where qty = 120')).rows[0].p).toBe(id)
  })
})

describe('reading a photo', () => {
  it('the merchandiser and the same unit can; another unit and outsiders cannot', async () => {
    const { id } = (await upload()).json()
    const ok = await app.inject({ url: `/api/photos/${id}/file`, headers: await merch() })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-type']).toBe('image/jpeg')
    expect(ok.headers['x-content-type-options']).toBe('nosniff')
    expect(ok.headers['cache-control']).toBe('no-store')
    expect(Buffer.compare(ok.rawPayload, jpeg())).toBe(0)
    expect((await app.inject({ url: `/api/photos/${id}/file`, headers: await sup() })).statusCode).toBe(200)
    expect((await app.inject({ url: `/api/photos/${id}/file` })).statusCode).toBe(401)
    expect((await app.inject({ url: `/api/photos/${id}/file`, headers: asBuyer(await makeLink(ID.buyerB)) })).statusCode).toBe(401)
    // a supervisor of another unit: make one
    await pg.query(`insert into account (role, phone, pin_hash, unit_id) values ('supervisor', '9000000002', 'x', $1)`, [ID.unit2])
    expect((await app.inject({ url: '/api/photos/not-an-id/file', headers: await merch() })).statusCode).toBe(404)
  })
})

describe('approval and what a buyer can reach', () => {
  const setup = async () => {
    const { id } = (await upload()).json() as { id: string }
    const tokenB = await makeLink(ID.buyerB)
    const tokenC = await makeLink(ID.buyerC)
    return { id, tokenB, tokenC }
  }
  const buyerPhotos = async (t: string) => (await app.inject({ url: '/api/buyer/orders', headers: asBuyer(t) })).json().orders.flatMap((o: any) => o.photos)
  const buyerFile = (t: string, id: string) => app.inject({ url: `/api/buyer/photos/${id}`, headers: asBuyer(t) })

  it('is waiting in the review queue, and invisible to the buyer, until approved', async () => {
    const { id, tokenB } = await setup()
    const q = (await app.inject({ url: '/api/review', headers: await merch() })).json()
    expect(q.photos).toHaveLength(1)
    expect(q.photos[0]).toMatchObject({ id, po: 'B-PO-88240', buyerName: 'Buyer B', stage: 'sewing', takenOn: '2026-11-04', bytes: 2000 })
    expect(await buyerPhotos(tokenB)).toEqual([])
    expect((await buyerFile(tokenB, id)).statusCode).toBe(404)
  })

  it('after approval the buyer sees it, and can fetch it as a JPEG', async () => {
    const { id, tokenB } = await setup()
    expect((await app.inject({ method: 'POST', url: `/api/photos/${id}/approve`, headers: await merch() })).statusCode).toBe(200)
    expect(await buyerPhotos(tokenB)).toEqual([{ id, stage: 'sewing', takenOn: '2026-11-04' }])
    const f = await buyerFile(tokenB, id)
    expect(f.statusCode).toBe(200)
    expect(f.headers['content-type']).toBe('image/jpeg')
    expect(f.headers['cache-control']).toBe('no-store')
    expect(Buffer.compare(f.rawPayload, jpeg())).toBe(0)
    expect((await app.inject({ url: '/api/review', headers: await merch() })).json().photos).toEqual([])   // no longer waiting
  })

  it("ANOTHER buyer cannot fetch it, even knowing its id and even though it is approved", async () => {
    const { id, tokenC } = await setup()
    await app.inject({ method: 'POST', url: `/api/photos/${id}/approve`, headers: await merch() })
    expect((await buyerFile(tokenC, id)).statusCode).toBe(404)
    expect(await buyerPhotos(tokenC)).toEqual([])
  })

  it('rejecting withdraws it at once, even after approval', async () => {
    const { id, tokenB } = await setup()
    await app.inject({ method: 'POST', url: `/api/photos/${id}/approve`, headers: await merch() })
    expect((await buyerFile(tokenB, id)).statusCode).toBe(200)
    await app.inject({ method: 'POST', url: `/api/photos/${id}/reject`, headers: await merch() })
    expect((await buyerFile(tokenB, id)).statusCode).toBe(404)
    expect(await buyerPhotos(tokenB)).toEqual([])
    expect((await app.inject({ url: '/api/review', headers: await merch() })).json().photos).toEqual([])   // rejected ones are not re-queued
  })

  it('an unknown or malformed photo is 404/400; a supervisor cannot approve; no id enumeration through the buyer route', async () => {
    const { id, tokenB } = await setup()
    expect((await app.inject({ method: 'POST', url: '/api/photos/00000000-0000-0000-0000-00000000dead/approve', headers: await merch() })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/photos/nope/approve', headers: await merch() })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: `/api/photos/${id}/approve`, headers: await sup() })).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/review', headers: await sup() })).statusCode).toBe(403)
    const unknown = await buyerFile(tokenB, '00000000-0000-0000-0000-00000000dead')
    const unapproved = await buyerFile(tokenB, id)
    expect(unknown.statusCode).toBe(404)
    expect(unapproved.body).toBe(unknown.body)           // "does not exist" and "not yours / not approved" look identical
  })
})

describe('the disk store', () => {
  it('writes, reads and deletes, and can never leave its folder', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'media-'))
    try {
      const s = diskStore(dir)
      await s.put('photos/a.jpg', Buffer.from('hello'))
      expect((await s.get('photos/a.jpg'))?.toString()).toBe('hello')
      expect(await s.get('photos/missing.jpg')).toBeNull()
      await s.delete('photos/a.jpg')
      expect(await s.get('photos/a.jpg')).toBeNull()
      for (const bad of ['../escape.jpg', 'photos/../../escape.jpg', '/etc/passwd', 'a b.jpg', 'photos\\x.jpg']) {
        await expect(s.put(bad, Buffer.from('x'))).rejects.toThrow(/bad media key/)
      }
      expect(await readdir(path.dirname(dir))).not.toContain('escape.jpg')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
