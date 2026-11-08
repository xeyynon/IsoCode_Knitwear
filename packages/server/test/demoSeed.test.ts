import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { PGlite } from '@electric-sql/pglite'
import { buildApp } from '../src/app'
import { BRIEF_SAMPLE, DEMO_BUYER_TOKENS, DEMO_LOGINS, DEMO_TODAY, seedDemo } from '../src/demoSeed'
import { migratedDb, pgliteDb } from './helpers'

// The demo seed must keep saying what the brief says, and must load cleanly through the same row-level security as the app.
describe('demo seed from the brief', () => {
  let pg: PGlite, app: FastifyInstance, token: string
  beforeAll(async () => {
    pg = await migratedDb()
    await pgliteDb(pg).tx({ role: 'system' }, (tx) => seedDemo(tx, DEMO_TODAY))
    app = buildApp({ db: pgliteDb(pg), tokenSecret: 'x'.repeat(40), clock: () => new Date(`${DEMO_TODAY}T04:30:00Z`), logger: false })
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_LOGINS.merchandiser })
    token = res.json().token
  })
  afterAll(async () => { await app.close(); await pg.close() })

  it("holds the brief's three POs with their buyer, style, colour, quantity, ex-factory date and qty done in the named stage", async () => {
    for (const s of BRIEF_SAMPLE) {
      const o = (await pg.query<{ id: string; style: string; colour: string; qty: number; ex: string; buyer: string; country: string }>(
        `select o.id::text as id, o.style, o.colour, o.qty, o.ex_factory::text as ex, b.name as buyer, b.country from orders o join buyer b on b.id = o.buyer_id where o.po = $1`, [s.po])).rows
      expect(o).toHaveLength(1)
      expect(o[0]).toMatchObject({ style: s.style, colour: s.colour, qty: s.qty, ex: s.exFactory, buyer: s.buyer, country: s.country })
      const done = (await pg.query<{ n: number }>(`select coalesce(sum(qty), 0)::int as n from update_event where order_id = $1 and stage = $2`, [o[0]!.id, s.stage])).rows[0]!.n
      expect(done).toBe(s.done)
    }
  })

  it('every note in the seed is written, in Tamil and English, and none is reviewed yet', async () => {
    const r = (await pg.query<{ language: string; n: number }>(`select language, count(*)::int as n from note where confirmed_by is null group by language order by language`)).rows
    expect(r).toEqual([{ language: 'en', n: 2 }, { language: 'ta', n: 4 }])
  })

  it('refuses to load twice', async () => {
    await expect(pgliteDb(pg).tx({ role: 'system' }, (tx) => seedDemo(tx))).rejects.toThrow(/already has orders/)
  })

  it('gives every colour on the board, and the sample POs read as the story says', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/board', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows as { po: string; status: string; worstStage: string | null; maths: string | null }[]
    const by = Object.fromEntries(rows.map((r) => [r.po, r.status]))
    console.log(rows.map((r) => [r.po, r.status, r.worstStage, r.maths].join(' | ')).join('\n'))
    expect(by['B-PO-88240']).toBe('red')
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['red', 'amber', 'green', 'grey']))
  })

  it('every demo account signs in, and each buyer link opens only its own buyer', async () => {
    for (const s of DEMO_LOGINS.supervisors) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: s.phone, pin: s.pin } })
      expect(r.statusCode).toBe(200)
    }
    const b = await app.inject({ method: 'GET', url: '/api/buyer/orders', headers: { authorization: `Bearer ${DEMO_BUYER_TOKENS.companyB}` } })
    expect(b.statusCode).toBe(200)
    const pos = JSON.stringify(b.json())
    expect(pos).toContain('B-PO-88240')
    expect(pos).not.toContain('C-PO-')
  })
})

// The evaluator panel on the sign-in screen must show logins that work against this seed.
describe('the evaluator panel and the demo seed agree', () => {
  it('lists the same accounts and buyer links', async () => {
    const { DEMO_ACCESS, DEMO_BUYER_LINKS } = await import('../../web/src/demo/demoAccess')
    expect(DEMO_ACCESS.merchandiser.map((l) => [l.id, l.secret])).toEqual([[DEMO_LOGINS.merchandiser.email, DEMO_LOGINS.merchandiser.password]])
    expect(DEMO_ACCESS.supervisor.map((l) => [l.id, l.secret])).toEqual(DEMO_LOGINS.supervisors.map((s) => [s.phone, s.pin]))
    expect(DEMO_BUYER_LINKS.map((b) => b.token)).toEqual([DEMO_BUYER_TOKENS.companyB, DEMO_BUYER_TOKENS.companyC])
  })
})
