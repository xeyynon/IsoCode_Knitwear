import { randomUUID } from 'node:crypto'
import { AppError, badRequest, forbidden, notFound } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_NOTE_CHARS = 500

export interface Reason { id: string; en: string; ta?: string }

/** The fixed list of reasons a stage can be slow. Held in settings so the client can change it without a release. */
export async function loadReasons(tx: Tx): Promise<Reason[]> {
  const row = (await tx.query<{ value: unknown }>(`select value from settings where key = 'reason_categories'`))[0]
  const list = Array.isArray(row?.value) ? (row!.value as Reason[]) : []
  return list.filter((r) => r && typeof r.id === 'string' && typeof r.en === 'string')
}

/** Tamil if the text contains any Tamil letters, else English. Nothing is translated: this only labels the original. */
export const detectLanguage = (text: string): 'ta' | 'en' => (/[஀-௿]/.test(text) ? 'ta' : 'en')

/** Strip control characters and tidy spaces, so pasted text cannot carry anything odd into a report or a page. */
export const cleanNote = (raw: string): string => raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim()

export interface NoteInput { text?: unknown; category?: unknown }
export interface ParsedNote { text: string | null; category: string | null; language: 'ta' | 'en' | null }

/**
 * Check a note that came with an update. Both parts are optional, but an empty note is no note at all.
 * The reason must be one on the fixed list: free-typed reasons cannot be counted or compared.
 * A reason that has since left the list (a phone holding an old copy) is filed as 'other' for the reviewer,
 * or dropped if the list has no 'other': the count must never be refused because of a note.
 */
export function parseNote(input: NoteInput | undefined, reasons: Reason[]): ParsedNote | null {
  if (input === undefined || input === null) return null
  if (typeof input !== 'object') throw badRequest('The note is not valid')
  const text = typeof input.text === 'string' ? cleanNote(input.text) : ''
  if (input.text !== undefined && input.text !== null && typeof input.text !== 'string') throw badRequest('The note text is not valid')
  if (text.length > MAX_NOTE_CHARS) throw badRequest(`Keep the note to ${MAX_NOTE_CHARS} characters or fewer`)
  let category: string | null = null
  if (input.category !== undefined && input.category !== null && input.category !== '') {
    if (typeof input.category !== 'string') throw badRequest('Choose a reason from the list')
    if (reasons.some((r) => r.id === input.category)) category = input.category
    else if (reasons.some((r) => r.id === 'other')) category = 'other'
  }
  if (!text && !category) return null
  return { text: text || null, category, language: text ? detectLanguage(text) : null }
}

export interface NoteContext { orderId: string; buyerId: string; unitId: string; stage: string; date: string }

