import { addDays, compareDates } from '@isocode/engine/dates'
import { formatDay, formatMaths, projectOrder } from '@isocode/engine'
import { badRequest, forbidden, notFound, AppError } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'
import { loadEngineData } from './engineData.js'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_BUYER_TEXT = 300

/**
 * What a buyer would be told. Deliberately free of internal figures (daily rates, shortfalls):
 * those are for the factory. A merchandiser can reword it before confirming.
 */
export function buyerText(stage: string, status: 'amber' | 'red', plannedEnd: string): string {
  return status === 'red'
    ? `${cap(stage)} is at risk of finishing late (planned for ${formatDay(plannedEnd)}).`
    : `${cap(stage)} needs attention to finish on time (planned for ${formatDay(plannedEnd)}).`
}

export interface RefreshResult { created: number; updated: number; resolved: number }

/**
 * Bring the warnings in line with what the engine says now. A warning exists for each stage that
 * is amber or red and due within the warning window. It is created UNCONFIRMED, so nothing
 * reaches a buyer until a merchandiser confirms it. If the colour changes the wording changes,
 * so it needs confirming again. When a stage recovers its warning is resolved.
 */
export async function refreshWarnings(tx: Tx, ctx: Ctx, today: string): Promise<RefreshResult> {
  if (!isStaff(ctx)) throw forbidden()
  const { orders, stagesBy, eventsBy, calendars, settings } = await loadEngineData(tx)
  const open = await tx.query<{ id: string; order_id: string; stage: string; status: 'amber' | 'red'; dismissed: boolean }>(
    `select id::text as id, order_id::text as order_id, stage, status, dismissed_at is not null as dismissed
       from warning where resolved_at is null`)
  const byKey = new Map(open.map((w) => [`${w.order_id}/${w.stage}`, w]))
  const wanted = new Set<string>()
  const out: RefreshResult = { created: 0, updated: 0, resolved: 0 }
  const horizon = addDays(today, settings.warnWithinDays)

  for (const o of orders) {
    const stages = stagesBy.get(o.id) ?? []
    const result = projectOrder({ id: o.id, exFactory: o.exFactory }, stages, eventsBy.get(o.id) ?? [], calendars, today, settings)
    for (const r of result.stages) {
      const st = stages.find((s) => s.stage === r.stage)!
      if (r.complete || (r.status !== 'amber' && r.status !== 'red') || compareDates(st.milestone, horizon) > 0) continue
      const key = `${o.id}/${r.stage}`
      wanted.add(key)
      const status = r.status
      const maths = JSON.stringify({
        text: formatMaths(r, st.milestone), needed: r.needed, made: r.made, shortBy: r.shortBy, plannedEnd: st.milestone,
        projectedEnd: r.projectedEnd, madeIsEstimate: r.madeIsEstimate, reasons: r.reasons,
      })
      const text = buyerText(r.stage, status, st.milestone)
      const have = byKey.get(key)
      if (!have) {
        await tx.query(
          `insert into warning (order_id, buyer_id, stage, status, maths, buyer_text) values ($1, $2, $3, $4, $5::jsonb, $6)`,
          [o.id, o.buyerId, r.stage, status, maths, text])
        out.created++
      } else if (have.status !== status) {
        // The colour changed: new wording, and a human must look at it again. A dismissal does not carry over.
        await tx.query(
          `update warning set status = $2, maths = $3::jsonb, buyer_text = $4, confirmed_by = null, confirmed_at = null, dismissed_at = null where id = $1`,
          [have.id, status, maths, text])
        out.updated++
      } else if (!have.dismissed) {
        // Same colour: keep the (possibly reworded, possibly confirmed) text, refresh the figures behind it.
        await tx.query('update warning set maths = $2::jsonb where id = $1', [have.id, maths])
      }
    }
  }
  for (const [key, w] of byKey) {
    if (wanted.has(key)) continue
    await tx.query('update warning set resolved_at = now() where id = $1', [w.id])
    out.resolved++
  }
  return out
}

export interface ReviewItem {
  id: string
  orderId: string
  po: string
  buyerName: string
  stage: string
  status: 'amber' | 'red'
  /** What the buyer would see (editable before confirming). */
  buyerText: string
  /** The sum behind it, internal only. */
  maths: string
  state: 'needs_review' | 'confirmed'
  createdAt: string
}

/** Warnings waiting for a decision, and those currently visible to buyers. Dismissed and resolved ones are not listed. */
export async function listReview(tx: Tx, ctx: Ctx): Promise<{ needsReview: ReviewItem[]; confirmed: ReviewItem[] }> {
  if (!isStaff(ctx)) throw forbidden('The review queue is for merchandisers')
  const rows = await tx.query<{
    id: string; order_id: string; po: string; buyer_name: string; stage: string; status: 'amber' | 'red'; buyer_text: string
    maths: { text?: string } | null; confirmed: boolean; created_at: string
  }>(
    `select w.id::text as id, w.order_id::text as order_id, o.po, b.name as buyer_name, w.stage, w.status, w.buyer_text, w.maths,
            w.confirmed_by is not null as confirmed,
            to_char(w.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
       from warning w join orders o on o.id = w.order_id join buyer b on b.id = w.buyer_id
      where w.resolved_at is null and w.dismissed_at is null
      order by (w.status = 'red') desc, w.created_at, w.id`)
  const items: ReviewItem[] = rows.map((r) => ({
    id: r.id, orderId: r.order_id, po: r.po, buyerName: r.buyer_name, stage: r.stage, status: r.status,
    buyerText: r.buyer_text, maths: r.maths?.text ?? '', state: r.confirmed ? 'confirmed' : 'needs_review', createdAt: r.created_at,
  }))
  return { needsReview: items.filter((i) => i.state === 'needs_review'), confirmed: items.filter((i) => i.state === 'confirmed') }
}

/** Approve a warning for buyers, optionally rewording it first. */
export async function confirmWarning(tx: Tx, ctx: Ctx, userId: string, id: string, text?: string): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  if (!UUID.test(String(id)) || !UUID.test(String(userId))) throw badRequest('Invalid request')
  let reworded: string | null = null
  if (text !== undefined) {
    if (typeof text !== 'string' || !text.trim()) throw badRequest('The wording for the buyer cannot be empty')
    if (text.trim().length > MAX_BUYER_TEXT) throw badRequest(`Keep the wording under ${MAX_BUYER_TEXT} characters`)
    reworded = text.trim()
  }
  const done = await tx.query(
    `update warning set confirmed_by = $2, confirmed_at = now(), buyer_text = coalesce($3, buyer_text)
      where id = $1 and resolved_at is null and dismissed_at is null returning id`, [id, userId, reworded])
  if (!done.length) {
    const exists = await tx.query('select 1 from warning where id = $1', [id])
    throw exists.length ? new AppError(409, 'not_open', 'This warning is no longer open') : notFound('No such warning')
  }
}

/** Hide a warning from buyers for good (until the colour changes). Works on pending and confirmed ones. */
export async function dismissWarning(tx: Tx, ctx: Ctx, id: string): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  if (!UUID.test(String(id))) throw badRequest('Invalid request')
  const done = await tx.query(
    `update warning set dismissed_at = now(), confirmed_by = null, confirmed_at = null where id = $1 and resolved_at is null and dismissed_at is null returning id`, [id])
  if (!done.length) {
    const exists = await tx.query('select 1 from warning where id = $1', [id])
    throw exists.length ? new AppError(409, 'not_open', 'This warning is no longer open') : notFound('No such warning')
  }
}
