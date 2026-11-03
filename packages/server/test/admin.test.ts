import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, memoryMediaStore, signToken, weakPassword, weakPin, type Db } from '../src/index.js'
import { CREDS, ID, TEMPLATE_ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const NOW = new Date('2026-11-04T04:30:00Z')
const SECRET = 'x'.repeat(40)
const jpeg = (): Buffer => { const b = Buffer.alloc(2000, 0x41); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[1998] = 0xff; b[1999] = 0xd9; return b }

let pg: PGlite
let db: Db
let app: FastifyInstance
let media: ReturnType<typeof memoryMediaStore>
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => {
  await resetAndSeed(pg)
  media = memoryMediaStore()
  app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, media })
})
afterAll(async () => { await pg.close() })

const signIn = async (b: object) => app.inject({ method: 'POST', url: '/api/auth/login', payload: b })
const tokenOf = async (b: object) => (await signIn(b)).json().token as string
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
const merch = async () => bearer(await tokenOf({ email: CREDS.email, password: CREDS.password }))
const sup = async () => bearer(await tokenOf({ phone: CREDS.phone, pin: CREDS.pin }))
const post = async (url: string, payload: object = {}, h?: Record<string, string>) => app.inject({ method: 'POST', url, payload, headers: h ?? await merch() })
const get = async (url: string, h?: Record<string, string>) => app.inject({ url, headers: h ?? await merch() })
const NEW_SUP = { phone: '98100 22334', pin: '7391', unitId: ID.unit2, label: 'Ravi, Unit 2' }

describe('PIN and password strength', () => {
  it.each([['0000'], ['1111'], ['9999'], ['1234'], ['4321'], ['2345'], ['9876'], ['1212'], ['2121'], ['5656'], ['2580'], ['1004'], ['123'], ['12345'], ['12a4'], ['']])('refuses the PIN %j', (pin) => {
    expect(weakPin(pin)).not.toBeNull()
  })
  it.each([['7391'], ['4072'], ['8514'], ['3068']])('accepts the PIN %j', (pin) => expect(weakPin(pin)).toBeNull())
  it('passwords must be 10+ characters and not the email or one repeated character', () => {
    expect(weakPassword('short', 'a@b.co')).toMatch(/at least 10/)
    expect(weakPassword('aaaaaaaaaaaa', 'a@b.co')).toMatch(/too easy/)
    expect(weakPassword('someone@example.com', 'someone@example.com')).toMatch(/too easy/)
    expect(weakPassword('correct horse battery', 'a@b.co')).toBeNull()
  })
})

describe('people', () => {
  it('lists everyone, showing a phone number only by its last four digits and never a secret', async () => {
    const res = await get('/api/accounts')
    const body = res.json()
    expect(body.accounts.map((a: any) => [a.role, a.phoneEnd, a.unitName])).toEqual([['merchandiser', null, null], ['supervisor', '3210', 'Unit 1']])
    expect(res.body).not.toMatch(/9876543210|hash|scrypt|pin_hash|password/i)
  })

  it('adds a supervisor who can then sign in on their own phone, in their own unit', async () => {
    expect((await post('/api/accounts/supervisors', NEW_SUP)).statusCode).toBe(201)
    const res = await signIn({ phone: '+91 98100 22334', pin: '7391' })
    expect(res.statusCode).toBe(200)
    const stages = (await get('/api/my/stages', bearer(res.json().token))).json().stages
    expect(stages.map((s: any) => s.po)).toEqual(['C-PO-0488'])          // unit 2's order only
    expect((await get('/api/accounts')).json().accounts.find((a: any) => a.phoneEnd === '2334').label).toBe('Ravi, Unit 2')
  })

  it.each([
    ['a weak PIN', { pin: '1234' }, 400], ['a PIN that is not 4 digits', { pin: '73' }, 400], ['a bad phone number', { phone: '12345' }, 400],
    ['no name', { label: '  ' }, 400], ['a malformed unit', { unitId: 'x' }, 400], ['an unknown unit', { unitId: '00000000-0000-0000-0000-00000000dead' }, 404],
  ])('refuses %s', async (_l, over, status) => {
    expect((await post('/api/accounts/supervisors', { ...NEW_SUP, ...over })).statusCode).toBe(status)
  })
  it('refuses a phone number that already has an account', async () => {
    expect((await post('/api/accounts/supervisors', { ...NEW_SUP, phone: CREDS.phone })).statusCode).toBe(409)
  })

  it('adds a merchandiser; the email is not case-sensitive; weak passwords and duplicates are refused', async () => {
    const mk = { email: 'Asha@Example.test', password: 'a long enough passphrase', label: 'Asha' }
    expect((await post('/api/accounts/merchandisers', mk)).statusCode).toBe(201)
    expect((await signIn({ email: 'asha@example.test', password: mk.password })).statusCode).toBe(200)
    expect((await post('/api/accounts/merchandisers', { ...mk, email: 'ASHA@example.test' })).statusCode).toBe(409)
    expect((await post('/api/accounts/merchandisers', { ...mk, email: 'b@example.test', password: 'short' })).statusCode).toBe(400)
    expect((await post('/api/accounts/merchandisers', { ...mk, email: 'not-an-email' })).statusCode).toBe(400)
  })

  it('only a merchandiser can see or change people', async () => {
    const h = await sup()
    expect((await get('/api/accounts', h)).statusCode).toBe(403)
    expect((await post('/api/accounts/supervisors', NEW_SUP, h)).statusCode).toBe(403)
    expect((await post('/api/accounts/merchandisers', { email: 'x@y.zz', password: 'a long enough passphrase', label: 'x' }, h)).statusCode).toBe(403)
    expect((await post(`/api/accounts/${ID.sup1}/pin`, { pin: '7391' }, h)).statusCode).toBe(403)
    expect((await get('/api/accounts', {})).statusCode).toBe(401)
  })
})

