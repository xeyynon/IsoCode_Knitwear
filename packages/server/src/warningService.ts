import { addDays, compareDates } from '@isocode/engine/dates'
import { formatDay, formatMaths, projectOrder } from '@isocode/engine'
import { badRequest, forbidden, notFound, AppError } from './errors.js'
import { isStaff, type Ctx, type Db, type Tx } from './db.js'
import { loadEngineData, loadSettings, type EngineData } from './engineData.js'
import { MERCHANDISERS_LABEL, writeOutbox } from './outboxService.js'
import { istDate } from './today.js'

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

/**
 * Mocked alerts to the merchandisers: stages have just turned red. Internal, so they may carry the sum. One statement for the lot; each
 * row is stamped a microsecond after the one before it, so "newest first" is the reverse of the order written even when the clock does not tick between them (BE-025).
 */
async function alertsRed(tx: Tx, list: { orderId: string; po: string; stage: string; maths: string }[]): Promise<void> {
  if (!list.length) return
  await tx.query(
    `insert into outbox (channel, recipient_kind, recipient, subject, body, order_id, created_at)
     select 'whatsapp', 'merchandiser', $1, v.subject, v.body, v.order_id::uuid, clock_timestamp() + v.n * interval '1 microsecond'
       from unnest($2::text[], $3::text[], $4::text[]) with ordinality as v(subject, body, order_id, n) order by v.n`,
    [MERCHANDISERS_LABEL, list.map((a) => `PO ${a.po}: ${cap(a.stage)} is red`), list.map((a) => `${cap(a.stage)} for PO ${a.po} has turned red. ${a.maths}`), list.map((a) => a.orderId)])
}

export interface RefreshResult { created: number; updated: number; resolved: number }

/** What a refresh covers. No scope means every order. A calendar change names its unit: the orders with a milestone there. */
export type RefreshScope = { orderId: string } | { orderIds: readonly string[] } | { unitId: string }

/** Key order and spacing out of the way: jsonb stores an object's keys in its own order, so two equal sums can print differently. */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
    : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v
const canonJson = (v: unknown): string => JSON.stringify(canon(v))

/** The orders that have a milestone in one of these units (their calendar decides those dates). */
export async function ordersInUnits(tx: Tx, unitIds: readonly string[]): Promise<string[]> {
  if (!unitIds.length) return []
  return (await tx.query<{ id: string }>('select distinct order_id::text as id from milestone where unit_id = any($1::uuid[])', [[...unitIds]])).map((r) => r.id)
}

/** The orders that carry an open warning: the ones on the review queue (or waiting to be). */
export async function ordersWithOpenWarnings(tx: Tx): Promise<string[]> {
  return (await tx.query<{ id: string }>('select distinct order_id::text as id from warning where resolved_at is null')).map((r) => r.id)
}

/**
 * The engine's data for several orders, read with one `= any(...)` per table instead of loading every order and throwing most away.
 * Same rows, same columns (no sizes, no event ORDER BY) and same mapping as loadEngineData (a test compares the two); it exists because loadEngineData takes one order id or all.
 * Delete it when loadEngineData accepts a list of ids.
 */
