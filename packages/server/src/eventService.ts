import { addDays, compareDates } from '@isocode/engine/dates'
import { badRequest, forbidden, notFound } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'
import { isIsoDate, isStageName } from './today.js'
import { insertNote, loadReasons, parseNote, type NoteInput } from './noteService.js'

export interface EventInput {
  clientUuid: string
  orderId: string
  stage: string
  date: string      // the date the supervisor sees, YYYY-MM-DD
  qty: number
  photoId?: string
  /** A reason and/or a few words. Created by the server together with the update; a caller can never point at an existing note. */
  note?: NoteInput
}

/**
 * How far back an update or a photo may be dated, in days (BE-047). A phone with a wrong clock, or a typo (2002 for 2026), used to be
 * accepted for any past date and then counted toward the stage. A year is more than any real catch-up; the day exactly this many days
 * back is still accepted, the day before it is not.
 */
export const MAX_DAYS_IN_PAST = 366

/** The oldest date accepted when today is `today` (both factory calendar dates, YYYY-MM-DD). */
export const earliestAllowedDate = (today: string): string => addDays(today, -MAX_DAYS_IN_PAST)

/** The one refusal for a date that is too old; plain words, no internals. */
export const tooOld = () => badRequest(`date is more than ${MAX_DAYS_IN_PAST} days in the past`)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_QTY = 1_000_000

/**
 * Record today's pieces for one stage. Idempotent on clientUuid: a retried send
 * (flaky network, app killed mid-sync) is reported as a duplicate and never counted
 * twice. Row-level security decides whether the caller may post to this stage at all.
 * A merchandiser may post for any stage (a subcontractor has no one to send a count); that
 * update is stored as entered on behalf, by whom, and shown as low confidence. `enteredBy` is
 * the caller's account id from the sign-in token.
 */
export async function submitEvent(
  tx: Tx, ctx: Ctx, input: EventInput, today: string, enteredBy?: string, opts: { clampFuture?: boolean } = {},
): Promise<{ duplicate: boolean }> {
  if (ctx.role !== 'supervisor' && !isStaff(ctx)) throw forbidden()
  // A null body or batch item must be a 400 / one rejected item, not a TypeError that sinks the whole request.
  if (typeof input !== 'object' || input === null) throw badRequest('Invalid update')
  // typeof first: a regular expression turns a one-item list into its text and lets it through, and a list has no toLowerCase().
  if (typeof input.clientUuid !== 'string' || !UUID.test(input.clientUuid)) throw badRequest('clientUuid must be a UUID')
  if (typeof input.orderId !== 'string' || !UUID.test(input.orderId)) throw badRequest('orderId must be a UUID')
  if (typeof input.stage !== 'string' || !input.stage.trim()) throw badRequest('stage is required')
  if (!isStageName(input.stage)) throw badRequest('stage is not a valid stage name')
  if (!Number.isInteger(input.qty) || input.qty < 0 || input.qty > MAX_QTY) {
    throw badRequest(`qty must be a whole number from 0 to ${MAX_QTY}`)
  }
  if (!isIsoDate(input.date)) throw badRequest('date must be YYYY-MM-DD')
  // A phone with a wrong clock must not post into the future; the engine would ignore it anyway.
  // (A shared demo, whose factory day is pinned, keeps such an update on the pinned day instead: N-10, see demoMode.ts.)
  if (compareDates(input.date, today) > 0) {
    if (!opts.clampFuture) throw badRequest('date is in the future')
    input = { ...input, date: today }
  }
  if (compareDates(input.date, earliestAllowedDate(today)) < 0) throw tooOld()

  // Check the note BEFORE anything is written, so a malformed note refuses the whole update cleanly.
  // (A reason that has merely left the list is not malformed: parseNote files it as 'other' and the pieces are kept.)
  const note = input.note === undefined ? null : parseNote(input.note, await loadReasons(tx))

  // Visible only if this caller's unit runs the stage (row-level security filters the rows).
  const stage = await tx.query<{ buyer_id: string; unit_id: string }>(
    'select buyer_id::text as buyer_id, unit_id::text as unit_id from milestone where order_id = $1 and stage = $2',
    [input.orderId, input.stage],
  )
  const m = stage[0]
  // A supervisor may be asking about a stage another unit runs, so they are told only about their unit; staff see every stage, so for them it is a plain miss.
  if (!m) throw notFound(isStaff(ctx) ? 'No such stage on this order' : 'No such stage for your unit')

  // A photo must be one this caller can see (their own unit's) for THIS order, not just any id.
  if (input.photoId !== undefined && input.photoId !== null) {
    if (typeof input.photoId !== 'string' || !UUID.test(input.photoId)) throw badRequest('photoId must be a UUID')
    const mine = await tx.query('select 1 from photo where id = $1 and order_id = $2', [input.photoId, input.orderId])
    if (!mine.length) throw badRequest('That photo is not available for this order')
  }

  // Exactly once, even when a repeat overlaps the first send (a phone retrying while the first request is still running):
  // 1. Wait our turn on this client id. The lock is held until this transaction ends, so a second request with the same id
  //    waits here, and when it gets the lock the first has committed and the check below sees its row. The key is lower-cased
  //    because the database compares uuids, not spellings. Two different ids never wait for each other (except by a rare hash
  //    match, which only makes them take turns).
  await tx.query('select pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['update_event', input.clientUuid.toLowerCase()])
  // 2. A repeat is recognised BEFORE the note is written: a supervisor may insert notes but not delete them.
  if (note && (await tx.query('select 1 from update_event where client_uuid = $1', [input.clientUuid])).length) return { duplicate: true }
  // 3. Belt and braces: an id the caller cannot see (another unit's update, hidden by row-level security) passes the check
  //    above but still collides on insert. The note written for it is undone, so a duplicate never leaves a note behind.
  if (note) await tx.query('savepoint note_write')
  const onBehalf = isStaff(ctx)
  const noteId = note ? await insertNote(tx, note, { orderId: input.orderId, buyerId: m.buyer_id, unitId: m.unit_id, stage: input.stage, date: input.date }, onBehalf ? 'merchandiser' : 'supervisor') : null
  const inserted = await tx.query(
    `insert into update_event (client_uuid, order_id, buyer_id, stage, unit_id, date, qty, photo_id, note_id, on_behalf, entered_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (client_uuid) do nothing
     returning id`,
    [input.clientUuid, input.orderId, m.buyer_id, input.stage, m.unit_id, input.date, input.qty, input.photoId ?? null, noteId,
      onBehalf, enteredBy !== undefined && UUID.test(enteredBy) ? enteredBy : null],
  )
  if (note) await tx.query(inserted.length === 0 ? 'rollback to savepoint note_write' : 'release savepoint note_write')
  return { duplicate: inserted.length === 0 }
}
