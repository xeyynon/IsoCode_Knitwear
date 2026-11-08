// ORACLE: the per-row refreshWarnings exactly as committed at HEAD before the optimisation (O-2, O-3), copied from
// `git show HEAD:packages/server/src/warningService.ts`. Only the import paths and the function name are changed.
// The equivalence tests run it beside the new code and compare the tables. Do not "improve" it.
import { addDays, compareDates } from '@isocode/engine/dates'
import { formatMaths, projectOrder } from '@isocode/engine'
import { forbidden } from '../src/errors.js'
import { isStaff, type Ctx, type Tx } from '../src/db.js'
import { loadEngineData } from '../src/engineData.js'
import { MERCHANDISERS_LABEL, writeOutbox } from '../src/outboxService.js'
import { buyerText } from '../src/warningService.js'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Mocked alert to the merchandisers: a stage has just turned red. Internal, so it may carry the sum. */
const alertRed = (tx: Tx, orderId: string, po: string, stage: string, maths: string) =>
  writeOutbox(tx, { channel: 'whatsapp', recipientKind: 'merchandiser', recipient: MERCHANDISERS_LABEL, subject: `PO ${po}: ${stage} is red`, body: `${cap(stage)} for PO ${po} has turned red. ${maths}`, orderId })

interface RefreshResult { created: number; updated: number; resolved: number }

/**
 * Bring the warnings in line with what the engine says now. A warning exists for each stage that
 * is amber or red and due within the warning window. It is created UNCONFIRMED, so nothing
 * reaches a buyer until a merchandiser confirms it. If the colour or the planned date changes the
 * wording changes, so it needs confirming again. When a stage recovers its warning is resolved.
 */
export async function refreshWarningsOld(tx: Tx, ctx: Ctx, today: string): Promise<RefreshResult> {
  if (!isStaff(ctx)) throw forbidden()
  const { orders, stagesBy, eventsBy, calendars, settings } = await loadEngineData(tx)
  const open = await tx.query<{ id: string; order_id: string; stage: string; status: 'amber' | 'red'; dismissed: boolean; planned_end: string | null }>(
    `select id::text as id, order_id::text as order_id, stage, status, dismissed_at is not null as dismissed,
            maths->>'plannedEnd' as planned_end
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
        // A refresh running at the same moment (another merchandiser, a batch sync) may have just raised it: keep theirs.
        const made = await tx.query(
          `insert into warning (order_id, buyer_id, stage, status, maths, buyer_text) values ($1, $2, $3, $4, $5::jsonb, $6)
           on conflict (order_id, stage) where resolved_at is null do nothing returning id`,
          [o.id, o.buyerId, r.stage, status, maths, text])
        if (made.length) { out.created++; if (status === 'red') await alertRed(tx, o.id, o.po, r.stage, formatMaths(r, st.milestone)) }
      } else if (have.status !== status) {
        // The colour changed: new wording, and a human must look at it again. A dismissal does not carry over.
        await tx.query(
          `update warning set status = $2, maths = $3::jsonb, buyer_text = $4, confirmed_by = null, confirmed_at = null, dismissed_at = null, dismissed_was_confirmed = null where id = $1`,
          [have.id, status, maths, text])
        out.updated++
        if (status === 'red') await alertRed(tx, o.id, o.po, r.stage, formatMaths(r, st.milestone))
      } else if (!have.dismissed && have.planned_end !== null && have.planned_end !== st.milestone) {
        // Same colour, but the planned date the wording names has moved: new wording, and a human must look again.
        await tx.query(
          `update warning set maths = $2::jsonb, buyer_text = $3, confirmed_by = null, confirmed_at = null where id = $1`,
          [have.id, maths, text])
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
