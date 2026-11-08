// The scoped refresh must leave the database in exactly the state a full refresh after every write would.
// Random, seeded sequences of writes go to two identical databases through the real routes: A uses the new logic (scoped writes,
// a full refresh once per factory day and after a failure, the queue re-checked on read); B is forced to refresh everything
// after every change (warningFullRefreshMs: 0). After EVERY step the whole warning table, the alerts, the review lists and what each
// buyer can read are compared. A failure prints the seed and the steps so far; set REFRESH_SEED=<n> to replay one sequence.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { buildApp, type Db } from '../src/index.js'
import { istDate } from '../src/today.js'
import { addDay, bulkSeed, buyerVisible, outboxTable, pad, rng, warningTable } from './refreshHarness.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed, TEMPLATE_ID } from './helpers.js'

const SEQUENCES = 30
const STEPS = 12
const START = new Date('2026-11-04T04:30:00Z')
const BASE_SEED = 20261104
const only = process.env.REFRESH_SEED ? [Number(process.env.REFRESH_SEED)] : Array.from({ length: SEQUENCES }, (_, i) => BASE_SEED + i)

let pgA: PGlite, pgB: PGlite
let dbA: Db, dbB: Db
beforeAll(async () => { pgA = await migratedDb(); pgB = await migratedDb(); dbA = pgliteDb(pgA); dbB = pgliteDb(pgB) })
afterAll(async () => { await pgA.close(); await pgB.close() })

type Side = { pg: PGlite; db: Db; app: FastifyInstance; auth: Record<string, string> }

async function side(pg: PGlite, db: Db, fullEveryMs: number | undefined, clock: () => Date): Promise<Side> {
  const app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock, warningFullRefreshMs: fullEveryMs })
  const token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token
  return { pg, db, app, auth: { authorization: `Bearer ${token}` } }
}