export async function loadEngineDataFor(tx: Tx, orderIds: readonly string[]): Promise<EngineData> {
  const ids = [...orderIds]
  const [orders, milestones, events, days, settings] = await Promise.all([
    tx.query<{ id: string; po: string; buyer_id: string; buyer_name: string; style: string; colour: string; sizes: Record<string, number>; qty: number; ex_factory: string }>(
      `select o.id::text as id, o.po, o.buyer_id::text as buyer_id, b.name as buyer_name, o.style, o.colour, null::jsonb as sizes, o.qty,
              o.ex_factory::text as ex_factory
         from orders o join buyer b on b.id = o.buyer_id where o.id = any($1::uuid[])
        order by o.ex_factory, o.po, o.style, o.colour, o.id`, [ids]),
    tx.query<{ order_id: string; stage: string; unit_id: string; planned_end: string; sequence: number; qty: number; planned_rate: number | null }>(
      `select order_id::text as order_id, stage, unit_id::text as unit_id, planned_end::text as planned_end,
              sequence, qty, planned_rate::float8 as planned_rate
         from milestone where order_id = any($1::uuid[])
        order by order_id, sequence, stage, id`, [ids]),
    tx.query<{ client_uuid: string; order_id: string; stage: string; date: string; qty: number; on_behalf: boolean }>(
      `select client_uuid::text as client_uuid, order_id::text as order_id, stage, date::text as date, qty, on_behalf
         from update_event where order_id = any($1::uuid[])`, [ids]),   // no ORDER BY, as in loadEngineData (the engine does not depend on event order)
    tx.query<{ unit_id: string; date: string; working: boolean }>(
      `select unit_id::text as unit_id, date::text as date, working from calendar_day order by unit_id, date`),
    loadSettings(tx),
  ])
  const calendars: EngineData['calendars'] = {}
  for (const d of days) (calendars[d.unit_id] ??= { days: {} }).days![d.date] = d.working
  const stagesBy: EngineData['stagesBy'] = new Map()
  for (const m of milestones) {
    const list = stagesBy.get(m.order_id) ?? []
    list.push({
      stage: m.stage, unitId: m.unit_id, qty: m.qty, milestone: m.planned_end, sequence: m.sequence,
      ...(m.planned_rate !== null ? { plannedRate: m.planned_rate } : {}),
    })
    stagesBy.set(m.order_id, list)
  }
  const eventsBy: EngineData['eventsBy'] = new Map()
  const onBehalf = new Set<string>()
  for (const e of events) {
    if (e.on_behalf) onBehalf.add(e.client_uuid)
    const list = eventsBy.get(e.order_id) ?? []
    list.push({ clientUuid: e.client_uuid, stage: e.stage, date: e.date, qty: e.qty })
    eventsBy.set(e.order_id, list)
  }
  return {
    orders: orders.map((o) => ({ id: o.id, po: o.po, buyerId: o.buyer_id, buyerName: o.buyer_name, style: o.style, colour: o.colour, sizes: o.sizes ?? {}, qty: o.qty, exFactory: o.ex_factory })),
    stagesBy, eventsBy, onBehalf, calendars, settings,
  }
}

export interface RefreshRun extends RefreshResult {
  /** The settings the figures were worked out with (canonical text), so a later scoped run can tell they have been edited. Null when nothing was loaded. */
  settingsKey: string | null
}

/**
 * Bring the warnings in line with what the engine says now, for every order or for a scope. A warning exists for each stage that
 * is amber or red and due within the warning window. It is created UNCONFIRMED, so nothing
 * reaches a buyer until a merchandiser confirms it. If the colour or the planned date changes the
 * wording changes, so it needs confirming again. When a stage recovers its warning is resolved.
 *
 * Work is proportional to what changed: a warning whose figures are the same is not written again (O-3), and the writes that are
 * needed go out as one statement per kind instead of one round trip each. With a scope only those orders are projected and only
 * their warnings are swept as resolved (O-2); the rest of the table is left exactly as it is.
 */
export async function refreshWarnings(tx: Tx, ctx: Ctx, today: string, scope?: RefreshScope): Promise<RefreshResult> {
  const { created, updated, resolved } = await runRefresh(tx, ctx, today, scope)
  return { created, updated, resolved }
}