describe('a lost phone, a forgotten PIN, a leaver', () => {
  it('resetting a PIN: the old PIN and every old sign-in stop working, the new PIN works, and a lockout is cleared', async () => {
    const oldToken = await tokenOf({ phone: CREDS.phone, pin: CREDS.pin })
    for (let i = 0; i < 5; i++) await signIn({ phone: CREDS.phone, pin: '0001' })            // locks the account
    expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).statusCode).toBe(429)
    expect((await post(`/api/accounts/${ID.sup1}/pin`, { pin: '5083' })).statusCode).toBe(200)
    expect((await get('/api/my/stages', bearer(oldToken))).statusCode).toBe(401)              // the phone that had the old sign-in is out
    expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).statusCode).toBe(401)
    expect((await signIn({ phone: CREDS.phone, pin: '5083' })).statusCode).toBe(200)          // and the lock is gone
  })
  it('a reset PIN must be strong, and only a supervisor account can have one', async () => {
    expect((await post(`/api/accounts/${ID.sup1}/pin`, { pin: '1234' })).statusCode).toBe(400)
    expect((await post(`/api/accounts/${ID.merch}/pin`, { pin: '5083' })).statusCode).toBe(404)
    expect((await post('/api/accounts/00000000-0000-0000-0000-00000000dead/pin', { pin: '5083' })).statusCode).toBe(404)
  })

  it('signing someone out everywhere ends every phone at once, and they can sign in again', async () => {
    const phoneA = await tokenOf({ phone: CREDS.phone, pin: CREDS.pin })
    const phoneB = await tokenOf({ phone: CREDS.phone, pin: CREDS.pin })
    expect((await get('/api/my/stages', bearer(phoneA))).statusCode).toBe(200)
    expect((await post(`/api/accounts/${ID.sup1}/sign-out`)).statusCode).toBe(200)
    for (const t of [phoneA, phoneB]) expect((await get('/api/my/stages', bearer(t))).statusCode).toBe(401)
    expect((await get('/api/my/stages', bearer(await tokenOf({ phone: CREDS.phone, pin: CREDS.pin })))).statusCode).toBe(200)
  })

  it('stopping an account takes effect at once and sign-in is refused exactly like a wrong PIN', async () => {
    const t = await tokenOf({ phone: CREDS.phone, pin: CREDS.pin })
    expect((await post(`/api/accounts/${ID.sup1}/disabled`, { disabled: true })).statusCode).toBe(200)
    expect((await get('/api/my/stages', bearer(t))).statusCode).toBe(401)
    const stopped = await signIn({ phone: CREDS.phone, pin: CREDS.pin })
    const wrong = await signIn({ phone: CREDS.phone, pin: '0002' })
    expect(stopped.statusCode).toBe(401)
    expect(stopped.json()).toEqual(wrong.json())                                              // nothing says the account is stopped
    expect((await get('/api/accounts')).json().accounts.find((a: any) => a.id === ID.sup1).disabled).toBe(true)
  })
  it('allowing it again restores sign-in, but not the old sign-ins', async () => {
    const old = await tokenOf({ phone: CREDS.phone, pin: CREDS.pin })
    await post(`/api/accounts/${ID.sup1}/disabled`, { disabled: true })
    await post(`/api/accounts/${ID.sup1}/disabled`, { disabled: false })
    expect((await get('/api/my/stages', bearer(old))).statusCode).toBe(401)
    expect((await signIn({ phone: CREDS.phone, pin: CREDS.pin })).statusCode).toBe(200)
  })
  it('a merchandiser cannot stop their own account, and the flag must be true or false', async () => {
    expect((await post(`/api/accounts/${ID.merch}/disabled`, { disabled: true })).statusCode).toBe(400)
    expect((await post(`/api/accounts/${ID.sup1}/disabled`, { disabled: 'yes' })).statusCode).toBe(400)
    expect((await get('/api/board')).statusCode).toBe(200)                                    // still signed in
  })
  it('a supervisor moved to another unit is signed out of the old sign-in', async () => {
    const t = await tokenOf({ phone: CREDS.phone, pin: CREDS.pin })
    await pg.query('update account set unit_id = $1 where id = $2', [ID.unit2, ID.sup1])
    expect((await get('/api/my/stages', bearer(t))).statusCode).toBe(401)
  })
  it('a sign-in for an account that no longer exists is refused', async () => {
    const ghost = signToken({ sub: '00000000-0000-0000-0000-00000000dead', role: 'merchandiser', exp: Math.floor(NOW.getTime() / 1000) + 600, ver: 0 }, SECRET)
    expect((await get('/api/board', bearer(ghost))).statusCode).toBe(401)
  })
  it('sign-ins made before this feature existed (no version) still work until the version changes', async () => {
    const legacy = signToken({ sub: ID.merch, role: 'merchandiser', exp: Math.floor(NOW.getTime() / 1000) + 600 }, SECRET)
    expect((await get('/api/board', bearer(legacy))).statusCode).toBe(200)
    await post(`/api/accounts/${ID.merch}/sign-out`)
    expect((await get('/api/board', bearer(legacy))).statusCode).toBe(401)
  })
})

