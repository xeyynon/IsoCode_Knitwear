// Shared by refreshOpt.test.ts and refreshEquivalence.test.ts. Fake, made-up data only.
import type { PGlite } from '@electric-sql/pglite'
import type { Db, Tx } from '../src/db.js'
import { ID } from './helpers.js'

/** mulberry32: a small seeded generator, so a failing run can be replayed from the printed seed. */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
  }
}

export const addDay = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
export const pad = (n: number, w = 12): string => String(n).padStart(w, '0')

/**
 * `n` extra orders with three stages over the two seeded units and a few days of updates each, all ids fixed by position
 * (so two databases seeded with the same arguments are identical row for row). `today` is the factory date.
 */
export async function bulkSeed(pg: PGlite, seed: number, n: number, today: string): Promise<void> {
  const r = rng(seed)
  let ev = 0
  for (let i = 0; i < n; i++) {
    const id = `00000000-0000-0000-0000-${pad(100 + i)}`
    const buyer = i % 2 ? ID.buyerC : ID.buyerB
    const qty = r.int(20, 60) * 100
    const exf = addDay(today, r.int(4, 24))
    await pg.query(`insert into orders (id, buyer_id, po, style, colour, qty, ex_factory) values ($1, $2, $3, 's', 'c', $4, $5)`, [id, buyer, `BULK-${pad(i, 3)}`, qty, exf])
    const stages: [string, string, number, number][] = [['cutting', ID.unit1, 1, 9], ['sewing', ID.unit2, 2, 5], ['packing', ID.unit1, 3, 1]]
    for (const [stage, unit, seq, back] of stages) {
      await pg.query(
        `insert into milestone (order_id, buyer_id, stage, unit_id, planned_end, sequence, qty, working_days_before) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, buyer, stage, unit, addDay(exf, -back), seq, qty, back])
      if (seq === 3) continue
      for (let d = 1; d <= r.int(0, 5); d++) {
        await pg.query(
          `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty) values ($1, $2, $3, $4, $5, $6, $7)`,
          [`00000000-0000-4000-9000-${pad(++ev)}`, id, buyer, stage, unit, addDay(today, -d), r.int(0, 700)])
      }
    }
  }
}

/** Every warning row, in a form that is the same in two databases (no ids, no timestamps), as sorted canonical strings. */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
    : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v
export async function warningTable(pg: PGlite): Promise<string[]> {
  const rows = (await pg.query<Record<string, unknown>>(
    `select o.po, w.stage, w.status, w.buyer_text, w.maths, w.confirmed_by is not null as confirmed, w.confirmed_at is not null as confirmed_at_set,
            w.dismissed_at is not null as dismissed, w.dismissed_was_confirmed, w.resolved_at is not null as resolved
       from warning w join orders o on o.id = w.order_id`)).rows
  return rows.map((r) => JSON.stringify(canon(r))).sort()
}

/** The alerts that were written (kind, recipient, subject, body), as sorted strings. */
export async function outboxTable(pg: PGlite): Promise<string[]> {
  const rows = (await pg.query<Record<string, unknown>>(
    `select x.channel, x.recipient_kind, x.recipient, lower(x.subject) as subject, x.body, o.po from outbox x left join orders o on o.id = x.order_id`)).rows
  return rows.map((r) => JSON.stringify(canon(r))).sort()
}

/** What a buyer can read (row-level security as that buyer): the open, confirmed, un-dismissed warnings. */
export async function buyerVisible(db: Db, buyerId: string): Promise<string[]> {
  const rows = await db.tx({ role: 'buyer', buyerId }, (tx) => tx.query<Record<string, unknown>>(
    `select o.po, w.stage, w.status, w.buyer_text from warning w join orders o on o.id = w.order_id order by o.po, w.stage, w.buyer_text`))
  return rows.map((r) => JSON.stringify(canon(r)))
}

export interface Logged { sql: string; role: string }
/** Wraps a Db: records every statement with the role that ran it, and counts transactions per role. */
export function logging(inner: Db) {
  const log: Logged[] = []
  const tx = { system: 0, other: 0 }
  const db: Db = {
    tx: (ctx, fn) => {
      if (ctx.role === 'system') tx.system++; else tx.other++
      return inner.tx(ctx, (t: Tx) => fn({ query: (sql, params) => { log.push({ sql, role: ctx.role }); return t.query(sql, params) } }))
    },
  }
  return { db, log, tx, reset: () => { log.length = 0; tx.system = 0; tx.other = 0 } }
}

/** A statement of the warning refresh that reads every open warning (a full refresh reads all, a scoped one only its orders'). */
export const isOpenRead = (sql: string): boolean => sql.includes("maths->>'plannedEnd'")
export const isFullOpenRead = (sql: string): boolean => isOpenRead(sql) && !/order_id = any/.test(sql)
export const isWarningUpdate = (sql: string): boolean => /^\s*update warning/i.test(sql)
