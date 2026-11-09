import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { composeReasonNote } from '@isocode/engine'
import { buildApp, memoryMediaStore, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// The production update form lets a supervisor tap SEVERAL reasons and writes the note for them (the friend's review of the form).
// The database keeps the list in the order tapped, the first is still the main reason (`category`), and a note that is exactly the
// text written from the reasons is marked `generated` BY THE SERVER, never on the word of the phone: it then needs no AI call.
const NOW = new Date('2026-11-04T04:30:00Z')
const TAMIL_EDIT = 'இன்று மின்சாரம் போனது, இயந்திரம் நின்றது'

let pg: PGlite
let db: Db
let app: FastifyInstance
let aiCalls: string[]
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => {
  await resetAndSeed(pg)
  aiCalls = []
  app = buildApp({
    db, tokenSecret: 'x'.repeat(40), clock: () => NOW, media: memoryMediaStore(),
    noteAi: async (i) => { aiCalls.push(i.text); return { english: 'Machines stopped.', category: 'machine', confidence: 0.9, why: 'test', model: 'fake' } },
  })
})
afterAll(async () => { await pg.close() })

const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
const merch = () => login({ email: CREDS.email, password: CREDS.password })
const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
const send = async (note: unknown, over: object = {}) => app.inject({
  method: 'POST', url: '/api/events', headers: await sup(),
  payload: { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', qty: 100, note, ...over },
})
const rows = async () => (await pg.query<any>('select * from note order by created_at')).rows
const count = async (t: string) => (await pg.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0]!.n
const review = async () => (await app.inject({ method: 'GET', url: '/api/review', headers: await merch() })).json() as { notes: any[] }

describe('BE-083: several reasons per note', () => {
  it('BE-083: stores the reasons in the order they were tapped, and the first is the main reason', async () => {
    expect((await send({ categories: ['machine', 'labour', 'material'], text: 'Three problems' })).statusCode).toBe(200)
    const [n] = await rows()
    expect(n.categories).toEqual(['machine', 'labour', 'material'])
    expect(n.category).toBe('machine')
    expect(n.category_by).toBe('supervisor')
  })
  it('BE-083: a phone that still sends one `category` gets a one-item list', async () => {
    await send({ category: 'power', text: 'Power cut' })
    expect((await rows())[0]).toMatchObject({ category: 'power', categories: ['power'] })
  })
  it('BE-083: reasons alone are a note (no text needed), and no reasons and no text is no note', async () => {
    await send({ categories: ['quality', 'other'] })
    await send({ categories: [] })
    const r = await rows()
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ category: 'quality', categories: ['quality', 'other'], language: null, generated: false })
  })
  it('BE-083: `category` may be sent with the list when it is the first of it', async () => {
    expect((await send({ category: 'labour', categories: ['labour', 'power'] })).statusCode).toBe(200)
    expect((await rows())[0]).toMatchObject({ category: 'labour', categories: ['labour', 'power'] })
  })
  it('BE-083: an older note, from before the list existed, has a one-item list in the database', async () => {
    const old = await pg.query<any>('select category, categories from note where category is not null limit 1')
    for (const r of old.rows) expect(r.categories).toEqual([r.category])
  })
})

describe('BE-084: a bad list is refused and writes nothing', () => {
  it.each([
    ['an id that is not on the list', { categories: ['machine', 'gremlins'] }],
    ['the same reason twice', { categories: ['machine', 'machine'] }],
    ['more than seven reasons', { categories: ['labour', 'absence', 'machine', 'material', 'power', 'quality', 'other', 'labour'] }],
    ['a list that is not a list', { categories: 'machine' }],
    ['an item that is not text', { categories: ['machine', 7] }],
    ['a `category` that is not the first of the list', { category: 'power', categories: ['machine', 'power'] }],
  ])('BE-084: %s', async (_label, note) => {
    const events = await count('update_event')
    const res = await send(note)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBeTruthy()
    expect(await count('note')).toBe(0)
    expect(await count('update_event')).toBe(events)
  })
  it('BE-084: a single `category` that has left the list is still filed as "other", as before', async () => {
    expect((await send({ category: 'no-such-reason' })).statusCode).toBe(200)
    expect((await rows())[0]).toMatchObject({ category: 'other', categories: ['other'] })
  })
})