export async function runRefresh(tx: Tx, ctx: Ctx, today: string, scope?: RefreshScope): Promise<RefreshRun> {
  if (!isStaff(ctx)) throw forbidden()
  let ids: string[] | null = null
  if (scope) {
    const set = new Set<string>()
    if ('orderId' in scope) set.add(String(scope.orderId))
    else if ('orderIds' in scope) for (const id of scope.orderIds) set.add(String(id))
    else for (const id of await ordersInUnits(tx, [String(scope.unitId)])) set.add(id)
    ids = [...set].map((id) => id.toLowerCase())
    if (ids.some((id) => !UUID.test(id))) throw badRequest('Invalid request')
  }
  const out: RefreshRun = { created: 0, updated: 0, resolved: 0, settingsKey: null }
  if (ids && ids.length === 0) return out
  const data = !ids ? await loadEngineData(tx) : ids.length === 1 ? await loadEngineData(tx, ids[0]) : await loadEngineDataFor(tx, ids)
  const { stagesBy, eventsBy, calendars, settings } = data
  out.settingsKey = canonJson(settings)
  const orders = data.orders
  const open = await tx.query<{ id: string; order_id: string; stage: string; status: 'amber' | 'red'; dismissed: boolean; planned_end: string | null; maths: unknown }>(
    `select id::text as id, order_id::text as order_id, stage, status, dismissed_at is not null as dismissed,
            maths->>'plannedEnd' as planned_end, maths
       from warning where resolved_at is null${ids ? ' and order_id = any($1::uuid[])' : ''}`, ids ? [ids] : [])
  const byKey = new Map(open.map((w) => [`${w.order_id}/${w.stage}`, w]))
  const wanted = new Set<string>()
  const horizon = addDays(today, settings.warnWithinDays)

  // What has to be written, collected first and then sent as one statement per kind.
  // `key` is set for a new warning, which is alerted only if this call really created it.
  type Alert = { orderId: string; po: string; stage: string; maths: string; key: string | null }
  const adds: { orderId: string; buyerId: string; stage: string; status: string; maths: string; text: string }[] = []
  const recoloured: { id: string; status: string; maths: string; text: string }[] = []
  const moved: { id: string; maths: string; text: string }[] = []
  const figures: { id: string; maths: string }[] = []
  const alerts: Alert[] = []

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
        adds.push({ orderId: o.id, buyerId: o.buyerId, stage: r.stage, status, maths, text })
        if (status === 'red') alerts.push({ orderId: o.id, po: o.po, stage: r.stage, maths: formatMaths(r, st.milestone), key })
      } else if (have.status !== status) {
        // The colour changed: new wording, and a human must look at it again. A dismissal does not carry over.
        recoloured.push({ id: have.id, status, maths, text })
        out.updated++
        if (status === 'red') alerts.push({ orderId: o.id, po: o.po, stage: r.stage, maths: formatMaths(r, st.milestone), key: null })
      } else if (!have.dismissed && have.planned_end !== null && have.planned_end !== st.milestone) {
        // Same colour, but the planned date the wording names has moved: new wording, and a human must look again.
        moved.push({ id: have.id, maths, text })
        out.updated++
      } else if (!have.dismissed && canonJson(have.maths) !== canonJson(JSON.parse(maths))) {
        // Same colour: keep the (possibly reworded, possibly confirmed) text, refresh the figures behind it. Only when they differ.
        figures.push({ id: have.id, maths })
      }
    }
  }

  const made = new Set<string>()
  if (adds.length) {
    // A refresh running at the same moment (another merchandiser, a batch sync) may have just raised it: keep theirs.
    const rows = await tx.query<{ order_id: string; stage: string }>(
      `insert into warning (order_id, buyer_id, stage, status, maths, buyer_text)
       select v.order_id::uuid, v.buyer_id::uuid, v.stage, v.status, v.maths::jsonb, v.text
         from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) as v(order_id, buyer_id, stage, status, maths, text)
       on conflict (order_id, stage) where resolved_at is null do nothing returning order_id::text as order_id, stage`,
      [adds.map((a) => a.orderId), adds.map((a) => a.buyerId), adds.map((a) => a.stage), adds.map((a) => a.status), adds.map((a) => a.maths), adds.map((a) => a.text)])
    for (const r of rows) made.add(`${r.order_id}/${r.stage}`)
    out.created = rows.length
  }
  if (recoloured.length) {
    await tx.query(
      `update warning w set status = v.status, maths = v.maths::jsonb, buyer_text = v.text, confirmed_by = null, confirmed_at = null, dismissed_at = null, dismissed_was_confirmed = null
         from unnest($1::text[], $2::text[], $3::text[], $4::text[]) as v(id, status, maths, text) where w.id = v.id::uuid`,
      [recoloured.map((a) => a.id), recoloured.map((a) => a.status), recoloured.map((a) => a.maths), recoloured.map((a) => a.text)])
  }
  if (moved.length) {
    await tx.query(
      `update warning w set maths = v.maths::jsonb, buyer_text = v.text, confirmed_by = null, confirmed_at = null
         from unnest($1::text[], $2::text[], $3::text[]) as v(id, maths, text) where w.id = v.id::uuid`,
      [moved.map((a) => a.id), moved.map((a) => a.maths), moved.map((a) => a.text)])
  }
  if (figures.length) {
    await tx.query(
      `update warning w set maths = v.maths::jsonb from unnest($1::text[], $2::text[]) as v(id, maths) where w.id = v.id::uuid`,
      [figures.map((a) => a.id), figures.map((a) => a.maths)])
  }
  await alertsRed(tx, alerts.filter((a) => a.key === null || made.has(a.key)))

  const gone = [...byKey].filter(([key]) => !wanted.has(key)).map(([, w]) => w.id)
  if (gone.length) {
    await tx.query('update warning set resolved_at = now() where id = any($1::uuid[])', [gone])
    out.resolved = gone.length
  }
  return out
}

// ---------------------------------------------------------------- when to refresh, and how much

/** How long a process trusts that nothing it did not see has changed (another process, a direct edit in SQL). */
export const DEFAULT_FULL_REFRESH_MS = 5 * 60_000

