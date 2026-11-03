import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, cleanNote, detectLanguage, memoryMediaStore, parseNote, type Db, type Reason } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const NOW = new Date('2026-11-04T04:30:00Z')
const TAMIL = 'இன்று மூன்று இயந்திரங்கள் வேலை செய்யவில்லை'   // "three machines were not working today"
const jpeg = (): Buffer => { const b = Buffer.alloc(2000, 0x41); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[1998] = 0xff; b[1999] = 0xd9; return b }

let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg); app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW, media: memoryMediaStore() }) })
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const send = async (over: object = {}, h?: Record<string, string>) => app.inject({
  method: 'POST', url: '/api/events', headers: h ?? await sup(),
  payload: { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 100, ...over },
})
const notes = async () => (await pg.query<any>('select * from note order by created_at')).rows
const count = async (t: string) => (await pg.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0]!.n

describe('sending an update with a note', () => {
  it('stores a Tamil note and a reason, tied to the stage, unit and day, and links it to the update', async () => {
    const res = await send({ note: { text: TAMIL, category: 'machine' } })
    expect(res.statusCode).toBe(200)
    const [n] = await notes()
    expect(n).toMatchObject({
      order_id: ID.orderRed, buyer_id: ID.buyerB, unit_id: ID.unit1, stage: 'sewing', language: 'ta',
      text_ta: TAMIL, text_en: null, category: 'machine', category_by: 'supervisor', confirmed_by: null,
    })
    const ev = (await pg.query<any>('select note_id::text as note_id from update_event where qty = 100')).rows[0]
    expect(ev.note_id).toBe(n.id)
  })

  it('keeps English text in the English column, and nothing in the other', async () => {
    await send({ note: { text: 'Two operators absent', category: 'absence' } })
    expect((await notes())[0]).toMatchObject({ language: 'en', text_en: 'Two operators absent', text_ta: null })
  })

  it('accepts a reason alone, or words alone', async () => {
    await send({ note: { category: 'power' } })
    await send({ note: { text: 'Power came back at noon' } })
    const rows = await notes()
    expect(rows[0]).toMatchObject({ category: 'power', text_ta: null, text_en: null, language: null })
    expect(rows[1]).toMatchObject({ category: null, category_by: null, text_en: 'Power came back at noon' })
  })

  it('an empty note creates no note at all', async () => {
    for (const note of [{}, { text: '   ', category: '' }, { text: null, category: null }]) expect((await send({ note })).statusCode).toBe(200)
    expect(await count('note')).toBe(0)
  })

  it('cleans pasted text: control characters out, spaces tidied', async () => {
    await send({ note: { text: '  Line\u0000 one \u0007   two\t\t three  ' } })
    expect((await notes())[0].text_en).toBe('Line one two three')
  })

  describe('refuses a bad note and writes NOTHING (no update, no note)', () => {
    it.each([
      ['a reason that is not on the list', { category: 'made-up' }],
      ['a reason that is not text', { category: 5 }],
      ['text that is not a string', { text: 42 }],
      ['text over 500 characters', { text: 'x'.repeat(501) }],
      ['a note that is not an object', 'hello'],
    ])('%s', async (_l, note) => {
      expect((await send({ note })).statusCode).toBe(400)
      expect(await count('note')).toBe(0)
      expect(await count('update_event')).toBe(10)      // only the ten seeded days: the bad update was not saved
    })
    it('exactly 500 characters is fine', async () => {
      expect((await send({ note: { text: 'x'.repeat(500) } })).statusCode).toBe(200)
    })
  })

  it('an English note is never overwritten by a reviewer: the original stays as written', async () => {
    await send({ note: { text: 'Two operators absent' } })
    await (await app.inject({ method: 'POST', url: `/api/notes/${(await notes())[0].id}/confirm`, headers: await merch(), payload: { textEn: 'REWRITTEN' } }))
    expect((await notes())[0].text_en).toBe('Two operators absent')
  })

  it('a repeated send does not keep a second copy of the note', async () => {
    const payload = { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 100, note: { text: TAMIL, category: 'machine' } }
    const h = await sup()
    await app.inject({ method: 'POST', url: '/api/events', headers: h, payload })
    const again = await app.inject({ method: 'POST', url: '/api/events', headers: h, payload })
    expect(again.json().duplicate).toBe(true)
    expect(await count('note')).toBe(1)
  })

  it('a caller cannot point an update at an existing note', async () => {
    await send({ note: { text: 'secret of another update' } })
    const existing = (await notes())[0].id
    await send({ noteId: existing, qty: 7 })
    expect((await pg.query<any>('select note_id from update_event where qty = 7')).rows[0].note_id).toBeNull()
  })

  it('in a batch, one bad note is refused and the rest are accepted', async () => {
    const mk = (note: object) => ({ clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 10, note })
    const res = await app.inject({ method: 'POST', url: '/api/events/batch', headers: await sup(), payload: { events: [mk({ category: 'power' }), mk({ category: 'nope' }), mk({ text: 'ok' })] } })
    expect(res.json().results.map((r: any) => r.result)).toEqual(['accepted', 'rejected', 'accepted'])
    expect(await count('note')).toBe(2)
  })
})