describe('units', () => {
  it('lists and creates units; names are unique ignoring case; type must be own or subcontractor', async () => {
    expect((await get('/api/units')).json().units.map((u: any) => u.name)).toEqual(['Unit 1', 'Unit 2'])
    expect((await post('/api/units', { name: 'Washing (Selvam)', type: 'subcontractor' })).statusCode).toBe(201)
    expect((await post('/api/units', { name: 'unit 1', type: 'own' })).statusCode).toBe(409)
    expect((await post('/api/units', { name: 'X', type: 'friend' })).statusCode).toBe(400)
    expect((await post('/api/units', { name: ' ', type: 'own' })).statusCode).toBe(400)
    expect((await get('/api/units', await sup())).statusCode).toBe(403)
  })
})

describe('closed days', () => {
  const board = async () => (await get('/api/board')).json().rows.find((r: any) => r.po === 'B-PO-88240')

  it('a closure changes the working days the board counts, and clearing it puts them back', async () => {
    expect((await board()).maths).toContain('Need 467/day')                                    // 6 working days to 11 Nov
    expect((await post('/api/calendar', { unitId: ID.unit1, date: '2026-11-09', working: false, note: 'Deepavali' })).statusCode).toBe(200)
    expect((await board()).maths).toContain('Need 560/day')                                    // 5 working days
    const days = (await get(`/api/calendar?unitId=${ID.unit1}`)).json().days
    expect(days).toEqual([{ unitId: ID.unit1, date: '2026-11-09', working: false, note: 'Deepavali' }])
    expect((await post('/api/calendar/clear', { unitId: ID.unit1, date: '2026-11-09' })).statusCode).toBe(200)
    expect((await board()).maths).toContain('Need 467/day')
  })
  it('a Sunday can be marked as worked, and changing a day updates it instead of adding a second', async () => {
    await post('/api/calendar', { unitId: ID.unit1, date: '2026-11-08', working: true })
    expect((await board()).maths).toContain('Need 400/day')                                    // 7 working days
    await post('/api/calendar', { unitId: ID.unit1, date: '2026-11-08', working: false, note: 'changed our mind' })
    expect((await get(`/api/calendar?unitId=${ID.unit1}`)).json().days).toHaveLength(1)
    expect((await board()).maths).toContain('Need 467/day')
  })
  it('one unit\'s closure does not touch another unit', async () => {
    await post('/api/calendar', { unitId: ID.unit2, date: '2026-11-09', working: false })
    expect((await board()).maths).toContain('Need 467/day')
  })
  it('refuses a bad date, an unknown unit, clearing a day that has no setting, and a supervisor', async () => {
    expect((await post('/api/calendar', { unitId: ID.unit1, date: '2026-02-30', working: false })).statusCode).toBe(400)
    expect((await post('/api/calendar', { unitId: ID.unit1, date: '2026-11-09', working: 'no' })).statusCode).toBe(400)
    expect((await post('/api/calendar', { unitId: '00000000-0000-0000-0000-00000000dead', date: '2026-11-09', working: false })).statusCode).toBe(404)
    expect((await post('/api/calendar/clear', { unitId: ID.unit1, date: '2026-11-09' })).statusCode).toBe(404)
    expect((await post('/api/calendar', { unitId: ID.unit1, date: '2026-11-09', working: false }, await sup())).statusCode).toBe(403)
  })
})

