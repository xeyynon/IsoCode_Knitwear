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
  if (text.length > MAX_NOTE_CHARS) throw badRequest(`Keep the note under ${MAX_NOTE_CHARS} characters`)
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
}

const NOTE_SELECT = `select n.id::text as id, n.order_id::text as order_id, o.po, b.name as buyer_name, n.stage, n.taken_on::text as taken_on,
       n.language, n.text_ta, n.text_en, n.category, n.category_by
  from note n join orders o on o.id = n.order_id join buyer b on b.id = n.buyer_id`

type NoteRow = { id: string; order_id: string; po: string; buyer_name: string; stage: string; taken_on: string; language: 'ta' | 'en' | null; text_ta: string | null; text_en: string | null; category: string | null; category_by: 'supervisor' | 'merchandiser' | null }
const toReviewNote = (r: NoteRow): ReviewNote => ({
  id: r.id, orderId: r.order_id, po: r.po, buyerName: r.buyer_name, stage: r.stage, takenOn: r.taken_on, language: r.language,
  original: r.language === 'ta' ? r.text_ta : r.text_en, textEn: r.text_en, category: r.category, categoryBy: r.category_by,
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
    if (textEn.length > MAX_NOTE_CHARS) throw badRequest(`Keep it under ${MAX_NOTE_CHARS} characters`)
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
