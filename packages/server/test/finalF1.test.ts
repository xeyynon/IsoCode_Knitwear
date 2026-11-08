import { afterAll, describe, expect, it } from 'vitest'
import net from 'node:net'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type AppOptions } from '../src/app'
import { hashSecret } from '../src/auth'
import { demoClock } from '../src/demoClock'
import { DEMO_MEDIA_BYTES_CAP, DEMO_PHOTOS_PER_DAY, DEMO_READ_ONLY_MESSAGE, isDemoMode } from '../src/demoMode'
import { DEMO_BUYER_TOKENS, DEMO_LOGINS, DEMO_TODAY, ensureDemo, seedDemo, topUpDemo } from '../src/demoSeed'
import { startDemoApi } from '../src/demo'
import { memoryMediaStore } from '../src/mediaStore'
import type { Tx } from '../src/db'
import { migratedDb, pgliteDb } from './helpers'

// The final bug round, lane F1: the shared hosted demo. Every rule here is for demo mode only; the second half of each block proves the same
// request still works on a normal deployment.

const SECRET = 'x'.repeat(40)
const REAL_NOW = new Date('2026-11-09T06:00:00Z')   // three days after the demo day: the real clock runs on, the factory day does not
const open: { app: FastifyInstance; pg: PGlite }[] = []
afterAll(async () => { for (const o of open) { await o.app.close(); await o.pg.close() } })

interface Rig { app: FastifyInstance; pg: PGlite; merch: string; sup: string; as: (t: string) => { authorization: string }; setNow: (d: Date) => void }

async function rig(mode: 'demo' | 'normal', extra: Partial<AppOptions> = {}): Promise<Rig> {
  const pg = await migratedDb()
  const db = pgliteDb(pg)
  await db.tx({ role: 'system' }, (tx) => seedDemo(tx, DEMO_TODAY))
  let now = REAL_NOW
  const clock = () => now
  const app = buildApp({
    db, tokenSecret: SECRET, logger: false, clock, media: memoryMediaStore(),
    ...(mode === 'demo' ? { dayClock: demoClock(DEMO_TODAY, clock)! } : { clock: () => new Date(`${DEMO_TODAY}T04:30:00Z`) }),
    ...extra,
  })
  open.push({ app, pg })
  const login = async (p: object) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: p })).json().token as string
  const merch = await login(DEMO_LOGINS.merchandiser)
  const s = DEMO_LOGINS.supervisors[0]
  const sup = await login({ phone: s.phone, pin: s.pin })
  return { app, pg, merch, sup, as: (t) => ({ authorization: `Bearer ${t}` }), setNow: (d) => { now = d } }
}

const post = (r: Rig, token: string, url: string, payload: object = {}) => r.app.inject({ method: 'POST', url, headers: r.as(token), payload })

describe('demo mode is one explicit notion', () => {
  it('a pinned factory day means demo, an explicit flag wins, nothing set means normal', () => {
    expect(isDemoMode({})).toBe(false)
    expect(isDemoMode({ dayClock: () => new Date() })).toBe(true)
    expect(isDemoMode({ dayClock: () => new Date(), demo: false })).toBe(false)
    expect(isDemoMode({ demo: true })).toBe(true)
  })
})