describe('a photo on an update must be a real one for this order', () => {
  const upload = async (orderId: string, h: Record<string, string>) => (await app.inject({
    method: 'POST', url: '/api/photos', headers: { ...h, 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': orderId, 'x-stage': 'sewing', 'x-date': '2026-11-04' }, payload: jpeg(),
  })).json().id as string

  it('accepts the supervisor\'s own photo for the same order', async () => {
    const id = await upload(ID.orderRed, await sup())
    expect((await send({ photoId: id })).statusCode).toBe(200)
  })
  it("refuses another order's photo, an unknown id and a malformed one", async () => {
    const other = await upload(ID.orderNew, await sup())                       // same unit, different order
    expect((await send({ photoId: other })).statusCode).toBe(400)
    expect((await send({ photoId: '00000000-0000-0000-0000-00000000dead' })).statusCode).toBe(400)
    expect((await send({ photoId: 'nope' })).statusCode).toBe(400)
  })
  it("refuses a photo the supervisor cannot see (another unit's)", async () => {
    const c = await upload(ID.orderGreen, await merch())                       // a merchandiser uploads for unit 2's order
    expect((await send({ photoId: c })).statusCode).toBe(400)
  })
})

describe('the list of reasons', () => {
  it('is readable by supervisors and merchandisers, in a fixed order, with English and Tamil', async () => {
    for (const h of [await sup(), await merch()]) {
      const r = (await app.inject({ url: '/api/reasons', headers: h })).json().reasons as Reason[]
      expect(r.map((x) => x.id)).toEqual(['labour', 'absence', 'machine', 'material', 'power', 'quality', 'other'])
      expect(r.every((x) => x.en && x.ta)).toBe(true)
    }
  })
  it('is not open to outsiders or to a buyer link', async () => {
    expect((await app.inject({ url: '/api/reasons' })).statusCode).toBe(401)
    const link = (await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await merch(), payload: { buyerId: ID.buyerB } })).json().token
    expect((await app.inject({ url: '/api/reasons', headers: { authorization: `Bearer ${link}` } })).statusCode).toBe(401)
  })
})

describe('reviewing a note', () => {
  const review = async () => (await app.inject({ url: '/api/review', headers: await merch() })).json()
  const confirm = async (id: string, body: object = {}, h?: Record<string, string>) => app.inject({ method: 'POST', url: `/api/notes/${id}/confirm`, headers: h ?? await merch(), payload: body })

  it('lists it with the original, the language and the supervisor\'s reason', async () => {
    await send({ note: { text: TAMIL, category: 'machine' } })
    const r = await review()
    expect(r.notes).toHaveLength(1)
    expect(r.notes[0]).toMatchObject({ po: 'B-PO-88240', buyerName: 'Buyer B', stage: 'sewing', takenOn: '2026-11-04', language: 'ta', original: TAMIL, textEn: null, category: 'machine', categoryBy: 'supervisor' })
    expect(r.reasons.map((x: Reason) => x.id)).toContain('machine')
  })
  it('confirming adds the English meaning and records who reviewed it', async () => {
    await send({ note: { text: TAMIL, category: 'machine' } })
    const id = (await review()).notes[0].id
    expect((await confirm(id, { textEn: '  Three machines were not working today  ' })).statusCode).toBe(200)
    const n = (await notes())[0]
    expect(n).toMatchObject({ text_en: 'Three machines were not working today', text_ta: TAMIL, category: 'machine', category_by: 'supervisor', confirmed_by: ID.merch })
    expect((await review()).notes).toEqual([])
  })
  it('changing the reason is recorded as the merchandiser\'s; keeping it stays the supervisor\'s', async () => {
    await send({ note: { text: TAMIL, category: 'machine' } })
    await send({ note: { text: 'late fabric', category: 'material' } })
    const [a, b] = (await review()).notes
    await confirm(a.id, { category: 'power' })
    await confirm(b.id, { category: 'material' })
    const rows = await notes()
    expect(rows[0]).toMatchObject({ category: 'power', category_by: 'merchandiser' })
    expect(rows[1]).toMatchObject({ category: 'material', category_by: 'supervisor' })
  })
  it('a merchandiser can set the reason on a note that had none', async () => {
    await send({ note: { text: 'slow day' } })
    await confirm((await review()).notes[0].id, { category: 'labour' })
    expect((await notes())[0]).toMatchObject({ category: 'labour', category_by: 'merchandiser' })
  })
  it('reviewing twice, an unknown note, a bad reason and over-long text are refused', async () => {
    await send({ note: { text: 'x' } })
    const id = (await review()).notes[0].id
    expect((await confirm(id, { category: 'made-up' })).statusCode).toBe(400)
    expect((await confirm(id, { textEn: 'y'.repeat(501) })).statusCode).toBe(400)
    expect((await confirm(id)).statusCode).toBe(200)
    expect((await confirm(id)).statusCode).toBe(409)
    expect((await confirm('00000000-0000-0000-0000-00000000dead')).statusCode).toBe(404)
    expect((await confirm('nope')).statusCode).toBe(400)
  })
  it('a supervisor cannot review notes or open the queue', async () => {
    await send({ note: { text: 'x' } })
    const id = (await review()).notes[0].id
    expect((await confirm(id, {}, await sup())).statusCode).toBe(403)
    expect((await app.inject({ url: '/api/review', headers: await sup() })).statusCode).toBe(403)
  })
  it('shows on the order\'s page, newest first, with whether it was reviewed', async () => {
    await send({ note: { text: 'first', category: 'power' } })
    await new Promise((r) => setTimeout(r, 25))
    await send({ note: { text: TAMIL, category: 'machine' } })
    await confirm((await review()).notes[0].id, { textEn: 'first, reviewed' })
    const d = (await app.inject({ url: `/api/orders/${ID.orderRed}`, headers: await merch() })).json()
    expect(d.notes.map((n: any) => [n.original, n.reviewed])).toEqual([[TAMIL, false], ['first', true]])
  })
})