describe('TNA templates', () => {
  const stages = (o: object[] = []) => [
    { stage: 'Cutting', workingDaysBefore: 10, unitId: ID.unit1 }, { stage: 'sewing', workingDaysBefore: 5, unitId: ID.unit1 },
    { stage: 'Packing', workingDaysBefore: 0, unitId: ID.unit2 }, ...o,
  ]
  const order = (templateId: string) => post('/api/orders', { buyerId: ID.buyerB, po: `T-${Math.random()}`, style: 's', colour: 'c', sizes: { M: 100 }, exFactory: '2026-11-27', templateId })

  it('lists the seeded template with its units', async () => {
    const t = (await get('/api/templates')).json().templates
    expect(t).toHaveLength(1)
    expect(t[0].stages.map((s: any) => [s.stage, s.workingDaysBefore, s.unitName])).toEqual([['cutting', 12, 'Unit 1'], ['sewing', 6, 'Unit 1'], ['finishing', 2, 'Unit 1'], ['packing', 0, 'Unit 1']])
  })

  it('a new template can be used at once to create an order, with the dates it describes', async () => {
    const { id } = (await post('/api/templates', { name: 'Fleece', stages: stages() })).json()
    expect((await get('/api/orders/options')).json().templates.map((t: any) => t.name)).toContain('Fleece')
    const made = (await order(id)).json()
    expect(Object.fromEntries(made.milestones.map((m: any) => [m.stage, m.plannedEnd]))).toEqual({ cutting: '2026-11-16', sewing: '2026-11-21', packing: '2026-11-27' })   // counted by hand: Sunday 22 Nov is skipped
    expect(made.milestones.find((m: any) => m.stage === 'packing').unitId).toBe(ID.unit2)    // each stage keeps its own unit
  })

  it('editing a template changes FUTURE orders only; orders already made keep their dates', async () => {
    const first = (await order(TEMPLATE_ID)).json()
    await post('/api/templates', { id: TEMPLATE_ID, name: 'Knit tee', stages: [{ stage: 'sewing', workingDaysBefore: 3, unitId: ID.unit1 }, { stage: 'packing', workingDaysBefore: 0, unitId: ID.unit1 }] })
    const second = (await order(TEMPLATE_ID)).json()
    expect(first.milestones).toHaveLength(4)
    expect(second.milestones.map((m: any) => m.stage)).toEqual(['sewing', 'packing'])
    const kept = await pg.query<any>('select stage from milestone where order_id = $1 order by sequence', [first.orderId])
    expect(kept.rows.map((r) => r.stage)).toEqual(['cutting', 'sewing', 'finishing', 'packing'])
  })

  it.each([
    ['a later stage due before an earlier one', { stages: [{ stage: 'a', workingDaysBefore: 2, unitId: ID.unit1 }, { stage: 'b', workingDaysBefore: 8, unitId: ID.unit1 }] }, 400, /does not work/],
    ['the same stage twice (any case)', { stages: [{ stage: 'Sewing', workingDaysBefore: 5, unitId: ID.unit1 }, { stage: 'sewing', workingDaysBefore: 2, unitId: ID.unit1 }] }, 400, /twice/],
    ['no stages', { stages: [] }, 400, /between 1 and 20/],
    ['21 stages', { stages: Array.from({ length: 21 }, (_, i) => ({ stage: `s${i}`, workingDaysBefore: 21 - i, unitId: ID.unit1 })) }, 400, /between 1 and 20/],
    ['a negative offset', { stages: [{ stage: 'a', workingDaysBefore: -1, unitId: ID.unit1 }] }, 400, /whole number/],
    ['a fractional offset', { stages: [{ stage: 'a', workingDaysBefore: 1.5, unitId: ID.unit1 }] }, 400, /whole number/],
    ['an offset over a year', { stages: [{ stage: 'a', workingDaysBefore: 400, unitId: ID.unit1 }] }, 400, /0 to 365/],
    ['a blank stage name', { stages: [{ stage: ' ', workingDaysBefore: 1, unitId: ID.unit1 }] }, 400, /required/],
    ['an unknown unit', { stages: [{ stage: 'a', workingDaysBefore: 1, unitId: '00000000-0000-0000-0000-00000000dead' }] }, 404, /No such unit/],
    ['a stage with no unit', { stages: [{ stage: 'a', workingDaysBefore: 1 }] }, 400, /unit/],
  ])('refuses %s', async (_l, body, status, msg) => {
    const res = await post('/api/templates', { name: 'Bad', ...body })
    expect(res.statusCode).toBe(status)
    expect(res.json().error.message).toMatch(msg)
    expect((await get('/api/templates')).json().templates).toHaveLength(1)                     // nothing was saved
  })
  it('refuses a missing name, a duplicate name, and a supervisor', async () => {
    expect((await post('/api/templates', { name: ' ', stages: stages() })).statusCode).toBe(400)
    expect((await post('/api/templates', { name: 'knit TEE', stages: stages() })).statusCode).toBe(409)
    expect((await post('/api/templates', { name: 'X', stages: stages() }, await sup())).statusCode).toBe(403)
  })
  it('can be deleted, without touching orders made from it; an unknown one is 404', async () => {
    const o = (await order(TEMPLATE_ID)).json()
    expect((await post(`/api/templates/${TEMPLATE_ID}/delete`)).statusCode).toBe(200)
    expect((await get('/api/templates')).json().templates).toEqual([])
    expect((await pg.query('select 1 from milestone where order_id = $1', [o.orderId])).rows).toHaveLength(4)
    expect((await post(`/api/templates/${TEMPLATE_ID}/delete`)).statusCode).toBe(404)
  })
})