export interface WarningRefresherOptions {
  db: Db
  /** The app's clock: the factory day (istDate) is read from it. */
  clock?: () => Date
  /** A full refresh runs at least this often (milliseconds of real time). 0 makes every refresh a full one. Default 5 minutes, or WARNING_FULL_REFRESH_MS. */
  fullEveryMs?: number
  /**
   * When someone opens the review queue and no full refresh is due, still re-check the orders that carry an open warning (default true).
   * Those are the rows the person is about to read, so they are never older than the data behind them even if a row was edited behind
   * this process's back; an order with no warning yet waits for the next full refresh. false: trust only what this process has seen.
   */
  checkQueueOnRead?: boolean
  /** Real time in milliseconds, for the safety interval. A test can move it. */
  now?: () => number
  /** Where a failed refresh is reported. It is never thrown to the caller. */
  onError?: (e: unknown) => void
}

interface Batch { full: boolean; queue: boolean; orders: Set<string>; units: Set<string>; promise: Promise<void>; resolve: () => void; log: ((e: unknown) => void) | undefined }

const SYSTEM: Ctx = { role: 'system' }

/**
 * Decides which refresh a change needs and runs it, one at a time, as the system.
 *  - A write names what it changed (an order, a unit's calendar): only those orders are recomputed.
 *  - The first refresh of a process, the first one on a new factory day (figures move with no write), one after a failure,
 *    and one when the last full refresh is older than `fullEveryMs` (a second process or a hand edit cannot set our flags) are FULL.
 *  - Refreshes are coalesced: while one runs, any number of further requests are folded into exactly one more run after it,
 *    so N writes at the same moment cost at most 2 refreshes.
 *  - A failed refresh is reported, never thrown (it must not fail the write that asked), and leaves the state dirty so the next call does a full one.
 * All the state is in this object: a new instance starts dirty, which is how a test resets it (or call reset()).
 */
export class WarningRefresher {
  private dirtyFull = true                       // nothing has been refreshed yet, or the last attempt failed
  private lastFullDay: string | null = null      // the factory day of the last successful full refresh
  private lastFullAt = 0                         // real time of the last successful full refresh
  private lastFullSettings: string | null = null // the settings that full refresh used
  private running: Promise<void> | null = null  // the batch being run now
  private waiting: Batch | null = null           // the one batch queued behind it (or about to start)
  private active = false
  private readonly o: Required<Pick<WarningRefresherOptions, 'db' | 'clock' | 'now' | 'fullEveryMs' | 'checkQueueOnRead'>> & Pick<WarningRefresherOptions, 'onError'>

  constructor(opts: WarningRefresherOptions) {
    const env = Number(process.env.WARNING_FULL_REFRESH_MS)
    this.o = {
      db: opts.db, clock: opts.clock ?? (() => new Date()), now: opts.now ?? (() => Date.now()), onError: opts.onError, checkQueueOnRead: opts.checkQueueOnRead ?? true,
      fullEveryMs: opts.fullEveryMs ?? (process.env.WARNING_FULL_REFRESH_MS?.trim() && Number.isFinite(env) && env >= 0 ? env : DEFAULT_FULL_REFRESH_MS),
    }
  }

  /** Forget everything: the next refresh is a full one. */
  reset(): void { this.dirtyFull = true; this.lastFullDay = null; this.lastFullAt = 0; this.lastFullSettings = null }

  /** Something changed that no refresh has covered (for example a batch that stopped half way): the next refresh is a full one. */
  markDirty(): void { this.dirtyFull = true }

  /** True when the next refresh will be a full one, whatever scope it is asked for. */
  needsFull(): boolean {
    return this.dirtyFull || this.lastFullDay !== istDate(this.o.clock()) || this.o.now() - this.lastFullAt >= this.o.fullEveryMs
  }

  /**
   * After a write: bring the warnings up to date for what it changed. `undefined` means everything. Resolves once a refresh that
   * began after this call has finished; never rejects.
   */
  request(scope?: RefreshScope | 'queue', log?: (e: unknown) => void): Promise<void> {
    const b = this.waiting ?? this.newBatch(log)
    this.waiting = b
    if (!scope) b.full = true
    else if (scope === 'queue') b.queue = true
    else if ('unitId' in scope) b.units.add(scope.unitId)
    else if ('orderId' in scope) b.orders.add(scope.orderId)
    else for (const id of scope.orderIds) b.orders.add(id)
    if (!this.active) this.drain()
    return b.promise
  }