describe('N-1: the shared demo cannot be locked, stopped or revoked by whoever holds the public logins', () => {
  it('N-1: in demo mode every account, link, template and calendar change answers 403 with a plain message', async () => {
    const r = await rig('demo')
    const accounts = (await r.app.inject({ method: 'GET', url: '/api/accounts', headers: r.as(r.merch) })).json().accounts as { id: string; email: string | null; role: string }[]
    const demoMerch = accounts.find((a) => a.email === DEMO_LOGINS.merchandiser.email)!
    const sup = accounts.find((a) => a.role === 'supervisor')!
    const links = (await r.app.inject({ method: 'GET', url: '/api/buyer-links', headers: r.as(r.merch) })).json().links as { id: string; buyerId: string }[]
    const templates = (await r.app.inject({ method: 'GET', url: '/api/templates', headers: r.as(r.merch) })).json().templates as { id: string }[]
    const units = (await r.app.inject({ method: 'GET', url: '/api/units', headers: r.as(r.merch) })).json().units as { id: string }[]
    const calls: [string, object][] = [
      ['/api/accounts/merchandisers', { email: 'evil@x.test', password: 'password long enough 1', label: 'x' }],
      ['/api/accounts/supervisors', { phone: '9123456780', pin: '4739', unitId: units[0]!.id, label: 'x' }],
      [`/api/accounts/${demoMerch.id}/disabled`, { disabled: true }],
      [`/api/accounts/${demoMerch.id}/disabled`, { disabled: false }],
      [`/api/accounts/${sup.id}/pin`, { pin: '1357' }],
      [`/api/accounts/${sup.id}/sign-out`, {}],
      ['/api/buyer-links', { buyerId: links[0]!.buyerId }],
      [`/api/buyer-links/${links[0]!.id}/revoke`, {}],
      [`/api/templates/${templates[0]!.id}/delete`, {}],
      ['/api/calendar', { unitId: units[0]!.id, date: '2026-12-25', working: false }],
      ['/api/calendar/clear', { unitId: units[0]!.id, date: '2026-11-09' }],
    ]
    for (const [url, payload] of calls) {
      const res = await post(r, r.merch, url, payload)
      expect(res.statusCode, url).toBe(403)
      expect(res.json().error.message, url).toBe(DEMO_READ_ONLY_MESSAGE)
    }
    // Everything the reviewers need still works afterwards: the published logins and both buyer links.
    expect((await r.app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_LOGINS.merchandiser })).statusCode).toBe(200)
    for (const s of DEMO_LOGINS.supervisors) expect((await r.app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: s.phone, pin: s.pin } })).statusCode).toBe(200)
    for (const t of Object.values(DEMO_BUYER_TOKENS)) expect((await r.app.inject({ method: 'GET', url: '/api/buyer/orders', headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(200)
    // The reads are untouched, and a signed-in supervisor still reaches nothing of an account route.
    expect((await r.app.inject({ method: 'GET', url: '/api/accounts', headers: r.as(r.merch) })).statusCode).toBe(200)
    expect((await r.app.inject({ method: 'GET', url: '/api/calendar', headers: r.as(r.merch) })).statusCode).toBe(200)
  })

  it('N-1: with demo mode off the same requests succeed, exactly as before', async () => {
    const r = await rig('normal')
    const units = (await r.app.inject({ method: 'GET', url: '/api/units', headers: r.as(r.merch) })).json().units as { id: string }[]
    const links = (await r.app.inject({ method: 'GET', url: '/api/buyer-links', headers: r.as(r.merch) })).json().links as { id: string; buyerId: string }[]
    const mk = await post(r, r.merch, '/api/accounts/merchandisers', { email: 'new@x.test', password: 'password long enough 1', label: 'New' })
    expect(mk.statusCode).toBe(201)
    const id = mk.json().id as string
    const sup = await post(r, r.merch, '/api/accounts/supervisors', { phone: '9123456780', pin: '4739', unitId: units[0]!.id, label: 'S' })
    expect(sup.statusCode).toBe(201)
    expect((await post(r, r.merch, `/api/accounts/${sup.json().id}/pin`, { pin: '1357' })).statusCode).toBe(200)
    expect((await post(r, r.merch, `/api/accounts/${id}/sign-out`)).statusCode).toBe(200)
    expect((await post(r, r.merch, `/api/accounts/${id}/disabled`, { disabled: true })).statusCode).toBe(200)
    expect((await post(r, r.merch, `/api/accounts/${id}/disabled`, { disabled: false })).statusCode).toBe(200)
    const link = await post(r, r.merch, '/api/buyer-links', { buyerId: links[0]!.buyerId })
    expect(link.statusCode).toBe(201)
    expect((await post(r, r.merch, `/api/buyer-links/${link.json().id}/revoke`)).statusCode).toBe(200)
    const t = await post(r, r.merch, '/api/templates', { name: 'Own template', stages: [{ stage: 'Cutting', workingDaysBefore: 3, unitId: units[0]!.id }] })
    expect(t.statusCode).toBe(201)
    expect((await post(r, r.merch, `/api/templates/${t.json().id}/delete`)).statusCode).toBe(200)
    expect((await post(r, r.merch, '/api/calendar', { unitId: units[0]!.id, date: '2026-12-25', working: false })).statusCode).toBe(200)
    expect((await post(r, r.merch, '/api/calendar/clear', { unitId: units[0]!.id, date: '2026-12-25' })).statusCode).toBe(200)
  })

  it('N-1: a database already bricked by the old build is repaired by the next deploy (accounts, PINs and links)', async () => {
    const r = await rig('normal')
    await r.pg.query(`update account set disabled_at = now(), pin_hash = 'x', password_hash = 'x', failed_attempts = 5, locked_until = now() + interval '1 day'`)
    await r.pg.query(`update buyer_link set revoked_at = now()`)
    expect((await r.app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_LOGINS.merchandiser })).statusCode).not.toBe(200)
    await pgliteDb(r.pg).tx({ role: 'system' }, (tx) => ensureDemo(tx, DEMO_TODAY, REAL_NOW))
    expect((await r.app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_LOGINS.merchandiser })).statusCode).toBe(200)
    for (const s of DEMO_LOGINS.supervisors) expect((await r.app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: s.phone, pin: s.pin } })).statusCode).toBe(200)
    for (const t of Object.values(DEMO_BUYER_TOKENS)) expect((await r.app.inject({ method: 'GET', url: '/api/buyer/orders', headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(200)
  })
})