/** Insert a note and return its id. The original text goes in its own language's column; the other waits for a person. */
export async function insertNote(tx: Tx, n: ParsedNote, c: NoteContext, by: 'supervisor' | 'merchandiser' = 'supervisor'): Promise<string> {
  const id = randomUUID()
  await tx.query(
    `insert into note (id, order_id, buyer_id, stage, unit_id, taken_on, language, text_ta, text_en, category, category_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, c.orderId, c.buyerId, c.stage, c.unitId, c.date, n.language, n.language === 'ta' ? n.text : null, n.language === 'en' ? n.text : null,
     n.category, n.category ? by : null])
  return id
}

export interface ReviewNote {
  id: string; orderId: string; po: string; buyerName: string; stage: string; takenOn: string
  language: 'ta' | 'en' | null
  /** What the supervisor wrote, in their own language. */
  original: string | null
  /** The English meaning: what the supervisor wrote if it was English, otherwise filled in by a merchandiser. */
  textEn: string | null
  category: string | null
  categoryBy: 'supervisor' | 'merchandiser' | null
  /** The AI's suggestion, beside the original and never in place of it. null = not asked yet (or AI is off). */
  ai: NoteSuggestion | null
}

export interface NoteSuggestion {
  status: 'suggested' | 'unsure' | 'failed'
  textEn: string | null
  category: string | null
  confidence: number | null
  why: string | null
  model: string | null
  /** Why there is no usable suggestion (a short code such as timeout or refused); null when there is one. */
  error: string | null
  attempts: number
  at: string | null
}

const NOTE_SELECT = `select n.id::text as id, n.order_id::text as order_id, o.po, b.name as buyer_name, n.stage, n.taken_on::text as taken_on,
       n.language, n.text_ta, n.text_en, n.category, n.category_by,
       n.ai_status, n.ai_text_en, n.ai_category, n.confidence::float8 as ai_confidence, n.ai_why, n.ai_model, n.ai_error, n.ai_attempts, n.ai_at
  from note n join orders o on o.id = n.order_id join buyer b on b.id = n.buyer_id`

type NoteRow = {
  id: string; order_id: string; po: string; buyer_name: string; stage: string; taken_on: string; language: 'ta' | 'en' | null; text_ta: string | null; text_en: string | null; category: string | null; category_by: 'supervisor' | 'merchandiser' | null
  ai_status: NoteSuggestion['status'] | null; ai_text_en: string | null; ai_category: string | null; ai_confidence: number | null; ai_why: string | null; ai_model: string | null; ai_error: string | null; ai_attempts: number; ai_at: Date | string | null
}
const toReviewNote = (r: NoteRow): ReviewNote => ({
  id: r.id, orderId: r.order_id, po: r.po, buyerName: r.buyer_name, stage: r.stage, takenOn: r.taken_on, language: r.language,
  original: r.language === 'ta' ? r.text_ta : r.text_en, textEn: r.text_en, category: r.category, categoryBy: r.category_by,
  ai: r.ai_status ? {
    status: r.ai_status, textEn: r.ai_text_en, category: r.ai_category, confidence: r.ai_confidence, why: r.ai_why, model: r.ai_model,
    error: r.ai_error, attempts: r.ai_attempts, at: r.ai_at === null ? null : new Date(r.ai_at).toISOString(),
  } : null,
})

/** Notes nobody has reviewed yet, oldest first. */
export async function listPendingNotes(tx: Tx, ctx: Ctx): Promise<ReviewNote[]> {
  if (!isStaff(ctx)) throw forbidden('The review queue is for merchandisers')
  return (await tx.query<NoteRow>(`${NOTE_SELECT} where n.confirmed_by is null order by n.created_at, n.id`)).map(toReviewNote)
}

/** Every note on one order, newest first (shown on the order's page). */
export async function listOrderNotes(tx: Tx, ctx: Ctx, orderId: string): Promise<(ReviewNote & { reviewed: boolean })[]> {
  if (!isStaff(ctx)) throw forbidden()
  const rows = await tx.query<NoteRow & { reviewed: boolean }>(`${NOTE_SELECT.replace('n.category_by', 'n.category_by, n.confirmed_by is not null as reviewed')} where n.order_id = $1 order by n.created_at desc, n.id`, [orderId])
  return rows.map((r) => ({ ...toReviewNote(r), reviewed: r.reviewed }))
}

/** A merchandiser reviews a note: adds the English meaning and settles the reason. */
export async function confirmNote(tx: Tx, ctx: Ctx, userId: string, id: string, input: { textEn?: unknown; category?: unknown }): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  if (!UUID.test(String(id)) || !UUID.test(String(userId))) throw badRequest('Invalid request')
  const reasons = await loadReasons(tx)
  let textEn: string | null = null
  if (input.textEn !== undefined && input.textEn !== null) {
    if (typeof input.textEn !== 'string') throw badRequest('The English text is not valid')
    textEn = cleanNote(input.textEn)
    if (textEn.length > MAX_NOTE_CHARS) throw badRequest(`Keep it to ${MAX_NOTE_CHARS} characters or fewer`)
  }
  let category: string | null = null
  if (input.category !== undefined && input.category !== null && input.category !== '') {
    if (typeof input.category !== 'string' || !reasons.some((r) => r.id === input.category)) throw badRequest('Choose a reason from the list')
    category = input.category
  }
  const done = await tx.query(
    `update note set confirmed_by = $2, confirmed_at = now(),
            text_en = case when language = 'ta' then coalesce($3, text_en) else text_en end,   -- the English meaning is only ever added to a Tamil note: an English original is never overwritten
            category_by = case when $4::text is not null and $4::text is distinct from category then 'merchandiser' else category_by end,
            category = coalesce($4::text, category)
      where id = $1 and confirmed_by is null returning id`, [id, userId, textEn || null, category])
  if (!done.length) {
    const exists = await tx.query('select 1 from note where id = $1', [id])
    throw exists.length ? new AppError(409, 'already_reviewed', 'This note has already been reviewed') : notFound('No such note')
  }
}


// ---- AI suggestions (noteAi.ts asks the model; this file decides what is stored)

export interface NoteToSuggest { id: string; text: string; language: 'ta' | 'en'; stage: string; category: string | null }

/** A claim younger than this keeps other requests away from a note: the provider call is cut off after 20 s, so an older claim is a dead one. */
export const AI_CLAIM_SECONDS = 20
/** After a rate limit, a timeout or an unreachable service, a note is left alone for this long and the failure is not counted as a try. */
export const AI_RETRY_AFTER_SECONDS = 60
/** How many times a merchandiser may press "Ask again" on one note. The automatic tries (3) are counted apart, in ai_attempts. */
export const MAX_ASK_AGAIN = 3
export const DEFAULT_AI_DAILY_BUDGET = 300

/** Failures that say nothing about the note itself: the service is busy, slow or out of reach. */
export const TRANSIENT_AI_FAILURES: readonly string[] = ['rate_limited', 'timeout', 'unreachable']

export type ClaimOutcome = { notes: NoteToSuggest[] } | { refused: 'not_found' | 'unreadable' | 'ask_limit' | 'in_progress' }

/**
 * Take the notes a request will ask the AI about, in one statement: `for update skip locked` and the claim time mean that requests
 * arriving together get different notes, and a note someone is already asking about (a claim younger than the provider timeout)
 * is skipped. Automatic: notes with no suggestion yet, or whose last try failed for the note's own reasons fewer than maxAttempts
 * times, and not paused after a busy service. One note by id ("Ask again"): any unreviewed note with words, at most MAX_ASK_AGAIN times.
 */
export async function claimNotesToSuggest(tx: Tx, ctx: Ctx, limit: number, maxAttempts: number, onlyId?: string): Promise<ClaimOutcome> {
  if (!isStaff(ctx)) throw forbidden()
  const unclaimed = `(n.ai_claimed_at is null or n.ai_claimed_at < now() - interval '${AI_CLAIM_SECONDS} seconds')`
  const which = onlyId
    ? `n.id = $2 and n.ai_manual_asks < ${MAX_ASK_AGAIN}`
    : `(n.ai_status is null or (n.ai_status = 'failed' and n.ai_attempts < ${Math.max(1, Math.floor(maxAttempts))}))
        and (n.ai_retry_after is null or n.ai_retry_after <= now())`
  const rows = await tx.query<{ id: string; text: string; language: 'ta' | 'en'; stage: string; category: string | null; created_at: Date | string }>(
    `update note set ai_claimed_at = now()${onlyId ? ', ai_manual_asks = ai_manual_asks + 1' : ''}
      where id in (select n.id from note n
                    where n.confirmed_by is null and coalesce(n.text_ta, n.text_en) is not null and n.language is not null
                      and ${unclaimed} and ${which}
                    order by n.created_at, n.id limit $1 for update skip locked)
      returning id::text as id, coalesce(text_ta, text_en) as text, language, stage, category, created_at`, onlyId ? [limit, onlyId] : [limit])
  if (rows.length || !onlyId) {
    rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || (a.id < b.id ? -1 : 1))
    return { notes: rows.map(({ created_at: _c, ...n }) => n) }
  }
  const why = (await tx.query<{ reviewed: boolean; words: boolean; asks: number }>(
    `select n.confirmed_by is not null as reviewed, (coalesce(n.text_ta, n.text_en) is not null and n.language is not null) as words,
            n.ai_manual_asks as asks
       from note n where n.id = $1`, [onlyId]))[0]
  if (!why) return { refused: 'not_found' }
  if (why.reviewed || !why.words) return { refused: 'unreadable' }
  return { refused: why.asks >= MAX_ASK_AGAIN ? 'ask_limit' : 'in_progress' }
}

/** Let go of notes that were claimed but will not be asked about now (the budget ran out, or the batch stopped). */
export async function releaseNotes(tx: Tx, ids: string[], undoAsk = false): Promise<void> {
  if (!ids.length) return
  await tx.query(`update note set ai_claimed_at = null${undoAsk ? ', ai_manual_asks = greatest(0, ai_manual_asks - 1)' : ''} where id = any($1::uuid[]) and confirmed_by is null`, [ids])
}

/**
 * The service said it is busy, slow or out of reach: every note still waiting for an automatic try is left alone for a minute,
 * so the next requests (the review page asks again right away) do not go on knocking on it note by note.
 */
export async function pauseWaitingNotes(tx: Tx): Promise<void> {
  await tx.query(
    `update note set ai_retry_after = now() + make_interval(secs => $1::int)
      where confirmed_by is null and (ai_status is null or ai_status = 'failed')`, [AI_RETRY_AFTER_SECONDS])
}

/** The most AI calls a day: the setting (a client may change it without a release), unless the deployment sets one. */
export async function loadAiDailyBudget(tx: Tx): Promise<number> {
  const v = (await tx.query<{ value: unknown }>(`select value from settings where key = 'ai_daily_budget'`))[0]?.value
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_AI_DAILY_BUDGET
}

/**
 * Take up to `want` calls from today's budget (day = the database's UTC day) and say how many were granted, 0 to want.
 * The row is locked while it is counted, so requests arriving together cannot overspend it. Old days are tidied away.
 */
export async function reserveAiCalls(tx: Tx, ctx: Ctx, want: number, budget: number): Promise<number> {
  if (!isStaff(ctx)) throw forbidden()
  await tx.query(`insert into ai_budget (day, calls) values (current_date, 0) on conflict (day) do nothing`)
  const used = (await tx.query<{ calls: number }>(`select calls from ai_budget where day = current_date for update`))[0]!.calls
  const take = Math.max(0, Math.min(want, budget - used))
  if (take > 0) await tx.query(`update ai_budget set calls = calls + $1 where day = current_date`, [take])
  await tx.query(`delete from ai_budget where day < current_date - 7`)
  return take
}

/** The threshold under which a suggestion is only "unsure". Settings hold it; a missing or odd value falls back to 0.7. */
export async function loadAiMinConfidence(tx: Tx): Promise<number> {
  const v = (await tx.query<{ value: unknown }>(`select value from settings where key = 'ai_min_confidence'`))[0]?.value
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.7
}

/** Store a judged answer. Only on a note nobody has reviewed yet: a reviewed note keeps what the merchandiser decided. */
export async function saveSuggestion(tx: Tx, ctx: Ctx, id: string, j: { status: 'suggested' | 'unsure'; textEn: string; category: string | null; confidence: number; why: string; model: string }): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  await tx.query(
    `update note set ai_status = $2, ai_text_en = $3, ai_category = $4, confidence = $5, ai_why = $6, ai_model = $7, ai_error = null,
            ai_attempts = ai_attempts + 1, ai_at = now(), ai_claimed_at = null, ai_retry_after = null
      where id = $1 and confirmed_by is null`, [id, j.status, j.textEn || null, j.category, j.confidence, j.why || null, j.model || null])
}

/**
 * Record that no usable answer came back. An earlier good suggestion is kept (asking again must not lose it).
 * A busy, slow or unreachable service is not the note's fault: it is not counted as a try, and the note waits a minute.
 */
export async function saveSuggestionFailure(tx: Tx, ctx: Ctx, id: string, code: string): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  const transient = TRANSIENT_AI_FAILURES.includes(code)
  await tx.query(
    `update note set ai_status = case when ai_status in ('suggested', 'unsure') then ai_status else 'failed' end,
            ai_error = $2, ai_attempts = ai_attempts + $3::int, ai_at = now(), ai_claimed_at = null,
            ai_retry_after = case when $3::int = 0 then now() + make_interval(secs => $4::int) else null end
      where id = $1 and confirmed_by is null`, [id, code.slice(0, 40), transient ? 0 : 1, AI_RETRY_AFTER_SECONDS])
}