  /**
   * Before a read of the queue: it must not be stale. Does a full refresh when something is dirty, the factory day has changed or
   * the safety interval has passed; otherwise re-checks the orders on the queue (see checkQueueOnRead) after any refresh already
   * running or queued. Never rejects.
   */
  ensureFresh(log?: (e: unknown) => void): Promise<void> {
    if (this.needsFull()) return this.request(undefined, log)
    if (this.o.checkQueueOnRead) return this.request('queue', log)
    if (this.waiting) return this.waiting.promise
    return this.running ?? Promise.resolve()
  }

  private newBatch(log: ((e: unknown) => void) | undefined): Batch {
    let resolve!: () => void
    const promise = new Promise<void>((r) => { resolve = r })
    return { full: false, queue: false, orders: new Set(), units: new Set(), promise, resolve, log }
  }

  private drain(): void {
    this.active = true
    void (async () => {
      try {
        while (this.waiting) {
          const b = this.waiting
          this.waiting = null
          this.running = b.promise
          await this.runBatch(b)
          b.resolve()
        }
      } finally { this.active = false; this.running = null }
    })()
  }

  private async runBatch(b: Batch): Promise<void> {
    try {
      const today = istDate(this.o.clock())
      if (b.full || this.needsFull()) {
        await this.full(today)
        return
      }
      if (!b.orders.size && !b.units.size && !b.queue) return
      const settingsKey = await this.o.db.tx(SYSTEM, async (tx) => {
        const ids = new Set(b.orders)
        for (const id of await ordersInUnits(tx, [...b.units])) ids.add(id)
        if (b.queue) for (const id of await ordersWithOpenWarnings(tx)) ids.add(id)
        return (await runRefresh(tx, SYSTEM, today, { orderIds: [...ids] })).settingsKey
      })
      // The settings were edited behind our back: every figure may have moved, not just this scope's.
      if (settingsKey !== null && settingsKey !== this.lastFullSettings) await this.full(today)
    } catch (e) {
      this.dirtyFull = true
      try { (b.log ?? this.o.onError)?.(e) } catch { /* reporting must not break the queue */ }
    }
  }

  private async full(today: string): Promise<void> {
    const startedAt = this.o.now()
    const run = await this.o.db.tx(SYSTEM, (tx) => runRefresh(tx, SYSTEM, today))
    this.dirtyFull = false
    this.lastFullDay = today
    this.lastFullAt = startedAt
    this.lastFullSettings = run.settingsKey
  }
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

/**
 * Approve a warning for buyers, optionally rewording it first. `seen` is the colour and wording the
 * merchandiser had on screen: if a refresh changed either since, nothing is confirmed (409 'changed'),
 * because a person must look at the new state before a buyer does.
 * Confirming a warning that is already confirmed does nothing (nobody is told twice, who and when stay as they were),
 * unless it carries different wording: that is a knowing change of what the buyer is told, so it is sent, stamped by the person who changed it.
 */
export async function confirmWarning(tx: Tx, ctx: Ctx, userId: string, id: string, text?: string,
  seen?: { status?: unknown; text?: unknown }): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  if (!UUID.test(String(id)) || !UUID.test(String(userId))) throw badRequest('Invalid request')
  let reworded: string | null = null
  if (text !== undefined) {
    if (typeof text !== 'string' || !text.trim()) throw badRequest('The wording for the buyer cannot be empty')
    if (text.trim().length > MAX_BUYER_TEXT) throw badRequest(`Keep the wording to ${MAX_BUYER_TEXT} characters or fewer`)
    reworded = text.trim()
  }
  const seenStatus = seen?.status ?? null
  const seenText = seen?.text ?? null
  if ((seenStatus !== null && seenStatus !== 'amber' && seenStatus !== 'red') || (seenText !== null && typeof seenText !== 'string')) throw badRequest('Invalid request')
  // One statement decides, so a double click, a retry and two requests at the same moment cannot each send the buyer a message.
  // It changes a warning only when a person's approval is new: it is not confirmed yet, or this call rewords it. Confirming again
  // with no wording, or with the wording it already has, matches nothing: no second email, and who confirmed and when stay as they were.
  // (A reworded re-confirm is a knowing change of what the buyer is told, so it is sent, stamped by the person who changed the words.)
  const done = await tx.query<{ id: string; order_id: string; buyer_text: string }>(
    `update warning set confirmed_by = $2, confirmed_at = now(), buyer_text = coalesce($3, buyer_text)
      where id = $1 and resolved_at is null and dismissed_at is null
        and (confirmed_by is null or ($3::text is not null and $3::text is distinct from buyer_text))
        and ($4::text is null or status = $4) and ($5::text is null or buyer_text = $5) returning id, order_id::text as order_id, buyer_text`,
    [id, userId, reworded, seenStatus, seenText])
  if (done.length) {
    // Mocked alert to the buyer's contact, in this same transaction. Only the confirmed wording: never the figures behind it.
    const o = (await tx.query<{ po: string; buyer_name: string }>(
      'select o.po, b.name as buyer_name from orders o join buyer b on b.id = o.buyer_id where o.id = $1', [done[0]!.order_id]))[0]
    if (o) await writeOutbox(tx, { channel: 'email', recipientKind: 'buyer', recipient: o.buyer_name, subject: `Update on PO ${o.po}`, body: done[0]!.buyer_text, orderId: done[0]!.order_id })
  } else {
    const open = await tx.query<{ confirmed: boolean; seen: boolean; same_words: boolean }>(
      `select confirmed_by is not null as confirmed, (($2::text is null or status = $2) and ($3::text is null or buyer_text = $3)) as seen,
              ($4::text is not null and buyer_text = $4) as same_words
         from warning where id = $1 and resolved_at is null and dismissed_at is null`, [id, seenStatus, seenText, reworded])
    if (open.length) {
      // Open and already confirmed, and either what the person saw still holds or the words they sent are the words now in force
      // (the retry of a reworded confirm whose reply was lost): the confirm is already done.
      if (open[0]!.confirmed && (open[0]!.seen || open[0]!.same_words)) return
      throw new AppError(409, 'changed', 'This warning changed since you opened it. Check the colour and wording again.')
    }
    const exists = await tx.query('select 1 from warning where id = $1', [id])
    throw exists.length ? new AppError(409, 'not_open', 'This warning is no longer open') : notFound('No such warning')
  }
}

