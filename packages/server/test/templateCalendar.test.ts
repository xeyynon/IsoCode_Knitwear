// BUG-018: a template that Setup accepts must never be refused at order setup because of closed days.
// The rule (DEC-023): "a saved template can never be one order setup would refuse".
//   1. Today it holds because the engine decides a template's faults from its offsets alone; closed days only move dates
//      (a later stage is held to the earlier stage's date). The first describe proves that, including after closed days change.
//   2. If an engine change ever let closed days refuse a saved template again, order setup must say plainly which template,
//      stage and closed day did it, instead of a bare engine sentence. The second describe simulates that engine.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { FastifyInstance } from 'fastify'
import { workingDaysBack } from '@isocode/engine/dates'
import { buildApp, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// An engine that can be switched to the OLD rule (a closed day that puts a later stage before an earlier one is a template fault).
const engine = vi.hoisted(() => ({ legacyClashIsAFault: false }))
vi.mock('@isocode/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@isocode/engine')>()
  const dates = await import('@isocode/engine/dates')
  return {
    ...real,
    backSchedule: (...args: Parameters<typeof real.backSchedule>) => {
      const [ex, steps, cals, today] = args
      const s = real.backSchedule(ex, steps, cals, today)
      if (!engine.legacyClashIsAFault) return s
      const ordered = [...steps].sort((a, b) => a.sequence - b.sequence)
      const raw = ordered.map((st) => dates.workingDaysBack(cals[st.unitId], ex, Math.max(0, st.workingDaysBefore)))
      for (let i = 1; i < raw.length; i++) {
        if (raw[i]! < raw[i - 1]!) s.problems.push(`"${ordered[i]!.stage}" would finish (${raw[i]}) before "${ordered[i - 1]!.stage}" (${raw[i - 1]}); check the template offsets`)
      }
      return s
    },
  }
})

const SECRET = 'x'.repeat(40)
const NOW = new Date('2026-11-04T04:30:00Z')
let pg: PGlite
let db: Db
let app: FastifyInstance
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { engine.legacyClashIsAFault = false; await resetAndSeed(pg); app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW }) })
afterAll(async () => { await pg.close() })