describe('scoped refresh == full refresh after every write', () => {
  it.each(only)('sequence with seed %i', async (seed) => {
    const r = rng(seed)
    let now = new Date(START)
    const clock = () => now
    const today = istDate(START)
    for (const pg of [pgA, pgB]) { await resetAndSeed(pg); await bulkSeed(pg, seed, 10, today) }
    const A = await side(pgA, dbA, undefined, clock)   // the new logic
    const B = await side(pgB, dbB, 0, clock)           // the oracle: everything, every time
    const done: string[] = []
    let ev = 0, orderNo = 0
    const poOf = async (): Promise<{ po: string; stage: string }> => {
      const rows = (await pgA.query<{ po: string; stage: string }>(`select o.po, m.stage from milestone m join orders o on o.id = m.order_id order by o.po, m.sequence`)).rows
      return r.pick(rows)
    }
    const idOf = async (pg: PGlite, po: string) => (await pg.query<{ id: string }>(`select id::text as id from orders where po = $1`, [po])).rows[0]!.id
    const both = async (fn: (s: Side) => Promise<{ status: number; body?: unknown }>) => {
      const a = await fn(A), b = await fn(B)
      expect(a.status, `status differs: A ${a.status} B ${b.status}`).toBe(b.status)
      return a
    }
    const call = async (s: Side, method: 'GET' | 'POST', url: string, payload?: object) => {
      const res = await s.app.inject({ method, url, headers: s.auth, ...(payload ? { payload } : {}) })
      return { status: res.statusCode, body: res.json() as unknown }
    }

    for (let step = 1; step <= STEPS; step++) {
      const kind = r.pick(['event', 'event', 'event', 'exfactory', 'calendar', 'clear', 'order', 'clock', 'review', 'confirm', 'dismiss', 'batch'] as const)
      let label: string = kind
      if (kind === 'event') {
        const { po, stage } = await poOf()
        const day = istDate(now)
        const date = addDay(day, -r.int(0, 3)), qty = r.int(0, 1800), id = `00000000-0000-4000-c000-${pad(++ev)}`
        label = `event ${po}/${stage} ${date} qty ${qty}`
        await both((s) => idOf(s.pg, po).then((orderId) => call(s, 'POST', '/api/events', { clientUuid: id, orderId, stage, date, qty })))
        if (r.next() < 0.2) await both((s) => idOf(s.pg, po).then((orderId) => call(s, 'POST', '/api/events', { clientUuid: id, orderId, stage, date, qty })))   // a retry: a duplicate
      } else if (kind === 'batch') {
        const items = Array.from({ length: r.int(1, 4) }, () => ({ clientUuid: `00000000-0000-4000-c000-${pad(++ev)}`, qty: r.int(0, 1500), date: addDay(istDate(now), -r.int(0, 2)) }))
        const targets = await Promise.all(items.map(() => poOf()))
        label = `batch ${targets.map((t) => `${t.po}/${t.stage}`).join(',')}`
        await both(async (s) => call(s, 'POST', '/api/events/batch', { events: await Promise.all(items.map(async (it, i) => ({ ...it, orderId: await idOf(s.pg, targets[i]!.po), stage: targets[i]!.stage }))) }))
      } else if (kind === 'exfactory') {
        const { po } = await poOf()
        const exFactory = addDay(istDate(now), r.int(2, 45))
        label = `ex-factory ${po} -> ${exFactory}`
        await both((s) => idOf(s.pg, po).then((id) => call(s, 'POST', `/api/orders/${id}/ex-factory`, { exFactory, reason: 'buyer asked' })))
      } else if (kind === 'calendar' || kind === 'clear') {
        const unitId = r.pick([ID.unit1, ID.unit2]), date = addDay(istDate(now), r.int(0, 25))
        const working = r.next() < 0.3
        label = `${kind} ${unitId.slice(-2)} ${date}${kind === 'calendar' ? (working ? ' worked' : ' closed') : ''}`
        await both((s) => kind === 'calendar'
          ? call(s, 'POST', '/api/calendar', { unitId, date, working })
          : call(s, 'POST', '/api/calendar/clear', { unitId, date }))
      } else if (kind === 'order') {
        const po = `NEW-${pad(++orderNo, 3)}`, exFactory = addDay(istDate(now), r.int(6, 40)), qty = r.int(5, 50) * 100, buyerId = r.pick([ID.buyerB, ID.buyerC])
        label = `order ${po} ex ${exFactory} qty ${qty}`
        await both((s) => call(s, 'POST', '/api/orders', { buyerId, po, style: 's', colour: 'c', sizes: { M: qty }, exFactory, templateId: TEMPLATE_ID }))
      } else if (kind === 'clock') {
        const hours = r.pick([3, 9, 20, 26, 40])
        now = new Date(now.getTime() + hours * 3_600_000)
        label = `clock +${hours}h -> ${istDate(now)}`
        // The token carries the clock too: sign in again on both sides.
        for (const s of [A, B]) {
          const token = (await s.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token
          s.auth = { authorization: `Bearer ${token}` }
        }
      } else if (kind === 'review') {
        const a = await call(A, 'GET', '/api/review'), b = await call(B, 'GET', '/api/review')
        const strip = (x: { body: any }) => ({ n: x.body.needsReview?.map((w: any) => `${w.po}/${w.stage}/${w.status}/${w.buyerText}/${w.maths}`).sort(), c: x.body.confirmed?.map((w: any) => `${w.po}/${w.stage}/${w.status}/${w.buyerText}`).sort() })
        expect(strip(a), 'review list').toEqual(strip(b))
      } else {
        // confirm or dismiss a warning picked from A's queue; the same po/stage on B
        const q = (await call(A, 'GET', '/api/review')).body as { needsReview: { id: string; po: string; stage: string; buyerText: string; status: string }[] }
        await call(B, 'GET', '/api/review')
        if (q.needsReview.length) {
          const w = r.pick(q.needsReview)
          label = `${kind} ${w.po}/${w.stage}`
          await both(async (s) => {
            const id = (await s.pg.query<{ id: string }>(`select w.id::text as id from warning w join orders o on o.id = w.order_id where o.po = $1 and w.stage = $2 and w.resolved_at is null`, [w.po, w.stage])).rows[0]?.id
            return id ? call(s, 'POST', `/api/warnings/${id}/${kind}`, kind === 'confirm' ? { seenStatus: w.status, seenText: w.buyerText } : {}) : { status: 0 }
          })
        } else label = `${kind} (nothing waiting)`
      }
      done.push(`${step}: ${label}`)
      const ctx = `seed ${seed} (REFRESH_SEED=${seed}); steps so far:\n  ${done.join('\n  ')}`
      expect(await warningTable(pgA), `warning table\n${ctx}`).toEqual(await warningTable(pgB))
      expect(await outboxTable(pgA), `alerts\n${ctx}`).toEqual(await outboxTable(pgB))
      for (const buyer of [ID.buyerB, ID.buyerC]) expect(await buyerVisible(dbA, buyer), `buyer-visible\n${ctx}`).toEqual(await buyerVisible(dbB, buyer))
      // the review lists as the merchandiser's screen would show them, without letting the read itself refresh (it would hide a difference)
      const lists = async (db: Db) => db.tx({ role: 'merchandiser' }, (tx) => tx.query<{ k: string }>(
        `select o.po || '/' || w.stage || '/' || w.status || '/' || w.buyer_text || '/' || (w.confirmed_by is not null)::text as k
           from warning w join orders o on o.id = w.order_id where w.resolved_at is null and w.dismissed_at is null order by 1`))
      expect(await lists(dbA), `lists\n${ctx}`).toEqual(await lists(dbB))
    }
    // a final sweep: opening the queue brings both to the same state, and neither has anything left to do
    const a = await call(A, 'GET', '/api/review'), b = await call(B, 'GET', '/api/review')
    expect(a.status).toBe(200); expect(b.status).toBe(200)
    expect(await warningTable(pgA), `final warning table, seed ${seed}`).toEqual(await warningTable(pgB))
  }, 120_000)

  it('the generated sequences really exercise warnings (not a vacuous comparison)', async () => {
    await resetAndSeed(pgA); await bulkSeed(pgA, BASE_SEED, 10, istDate(START))
    const A = await side(pgA, dbA, undefined, () => START)
    await A.app.inject({ url: '/api/review', headers: A.auth })
    expect((await warningTable(pgA)).length).toBeGreaterThan(5)
  })
})