describe('notes are internal: a buyer can never reach one', () => {
  it('the buyer view carries no note, and the database refuses a buyer who asks', async () => {
    await send({ note: { text: 'SECRET-NOTE-TEXT', category: 'machine' } })
    await confirmAll()
    const token = (await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await merch(), payload: { buyerId: ID.buyerB } })).json().token
    const res = await app.inject({ url: '/api/buyer/orders', headers: { authorization: `Bearer ${token}` } })
    expect(res.body).not.toMatch(/SECRET-NOTE-TEXT|machine|note/i)
    const seen = await db.tx({ role: 'buyer', buyerId: ID.buyerB }, (tx) => tx.query('select 1 from note'))
    expect(seen).toHaveLength(0)
    for (const url of ['/api/review', `/api/orders/${ID.orderRed}`, '/api/notes/x/confirm']) {
      expect((await app.inject({ url, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)
    }
  })
  async function confirmAll() {
    const r = (await app.inject({ url: '/api/review', headers: await merch() })).json()
    for (const n of r.notes) await app.inject({ method: 'POST', url: `/api/notes/${n.id}/confirm`, headers: await merch(), payload: {} })
  }
  it("a supervisor reads only their own unit's notes at the database level", async () => {
    await send({ note: { text: 'unit one note' } })
    const own = await db.tx({ role: 'supervisor', unitId: ID.unit1 }, (tx) => tx.query('select 1 from note'))
    const other = await db.tx({ role: 'supervisor', unitId: ID.unit2 }, (tx) => tx.query('select 1 from note'))
    expect(own).toHaveLength(1)
    expect(other).toHaveLength(0)
  })
})

describe('the small rules', () => {
  const reasons: Reason[] = [{ id: 'power', en: 'No power' }]
  it('labels the language without translating anything', () => {
    expect(detectLanguage(TAMIL)).toBe('ta')
    expect(detectLanguage('Two operators absent')).toBe('en')
    expect(detectLanguage('PO 88240 இல் தாமதம்')).toBe('ta')     // any Tamil letters: Tamil
    expect(detectLanguage('12345')).toBe('en')
  })
  it('cleans text', () => {
    expect(cleanNote('  a\u0000b  c ')).toBe('ab c')
    expect(cleanNote('​')).toBe('​')                    // ordinary zero-width characters are left alone
  })
  it('parses a note: nothing for empty, an error for a bad reason', () => {
    expect(parseNote(undefined, reasons)).toBeNull()
    expect(parseNote({ text: ' ' }, reasons)).toBeNull()
    expect(parseNote({ category: 'power' }, reasons)).toEqual({ text: null, category: 'power', language: null })
    expect(() => parseNote({ category: 'nope' }, reasons)).toThrow(/Choose a reason/)
  })
})