describe('photos: withdraw and clean up', () => {
  const upload = async () => (await app.inject({
    method: 'POST', url: '/api/photos',
    headers: { ...(await sup()), 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': 'sewing', 'x-date': '2026-11-04' }, payload: jpeg(),
  })).json().id as string
  const buyerLink = async () => (await post('/api/buyer-links', { buyerId: ID.buyerB })).json().token as string

  it('lists approved photos so one can be withdrawn, and withdrawing hides it from the buyer', async () => {
    const id = await upload()
    expect((await get('/api/review')).json().approvedPhotos).toEqual([])
    await post(`/api/photos/${id}/approve`)
    const approved = (await get('/api/review')).json().approvedPhotos
    expect(approved).toEqual([{ id, orderId: ID.orderRed, po: 'B-PO-88240', buyerName: 'Buyer B', stage: 'sewing', takenOn: '2026-11-04' }])
    const t = await buyerLink()
    expect((await app.inject({ url: `/api/buyer/photos/${id}`, headers: bearer(t) })).statusCode).toBe(200)
    await post(`/api/photos/${id}/reject`)
    expect((await get('/api/review')).json().approvedPhotos).toEqual([])
    expect((await app.inject({ url: `/api/buyer/photos/${id}`, headers: bearer(t) })).statusCode).toBe(404)
  })

  it('cleans the files of old rejected photos, keeps the rows, and is safe to repeat', async () => {
    const id = await upload()
    await post(`/api/photos/${id}/reject`)
    expect(media.files.size).toBe(1)
    expect((await post('/api/photos/purge', { days: 7 })).json().purged).toBe(0)               // too recent
    expect(media.files.size).toBe(1)
    expect((await post('/api/photos/purge', { days: 0 })).json().purged).toBe(1)
    expect(media.files.size).toBe(0)
    expect((await pg.query<any>('select purged_at from photo where id = $1', [id])).rows[0].purged_at).not.toBeNull()
    expect((await post('/api/photos/purge', { days: 0 })).json().purged).toBe(0)
    expect((await get(`/api/photos/${id}/file`)).statusCode).toBe(404)
  })
  it('never cleans a photo that is waiting or approved', async () => {
    const waiting = await upload(); const approved = await upload()
    await post(`/api/photos/${approved}/approve`)
    expect((await post('/api/photos/purge', { days: 0 })).json().purged).toBe(0)
    expect(media.files.size).toBe(2)
    expect(waiting).toBeTruthy()
  })
  it('refuses odd day counts and a supervisor', async () => {
    for (const days of [-1, 1.5, 99999, 'x']) expect((await post('/api/photos/purge', { days })).statusCode).toBe(400)
    expect((await post('/api/photos/purge', { days: 7 }, await sup())).statusCode).toBe(403)
  })
})