describe('BE-085: "generated" is decided by the server', () => {
  it('BE-085: text that is exactly the sentence written from the reasons is generated, in English', async () => {
    const ids = ['machine', 'labour', 'material']
    await send({ categories: ids, text: composeReasonNote('en', ids) })
    expect((await rows())[0]).toMatchObject({ generated: true, language: 'en', text_en: composeReasonNote('en', ids), category: 'machine' })
  })
  it('BE-085: and in Tamil, with the English meaning filled in beside the Tamil original', async () => {
    const ids = ['power', 'machine']
    await send({ categories: ids, text: composeReasonNote('ta', ids) })
    expect((await rows())[0]).toMatchObject({
      generated: true, language: 'ta', text_ta: composeReasonNote('ta', ids), text_en: composeReasonNote('en', ids),
    })
  })
  it('BE-085: a generated note is marked as decided by the supervisor and needs no suggestion', async () => {
    const ids = ['absence', 'quality']
    await send({ categories: ids, text: composeReasonNote('en', ids) })
    expect((await rows())[0]).toMatchObject({
      ai_status: 'suggested', ai_model: 'supervisor-choice', ai_category: 'absence', ai_text_en: composeReasonNote('en', ids), ai_attempts: 0,
    })
    expect(Number((await rows())[0].confidence)).toBe(1)
  })
  it('BE-085: text the supervisor changed, or added to, is not generated and is still for the AI', async () => {
    const ids = ['machine', 'power']
    await send({ categories: ids, text: composeReasonNote('en', ids) + ' Two shifts lost.' })
    await send({ categories: ids, text: TAMIL_EDIT })
    for (const n of await rows()) expect(n).toMatchObject({ generated: false, ai_status: null })
  })
  it('BE-085: the phone cannot say a note is generated: a `generated` field is ignored, and the text decides', async () => {
    const ids = ['power']
    await send({ categories: ids, text: 'I wrote this myself', generated: true })
    await send({ categories: ids, text: composeReasonNote('en', ids), generated: false })
    const r = await rows()
    expect(r[0]).toMatchObject({ generated: false, ai_status: null })
    expect(r[1]).toMatchObject({ generated: true })
  })
  it('BE-085: the sentence for another set of reasons does not count (the text must match the reasons)', async () => {
    await send({ categories: ['machine', 'power'], text: composeReasonNote('en', ['power', 'machine']) })   // right words, wrong order
    await send({ categories: ['labour'], text: composeReasonNote('en', ['machine']) })
    for (const n of await rows()) expect(n.generated).toBe(false)
  })
})

describe('BE-086: a generated note does not use the AI', () => {
  it('BE-086: asking for suggestions skips it, and the day\'s AI budget is not spent on it', async () => {
    const ids = ['material', 'labour']
    await send({ categories: ids, text: composeReasonNote('ta', ids) })
    const res = await app.inject({ method: 'POST', url: '/api/notes/suggest', headers: await merch(), payload: {} })
    expect(res.statusCode).toBe(200)
    expect(aiCalls).toEqual([])
    expect(await count('ai_budget')).toBe(0)
  })
  it('BE-086: typed text still goes to the AI exactly as before', async () => {
    await send({ categories: ['machine'], text: TAMIL_EDIT })
    await app.inject({ method: 'POST', url: '/api/notes/suggest', headers: await merch(), payload: {} })
    expect(aiCalls).toEqual([TAMIL_EDIT])
    expect((await rows())[0]).toMatchObject({ generated: false, ai_status: 'suggested', ai_model: 'fake' })
  })
})

describe('BE-087: the review list says which reasons and whether the note was generated', () => {
  it('BE-087: a new note carries categories and generated; so does an old one', async () => {
    const ids = ['quality', 'machine']
    await send({ categories: ids, text: composeReasonNote('en', ids) })
    const notes = (await review()).notes
    const mine = notes.find((n) => n.generated)!
    expect(mine).toMatchObject({ categories: ['quality', 'machine'], category: 'quality', generated: true })
    for (const n of notes) {
      expect(Array.isArray(n.categories)).toBe(true)
      expect(typeof n.generated).toBe('boolean')
      if (n.category) expect(n.categories[0]).toBe(n.category)
    }
  })
  it('BE-087: a row that has a main reason but an empty list reads as a one-item list', async () => {
    await pgliteDb(pg).tx({ role: 'system' }, (tx) => tx.query(`insert into note (order_id, buyer_id, stage, unit_id, text_en, category, category_by) values ($1, $2, 'sewing', $3, 'old row', 'power', 'supervisor')`, [ID.orderRed, ID.buyerB, ID.unit1]))
    const n = (await review()).notes.find((x) => x.textEn === 'old row' || x.original === 'old row')!
    expect(n.categories).toEqual(['power'])
  })
  it('BE-087: a buyer still sees no note at all', async () => {
    await send({ categories: ['machine'], text: 'secret floor talk' })
    const tok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token
    const link = (await app.inject({ method: 'POST', url: '/api/buyer-links', headers: { authorization: `Bearer ${tok}` }, payload: { buyerId: ID.buyerB, days: 1, label: 'x' } })).json()
    const out = JSON.stringify((await app.inject({ method: 'GET', url: '/api/buyer/orders', headers: { authorization: `Bearer ${link.token}` } })).json())
    expect(out).not.toMatch(/secret floor talk|categories|generated/)
  })
})