describe('N-4: the shared evaluator account cannot be locked, the sign-in budget still counts per address', () => {
  const wrong = (r: Rig, ip: string, password: string) => r.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: ip, payload: { email: DEMO_LOGINS.merchandiser.email, password } })

  it('N-4: demo mode, 6 wrong passwords from one address, then the right one from another gives 200', async () => {
    const r = await rig('demo')
    for (let i = 0; i < 6; i++) expect((await wrong(r, '10.0.0.1', `nope${i}`)).statusCode).toBe(401)
    const ok = await r.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.0.2', payload: DEMO_LOGINS.merchandiser })
    expect(ok.statusCode).toBe(200)
    // ...and from the same address too, as long as that address has not used up its own budget.
    expect((await r.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.0.1', payload: DEMO_LOGINS.merchandiser })).statusCode).toBe(200)
  })

  it('N-4: the address is still counted: its budget of wrong tries ends in 429, and a supervisor demo login does not lock either', async () => {
    const r = await rig('demo')
    let last = 0
    for (let i = 0; i < 12; i++) last = (await wrong(r, '10.0.0.3', `nope${i}`)).statusCode
    expect(last).toBe(429)
    const sup = DEMO_LOGINS.supervisors[1]
    for (let i = 0; i < 6; i++) await r.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: `10.0.1.${i}`, payload: { phone: sup.phone, pin: '0000' } })
    expect((await r.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.2.1', payload: { phone: sup.phone, pin: sup.pin } })).statusCode).toBe(200)
  })

  it('N-4: demo mode still locks an account that is not a published demo login', async () => {
    const r = await rig('demo')
    await r.pg.query(`insert into account (role, email, password_hash, label) values ('merchandiser', 'other@x.test', $1, 'Other')`, [hashSecret('password long enough 1')])
    for (let i = 0; i < 5; i++) await r.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: `10.0.3.${i}`, payload: { email: 'other@x.test', password: 'nope' } })
    const res = await r.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.4.1', payload: { email: 'other@x.test', password: 'password long enough 1' } })
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe('locked')
  })

  it('N-4: demo mode off, five wrong passwords still lock the account for everybody (unchanged)', async () => {
    const r = await rig('normal')
    for (let i = 0; i < 5; i++) await wrong(r, `10.0.5.${i}`, `nope${i}`)
    const res = await r.app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.6.1', payload: DEMO_LOGINS.merchandiser })
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe('locked')
  })
})