const merch = async () => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token}` })
const post = async (url: string, payload: unknown) => app.inject({ method: 'POST', url, headers: await merch(), payload: payload as object })
const closeDay = (unitId: string, date: string, note = 'closed') => pg.query(`insert into calendar_day (unit_id, date, working, note) values ($1, $2, false, $3) on conflict (unit_id, date) do update set working = false`, [unitId, date, note])
const saveTwoUnitTemplate = async (name = 'Two units') => {
  const res = await post('/api/templates', { name, stages: [
    { stage: 'knitting', workingDaysBefore: 6, unitId: ID.unit1 },
    { stage: 'linking', workingDaysBefore: 5, unitId: ID.unit2 },
  ] })
  expect(res.statusCode, res.body).toBe(200)
  return res.json().id as string
}
const order = (templateId: string, over: object = {}) => ({ buyerId: ID.buyerB, po: 'CAL-1', style: 'polo', colour: 'white', sizes: { S: 100 }, exFactory: '2026-11-20', templateId, ...over })
// Unit 2 closed on 14 and 16 Nov puts "linking" (5 days back) on 12 Nov, before "knitting" (6 days back in unit 1: 13 Nov).
const clashingClosures = async () => { await closeDay(ID.unit2, '2026-11-14', 'festival'); await closeDay(ID.unit2, '2026-11-16', 'power cut') }

describe('a saved template is never refused at order setup for calendar reasons', () => {
  it('closed days that would put a later stage first only move the date: the order is created, in order', async () => {
    const templateId = await saveTwoUnitTemplate()
    await clashingClosures()
    const preview = (await post('/api/orders/preview', { templateId, exFactory: '2026-11-20' })).json()
    expect(preview.problems).toEqual([])
    const res = await post('/api/orders', order(templateId))
    expect(res.statusCode, res.body).toBe(201)
    const dates = Object.fromEntries(res.json().milestones.map((m: any) => [m.stage, m.plannedEnd]))
    expect(dates).toEqual({ knitting: '2026-11-13', linking: '2026-11-13' })   // linking held to knitting, never before it
  })

  it('closed days added AFTER the template was saved (and after orders were made) change nothing about whether it works', async () => {
    const templateId = await saveTwoUnitTemplate()
    expect((await post('/api/orders', order(templateId))).statusCode).toBe(201)
    await clashingClosures()
    expect((await post('/api/orders', order(templateId, { po: 'CAL-2' }))).statusCode).toBe(201)
    // moving ex-factory on an existing order goes through the same rule
    const id = (await pg.query<{ id: string }>(`select id from orders where po = 'CAL-1'`)).rows[0]!.id
    const moved = await post(`/api/orders/${id}/ex-factory`, { exFactory: '2026-11-27', reason: 'buyer moved it' })
    expect(moved.statusCode, moved.body).toBe(200)
    const { rows } = await pg.query<{ stage: string; planned_end: string }>(`select stage, planned_end::text as planned_end from milestone where order_id = $1 order by sequence`, [id])
    expect(rows[1]!.planned_end >= rows[0]!.planned_end).toBe(true)
  })

  it('whatever Setup accepts, preview and order setup accept, over many ex-factory dates and closed-day patterns', async () => {
    // A small fixed pseudo-random generator, so a failure can be repeated.
    let seed = 20261108
    const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n }
    let accepted = 0
    for (let round = 0; round < 6; round++) {
      await pg.exec('delete from calendar_day')
      for (const unit of [ID.unit1, ID.unit2]) for (let i = 0; i < 8; i++) await closeDay(unit, `2026-11-${String(2 + rnd(28)).padStart(2, '0')}`)
      const stages = Array.from({ length: 4 }, (_, i) => ({ stage: `s${i}`, workingDaysBefore: 12 - i * (1 + rnd(3)), unitId: rnd(2) ? ID.unit1 : ID.unit2 }))
        .filter((s, i, all) => i === 0 || s.workingDaysBefore <= all[i - 1]!.workingDaysBefore)
      const saved = await post('/api/templates', { name: `T${round}`, stages })
      if (saved.statusCode !== 200) continue                       // Setup refused it: nothing to prove
      for (let k = 0; k < 4; k++) {
        const exFactory = `2026-1${rnd(2)}-${String(10 + rnd(18)).padStart(2, '0')}`
        const preview = await post('/api/orders/preview', { templateId: saved.json().id, exFactory })
        expect(preview.json().problems, `${JSON.stringify(stages)} ${exFactory}`).toEqual([])
        const made = await post('/api/orders', order(saved.json().id, { po: `R${round}-${k}`, exFactory }))
        expect(made.statusCode, made.body).toBe(201)
        const ends = made.json().milestones.map((m: any) => m.plannedEnd) as string[]
        expect([...ends].sort()).toEqual(ends)                       // never a later stage before an earlier one
        accepted++
      }
    }
    expect(accepted).toBeGreaterThan(10)
  })

  it('a template whose OFFSETS are wrong is still refused at Setup and at order setup, with the same words', async () => {
    const bad = [{ stage: 'a', workingDaysBefore: 2, unitId: ID.unit1 }, { stage: 'b', workingDaysBefore: 8, unitId: ID.unit1 }]
    const saved = await post('/api/templates', { name: 'Bad', stages: bad })
    expect(saved.statusCode).toBe(400)
    expect(saved.json().error.message).toMatch(/"b" would finish .* before "a"/)
    await pg.query(`insert into tna_template (id, name, offsets) values ('00000000-0000-0000-0000-0000000000f9', 'Bad', $1::jsonb)`,
      [JSON.stringify(bad.map((s, i) => ({ stage: s.stage, sequence: i + 1, working_days_before: s.workingDaysBefore, unit_id: s.unitId })))])
    const res = await post('/api/orders', order('00000000-0000-0000-0000-0000000000f9'))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/Bad.*"b" would finish .* before "a"/)
  })
})

describe('if closed days ever did refuse a saved template, order setup names the template, the stage and the closed day', () => {
  it('says which template, which stage, which unit and which closed days (preview and create alike)', async () => {
    const templateId = await saveTwoUnitTemplate()
    await clashingClosures()
    engine.legacyClashIsAFault = true
    const message = /Two units.*"linking".*"knitting".*Unit 2.*2026-11-14.*2026-11-16/
    const res = await post('/api/orders', order(templateId))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(message)
    expect(res.json().error.message).not.toMatch(/check the template offsets/)   // the offsets are fine; do not send the person to fix the wrong thing
    const preview = (await post('/api/orders/preview', { templateId, exFactory: '2026-11-20' })).json()
    expect(preview.problems).toHaveLength(1)
    expect(preview.problems[0]).toMatch(message)
    // and no order was written
    expect((await pg.query(`select 1 from orders where po = 'CAL-1'`)).rows).toHaveLength(0)
  })

  it('does not blame the calendar when the offsets themselves are wrong', async () => {
    engine.legacyClashIsAFault = true
    await pg.query(`insert into tna_template (id, name, offsets) values ('00000000-0000-0000-0000-0000000000f8', 'Offsets', $1::jsonb)`,
      [JSON.stringify([{ stage: 'a', sequence: 1, working_days_before: 2, unit_id: ID.unit1 }, { stage: 'b', sequence: 2, working_days_before: 8, unit_id: ID.unit1 }])])
    const res = await post('/api/orders', order('00000000-0000-0000-0000-0000000000f8'))
    expect(res.json().error.message).toMatch(/check the template offsets/)
    expect(res.json().error.message).not.toMatch(/closed on/)
  })
})

describe('the calendar helper used by the test is the engine\'s own', () => {
  it('knitting lands on 13 Nov and linking on 12 Nov with unit 2 closed on 14 and 16 Nov', () => {
    expect(workingDaysBack({ days: {} }, '2026-11-20', 6)).toBe('2026-11-13')
    expect(workingDaysBack({ days: { '2026-11-14': false, '2026-11-16': false } }, '2026-11-20', 5)).toBe('2026-11-12')
  })
})