describe('BE-088: the merchandiser settles the main reason', () => {
  const settle = async (id: string, category: string) => app.inject({ method: 'POST', url: `/api/notes/${id}/confirm`, headers: await merch(), payload: { category } })
  it('BE-088: choosing one of the supervisor\'s reasons moves it to the front and keeps the others', async () => {
    const ids = ['machine', 'labour', 'material']
    await send({ categories: ids, text: composeReasonNote('en', ids) })
    const n = (await rows())[0]
    expect((await settle(n.id, 'material')).statusCode).toBe(200)
    expect((await rows())[0]).toMatchObject({ category: 'material', categories: ['material', 'machine', 'labour'], category_by: 'merchandiser', generated: false })
  })
  it('BE-088: choosing a reason the supervisor did not tap replaces the list with that one', async () => {
    await send({ categories: ['machine', 'labour'], text: 'two things' })
    const n = (await rows())[0]
    await settle(n.id, 'power')
    expect((await rows())[0]).toMatchObject({ category: 'power', categories: ['power'] })
  })
  it('BE-088: confirming with the same main reason changes nothing and a generated note stays generated', async () => {
    const ids = ['quality', 'power']
    await send({ categories: ids, text: composeReasonNote('en', ids) })
    const n = (await rows())[0]
    await settle(n.id, 'quality')
    expect((await rows())[0]).toMatchObject({ category: 'quality', categories: ['quality', 'power'], generated: true, category_by: 'supervisor' })
  })
})

describe('BE-089: a supervisor session cannot forge what the server decides', () => {
  const asSup = (sql: string, params: unknown[]) => pgliteDb(pg).tx({ role: 'supervisor', unitId: ID.unit1 }, (tx) => tx.query(sql, params))
  const base = [ID.orderRed, ID.buyerB, 'sewing', ID.unit1]
  it('BE-089: a plain note and a note with reasons are allowed', async () => {
    await expect(asSup(`insert into note (order_id, buyer_id, stage, unit_id, text_en, category, categories) values ($1,$2,$3,$4,'x','machine','{machine,labour}')`, base)).resolves.toBeDefined()
  })
  it('BE-089: `generated` without the supervisor-choice shape is refused', async () => {
    await expect(asSup(`insert into note (order_id, buyer_id, stage, unit_id, text_en, category, categories, generated) values ($1,$2,$3,$4,'x','machine','{machine}',true)`, base)).rejects.toThrow(/row-level security/)
  })
  it('BE-089: an AI-looking suggestion written by a supervisor is refused', async () => {
    await expect(asSup(`insert into note (order_id, buyer_id, stage, unit_id, text_en, ai_status, ai_model, confidence) values ($1,$2,$3,$4,'x','suggested','groq',0.99)`, base)).rejects.toThrow(/row-level security/)
  })
  it('BE-089: confirmation and "chosen by a merchandiser" are still refused', async () => {
    await expect(asSup(`insert into note (order_id, buyer_id, stage, unit_id, text_en, category, category_by) values ($1,$2,$3,$4,'x','power','merchandiser')`, base)).rejects.toThrow(/row-level security/)
    await expect(asSup(`insert into note (order_id, buyer_id, stage, unit_id, text_en, confirmed_at) values ($1,$2,$3,$4,'x', now())`, base)).rejects.toThrow(/row-level security/)
  })
  it('BE-089: a list that disagrees with the main reason, or is longer than the list of reasons, is refused by the table', async () => {
    await expect(asSup(`insert into note (order_id, buyer_id, stage, unit_id, text_en, category, categories) values ($1,$2,$3,$4,'x','power','{machine}')`, base)).rejects.toThrow(/note_categories_ok|check/)
    await expect(asSup(`insert into note (order_id, buyer_id, stage, unit_id, text_en, category, categories) values ($1,$2,$3,$4,'x','a','{a,b,c,d,e,f,g,h}')`, base)).rejects.toThrow(/note_categories_ok|check/)
  })
})