describe('N-9: the seeded buyer links do not expire when the demo day is long past', () => {
  it('N-9: with the clock two years after the demo day the demo link still opens', async () => {
    const pg = await migratedDb()
    await pgliteDb(pg).tx({ role: 'system' }, (tx) => seedDemo(tx, DEMO_TODAY))
    const app = buildApp({ db: pgliteDb(pg), tokenSecret: SECRET, logger: false, clock: () => new Date('2028-11-06T06:00:00Z') })
    open.push({ app, pg })
    for (const t of Object.values(DEMO_BUYER_TOKENS)) expect((await app.inject({ method: 'GET', url: '/api/buyer/orders', headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(200)
    const years = (await pg.query<{ y: number }>(`select (extract(epoch from (min(expires_at) - now())) / 31557600)::float8 as y from buyer_link`)).rows[0]!.y
    expect(years).toBeGreaterThan(9)
  })
})

// ---- photos and events

const JPEG = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, n % 250), Buffer.from([0xff, 0xd9])])
const uuidN = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
async function firstStage(r: Rig) {
  const stages = (await r.app.inject({ method: 'GET', url: '/api/my/stages', headers: r.as(r.sup) })).json().stages as { orderId: string; stage: string }[]
  return stages[0]!
}
const photo = (r: Rig, st: { orderId: string; stage: string }, i: number, date = DEMO_TODAY) => r.app.inject({
  method: 'POST', url: '/api/photos',
  headers: { ...r.as(r.sup), 'content-type': 'image/jpeg', 'x-client-uuid': uuidN(i), 'x-order-id': st.orderId, 'x-stage': st.stage, 'x-date': date }, payload: JPEG(i),
})

describe('N-5: the public supervisor login cannot fill the free database with photos', () => {
  it('N-5: demo mode, the 21st photo of the day answers 429 quota, and a retry of a stored one still answers 200', async () => {
    const r = await rig('demo')
    const st = await firstStage(r)
    for (let i = 1; i <= DEMO_PHOTOS_PER_DAY; i++) expect((await photo(r, st, i)).statusCode, `photo ${i}`).toBe(200)
    const over = await photo(r, st, 99)
    expect(over.statusCode).toBe(429)
    expect(over.json().error.code).toBe('quota')
    const again = await photo(r, st, 3)   // the phone lost the reply: the same upload id is the same photo, not a new one
    expect(again.statusCode).toBe(200)
    expect(again.json().duplicate).toBe(true)
  })

  it('N-5: demo mode, more than the byte cap already stored answers 429 quota', async () => {
    const r = await rig('demo')
    const st = await firstStage(r)
    expect((await photo(r, st, 1)).statusCode).toBe(200)
    await r.pg.query('update photo set bytes = $1', [DEMO_MEDIA_BYTES_CAP + 1])
    const res = await photo(r, st, 2)
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe('quota')
    // A cleaned (purged) photo no longer counts.
    await r.pg.query('update photo set purged_at = now()')
    expect((await photo(r, st, 2)).statusCode).toBe(200)
  })

  it('N-5: demo mode off, no limit (unchanged)', async () => {
    const r = await rig('normal')
    const st = await firstStage(r)
    for (let i = 1; i <= DEMO_PHOTOS_PER_DAY + 2; i++) expect((await photo(r, st, i)).statusCode, `photo ${i}`).toBe(200)
  })
})

describe('N-10: an update dated after the pinned day is kept on the pinned day in the demo', () => {
  const event = (r: Rig, st: { orderId: string; stage: string }, i: number, date: string) =>
    post(r, r.sup, '/api/events', { clientUuid: uuidN(1000 + i), orderId: st.orderId, stage: st.stage, date, qty: 10 })

  it('N-10: demo mode, an event dated the pinned day + 1 is accepted and stored on the pinned day', async () => {
    const r = await rig('demo')
    const st = await firstStage(r)
    const res = await event(r, st, 1, '2026-11-07')
    expect(res.statusCode).toBe(200)
    const stored = (await r.pg.query<{ date: string }>(`select date::text as date from update_event where client_uuid = $1`, [uuidN(1001)])).rows
    expect(stored).toEqual([{ date: DEMO_TODAY }])
    // the same through the offline queue's batch route, and for a date far ahead
    const batch = await post(r, r.sup, '/api/events/batch', { events: [{ clientUuid: uuidN(1002), orderId: st.orderId, stage: st.stage, date: '2027-02-01', qty: 5 }] })
    expect(batch.json().results[0].result).toBe('accepted')
    expect((await r.pg.query<{ date: string }>(`select date::text as date from update_event where client_uuid = $1`, [uuidN(1002)])).rows).toEqual([{ date: DEMO_TODAY }])
    // a past date is untouched
    expect((await event(r, st, 3, '2026-11-04')).statusCode).toBe(200)
    expect((await r.pg.query<{ date: string }>(`select date::text as date from update_event where client_uuid = $1`, [uuidN(1003)])).rows).toEqual([{ date: '2026-11-04' }])
  })

  it('N-10: demo mode, a photo dated after the pinned day is accepted and stored on the pinned day', async () => {
    const r = await rig('demo')
    const st = await firstStage(r)
    expect((await photo(r, st, 1, '2026-11-07')).statusCode).toBe(200)
    expect((await r.pg.query<{ d: string }>(`select taken_on::text as d from photo`)).rows).toEqual([{ d: DEMO_TODAY }])
  })

  it('N-10: demo mode off, a future date is still refused', async () => {
    const r = await rig('normal')
    const st = await firstStage(r)
    const res = await event(r, st, 1, '2026-11-07')
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/future/)
    expect((await photo(r, st, 1, '2026-11-07')).statusCode).toBe(400)
  })
})

// ---- the seed: N-3, N-9, S-7