/** Hide a warning from buyers for good (until the colour changes). Works on pending and confirmed ones. */
export async function dismissWarning(tx: Tx, ctx: Ctx, id: string): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  if (!UUID.test(String(id))) throw badRequest('Invalid request')
  const done = await tx.query(
    `update warning set dismissed_at = now(), dismissed_was_confirmed = (confirmed_by is not null), confirmed_by = null, confirmed_at = null
      where id = $1 and resolved_at is null and dismissed_at is null returning id`, [id])
  if (!done.length) {
    const exists = await tx.query('select 1 from warning where id = $1', [id])
    throw exists.length ? new AppError(409, 'not_open', 'This warning is no longer open') : notFound('No such warning')
  }
}

/**
 * Undo "Don't show", but only for a warning that was still waiting for review when it was hidden: it goes back to waiting,
 * nothing reaches a buyer. One that had been confirmed (a buyer may have seen it) has no undo; showing it again needs a
 * fresh confirmation. In the same transaction the warnings are brought up to date, so what comes back is what the order
 * says now: if the stage has recovered the warning is resolved and the undo is refused (409 'not_open', nothing changes).
 */
export async function undoDismissWarning(tx: Tx, ctx: Ctx, id: string, today: string): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  if (!UUID.test(String(id))) throw badRequest('Invalid request')
  const done = await tx.query<{ id: string; order_id: string }>(
    `update warning set dismissed_at = null, dismissed_was_confirmed = null
      where id = $1 and resolved_at is null and dismissed_at is not null and dismissed_was_confirmed = false returning id, order_id::text as order_id`, [id])
  if (!done.length) {
    const w = (await tx.query<{ resolved: boolean; dismissed: boolean }>(
      'select resolved_at is not null as resolved, dismissed_at is not null as dismissed from warning where id = $1', [id]))[0]
    if (!w) throw notFound('No such warning')
    if (w.resolved) throw new AppError(409, 'not_open', 'This warning is no longer open')
    if (!w.dismissed) throw new AppError(409, 'not_dismissed', 'This warning is not hidden')
    throw new AppError(409, 'needs_confirmation', 'This warning had been confirmed, so it cannot be brought back with undo. Confirm it again to show it to the buyer.')
  }
  await refreshWarnings(tx, ctx, today, { orderId: done[0]!.order_id })   // only this order's figures can matter to what comes back
  if (!(await tx.query('select 1 from warning where id = $1 and resolved_at is null', [id])).length) {
    throw new AppError(409, 'not_open', 'This warning no longer applies')
  }
}