const sys = (pg: PGlite) => <T>(fn: (tx: Tx) => Promise<T>) => pgliteDb(pg).tx({ role: 'system' }, fn)

describe('N-3: the seeded notes and warnings come back for the next reviewer', () => {
  async function confirmEverything(r: Rig) {
    const rev = (await r.app.inject({ method: 'GET', url: '/api/review', headers: r.as(r.merch) })).json()
    for (const n of rev.notes as { id: string }[]) {
      expect((await post(r, r.merch, `/api/notes/${n.id}/confirm`, { textEn: 'Machine broken', category: 'machine' })).statusCode).toBe(200)
    }
    for (const w of rev.needsReview as { id: string; status: string; buyerText: string }[]) {
      expect((await post(r, r.merch, `/api/warnings/${w.id}/confirm`, { seenStatus: w.status, seenText: w.buyerText })).statusCode).toBe(200)
    }
    return rev
  }

  it('N-3: after every note is confirmed, the top-up shows the 4 Tamil and 2 English notes again with no AI answer', async () => {
    const r = await rig('normal')
    const first = await confirmEverything(r)
    expect(first.notes).toHaveLength(6)
    await r.pg.query(`update note set ai_status = 'suggested', ai_text_en = 'x', ai_category = 'machine', ai_why = 'y', ai_model = 'm', ai_attempts = 2, ai_at = now() where confirmed_by is not null`)
    const after = (await r.app.inject({ method: 'GET', url: '/api/review', headers: r.as(r.merch) })).json()
    expect(after.notes).toHaveLength(0)
    await sys(r.pg)((tx) => topUpDemo(tx))
    const back = (await r.app.inject({ method: 'GET', url: '/api/review', headers: r.as(r.merch) })).json()
    expect(back.notes).toHaveLength(6)
    expect(back.notes.filter((n: { language: string }) => n.language === 'ta')).toHaveLength(4)
    expect(back.notes.filter((n: { language: string }) => n.language === 'en')).toHaveLength(2)
    for (const n of back.notes) { expect(n.ai).toBeNull(); expect(n.category).toBeNull(); expect(n.categoryBy).toBeNull() }
    expect(back.notes.filter((n: { language: string; textEn: string | null }) => n.language === 'ta').every((n: { textEn: string | null }) => n.textEn === null)).toBe(true)
    // the warnings are waiting for a person again too
    expect(back.needsReview.length).toBe(first.needsReview.length)
    expect(back.confirmed).toHaveLength(0)
    // nothing was lost: every note still sits on its update
    expect((await r.pg.query<{ n: number }>(`select count(*)::int as n from update_event where note_id is not null`)).rows[0]!.n).toBe(6)
  })

  it('N-3: a note nobody has reviewed keeps the AI answer it already has (the top-up does not waste a call)', async () => {
    const r = await rig('normal')
    await r.pg.query(`update note set ai_status = 'suggested', ai_category = 'machine', ai_attempts = 1 where id = (select id from note limit 1)`)
    await sys(r.pg)((tx) => topUpDemo(tx))
    expect((await r.pg.query<{ n: number }>(`select count(*)::int as n from note where ai_status = 'suggested'`)).rows[0]!.n).toBe(1)
  })

  it('N-3: demo mode tops up once per real day, on the first review of that day, and not again the same day', async () => {
    const r = await rig('demo')
    const count = async () => {
      const res = await r.app.inject({ method: 'GET', url: '/api/review', headers: r.as(r.merch) })
      expect(res.statusCode, res.body).toBe(200)
      return (res.json().notes as unknown[]).length
    }
    expect(await count()).toBe(6)   // the first review of the day runs the top-up: nothing is reviewed yet, nothing changes
    await confirmEverything(r)
    expect(await count()).toBe(0)   // the same day: the work of the reviewers stays
    r.setNow(new Date('2026-11-10T06:00:00Z'))
    r.merch = (await r.app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_LOGINS.merchandiser })).json().token   // the 12-hour token of the day before has run out
    expect(await count()).toBe(6)   // the next day: back
    await confirmEverything(r)
    expect(await count()).toBe(0)
  })

  it('N-3: with demo mode off the review never resets anything', async () => {
    let now = new Date('2026-11-09T06:00:00Z')
    const r = await rig('normal', { clock: () => now })
    await confirmEverything(r)
    now = new Date('2026-11-10T06:00:00Z')
    r.merch = (await r.app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_LOGINS.merchandiser })).json().token
    const res = await r.app.inject({ method: 'GET', url: '/api/review', headers: r.as(r.merch) })
    expect(res.statusCode).toBe(200)
    expect(res.json().notes).toHaveLength(0)
  })

  it('N-3: photos nobody approved that are over a day old are cleaned up by the top-up, approved ones stay', async () => {
    const r = await rig('normal')
    const st = await firstStage(r)
    for (let i = 1; i <= 2; i++) expect((await photo(r, st, i)).statusCode).toBe(200)
    const ids = (await r.pg.query<{ id: string }>('select id::text as id from photo order by client_uuid')).rows.map((x) => x.id)
    expect((await post(r, r.merch, `/api/photos/${ids[0]}/approve`)).statusCode).toBe(200)
    await r.pg.query(`update photo set created_at = now() - interval '2 days'`)
    await r.pg.query(`insert into media_object (key, bytes) select storage_key, '\\x01'::bytea from photo`)
    await sys(r.pg)((tx) => topUpDemo(tx))
    const rows = (await r.pg.query<{ id: string; purged: boolean }>('select id::text as id, purged_at is not null as purged from photo order by client_uuid')).rows
    expect(rows.map((x) => x.purged)).toEqual([false, true])
    expect((await r.pg.query<{ n: number }>('select count(*)::int as n from media_object')).rows[0]!.n).toBe(1)
  })
})

describe('S-7: the demo seed is safe to run twice at once, and again on every deploy', () => {
  it('S-7: the check and the insert sit behind an advisory lock taken first', async () => {
    const seen: string[] = []
    const tx: Tx = { query: async (sql) => { seen.push(sql); if (/from orders/.test(sql)) throw new Error('stop here'); return [] as never } }
    await expect(ensureDemo(tx, DEMO_TODAY, REAL_NOW)).rejects.toThrow('stop here')
    expect(seen[0]).toMatch(/pg_advisory_xact_lock/)
  })

  it('S-7: two deploys at the same moment on an empty database load the demo once and neither fails', async () => {
    const pg = await migratedDb()
    const results = await Promise.all([sys(pg)((tx) => ensureDemo(tx, DEMO_TODAY, REAL_NOW)), sys(pg)((tx) => ensureDemo(tx, DEMO_TODAY, REAL_NOW))])
    expect(results.map((x) => x.action).sort()).toEqual(['refreshed', 'seeded'])
    expect((await pg.query<{ n: number }>('select count(*)::int as n from orders')).rows[0]!.n).toBe(7)
    expect((await pg.query<{ n: number }>(`select count(*)::int as n from account where label is not null`)).rows[0]!.n).toBe(4)
    await pg.close()
  })

  it('S-7: a database that holds other orders is left alone: no demo account is added to it', async () => {
    const pg = await migratedDb()
    await pg.query(`insert into buyer (id, name) values ('00000000-0000-0000-0000-0000000000b1', 'Real buyer')`)
    await pg.query(`insert into orders (buyer_id, po, style, colour, qty, ex_factory) values ('00000000-0000-0000-0000-0000000000b1', 'X-1', 't', 'c', 10, '2026-12-01')`)
    const r = await sys(pg)((tx) => ensureDemo(tx, DEMO_TODAY, REAL_NOW))
    expect(r.action).toBe('skipped')
    expect((await pg.query<{ n: number }>('select count(*)::int as n from account')).rows[0]!.n).toBe(0)
    await pg.close()
  })
})

describe('R-22: npm run dev:api reads PORT and says plainly when the port is taken', () => {
  it('R-22: a port that is already in use gives one plain sentence naming the port and the PORT variable', async () => {
    const holder = net.createServer()
    await new Promise<void>((res) => holder.listen(0, '127.0.0.1', res))
    const port = (holder.address() as net.AddressInfo).port
    try {
      const err = await startDemoApi({ port }).then(() => null, (e: Error) => e)
      expect(err).toBeInstanceOf(Error)
      expect(err!.message).toContain(String(port))
      expect(err!.message).toContain('PORT')
      expect(err!.message).not.toContain('\n')
      expect(err!.stack ?? '').not.toContain('EADDRINUSE')
    } finally { await new Promise((res) => holder.close(res)) }
  })

  it('R-22: a free port still starts the demo', async () => {
    const probe = net.createServer()
    await new Promise<void>((res) => probe.listen(0, '127.0.0.1', res))
    const port = (probe.address() as net.AddressInfo).port
    await new Promise((res) => probe.close(res))
    const demo = await startDemoApi({ port })
    expect(demo.port).toBe(port)
    await demo.close()
  })
})
