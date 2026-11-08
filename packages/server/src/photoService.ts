import { randomUUID } from 'node:crypto'
import { compareDates } from '@isocode/engine/dates'
import { AppError, badRequest, forbidden, notFound } from './errors.js'
import { isStaff, type Ctx, type Db, type Tx } from './db.js'
import type { MediaStore } from './mediaStore.js'
import { isIsoDate, isStageName } from './today.js'
import { earliestAllowedDate, tooOld } from './eventService.js'
import { photoAlertBody, writeOutbox } from './outboxService.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024     // the phone resizes to far less; this is the hard ceiling
export const MIN_PHOTO_BYTES = 1024

/** A real JPEG starts FF D8 FF and ends FF D9. The declared content type is never trusted on its own. */
export function looksLikeJpeg(b: Buffer): boolean {
  return b.length >= MIN_PHOTO_BYTES && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9
}

export interface PhotoUpload { clientUuid: string; orderId: string; stage: string; date: string; bytes: Buffer }

/**
 * Store one photo for a stage the caller's unit runs. Idempotent on clientUuid: a retried upload
 * (the phone lost the reply) returns the same photo instead of making a second. The photo starts
 * UNAPPROVED, so no buyer can see it until a merchandiser says so.
 *
 * No database transaction is open while the photo store works (BE-046, O-7): a slow or stuck store used to hold one of the ten
 * pool connections, a Postgres backend and a row lock for as long as the upload took. Three steps instead, each as short as the
 * database work itself:
 *   1. a short transaction: which stage, and has this clientUuid been stored already? (a repeat answers here, without uploading);
 *   2. the bytes are put under a fresh random key, with no transaction open;
 *   3. a short transaction inserts the row. If it loses a race to the same clientUuid, or fails, the object just put is deleted
 *      (best effort).
 * So a row never exists without its file (the file is there before the row), and a file without a row can only be left by a crash
 * or a failed delete between steps 2 and 3: it sits under a random key nobody can ask for, costs only its bytes, and is harmless.
 */
export async function savePhoto(db: Db, ctx: Ctx, store: MediaStore, input: PhotoUpload, today: string, onOrphan?: (key: string, err: unknown) => void): Promise<{ id: string; duplicate: boolean }> {
  if (ctx.role !== 'supervisor' && !isStaff(ctx)) throw forbidden()
  if (typeof input.clientUuid !== 'string' || !UUID.test(input.clientUuid)) throw badRequest('clientUuid must be a UUID')
  if (typeof input.orderId !== 'string' || !UUID.test(input.orderId)) throw badRequest('orderId must be a UUID')
  if (typeof input.stage !== 'string' || !input.stage.trim()) throw badRequest('stage is required')
  if (!isStageName(input.stage)) throw badRequest('stage is not a valid stage name')
  if (!isIsoDate(input.date)) throw badRequest('date must be YYYY-MM-DD')
  if (compareDates(input.date, today) > 0) throw badRequest('date is in the future')
  if (compareDates(input.date, earliestAllowedDate(today)) < 0) throw tooOld()
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length > MAX_PHOTO_BYTES) throw new AppError(413, 'photo_too_large', 'That photo is too large')   // 413 here and in the error handler: the phone reads any 4xx but 429 as "never going to work"; a stable code says why
  if (!looksLikeJpeg(input.bytes)) throw new AppError(400, 'not_a_photo', 'That file is not a JPEG photo')

  // 1. The stage (row-level security filters it to the caller's unit) and the photo already stored under this clientUuid, in one query.
  const found = (await db.tx(ctx, (tx) => tx.query<{ buyer_id: string; unit_id: string; photo_id: string | null; photo_order: string | null }>(
    `select m.buyer_id::text as buyer_id, m.unit_id::text as unit_id, p.id::text as photo_id, p.order_id::text as photo_order
       from milestone m left join photo p on p.client_uuid = $3
      where m.order_id = $1 and m.stage = $2`, [input.orderId, input.stage, input.clientUuid])))[0]
  if (!found) throw notFound(isStaff(ctx) ? 'No such stage on this order' : 'No such stage for your unit')
  if (found.photo_id) return repeat(found.photo_id, found.photo_order, input.orderId)

  // 2. The bytes, with no transaction open. If this throws there is no row, and a retry starts again from step 1.
  const key = `photos/${randomUUID()}.jpg`
  await store.put(key, input.bytes)

  // 3. The row. Any way out other than "this row is stored" takes the object back.
  let kept = false, inserted = false
  try {
    const out = await db.tx(ctx, async (tx) => {
      const made = await tx.query<{ id: string }>(
        `insert into photo (client_uuid, order_id, buyer_id, storage_key, stage, unit_id, taken_on, bytes)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (client_uuid) do nothing returning id::text as id`,
        [input.clientUuid, input.orderId, found.buyer_id, key, input.stage, found.unit_id, input.date, input.bytes.length])
      if (made.length) { inserted = true; return { id: made[0]!.id, duplicate: false } }
      // Lost a race with a repeat of this upload that stored its row first. Return that photo, if it really is this caller's (row-level security filters the read).
      const existing = (await tx.query<{ id: string; order_id: string }>('select id::text as id, order_id::text as order_id from photo where client_uuid = $1', [input.clientUuid]))[0]
      return repeat(existing?.id ?? null, existing?.order_id ?? null, input.orderId)
    })
    kept = !out.duplicate
    return out
  } finally {
    if (!kept) {
      // The insert ran but the transaction did not report success (the commit's answer was lost): the row may exist. A row without its
      // file is the harmful case, an object without a row is not, so keep the object unless the row is proven absent.
      const maybeStored = inserted && await db.tx(ctx, (tx) => tx.query('select 1 from photo where storage_key = $1', [key])).then((r) => r.length > 0, () => true)
      if (!maybeStored) await store.delete(key).catch((err) => { onOrphan?.(key, err) })   // do not mask the real outcome if the delete fails too
    }
  }
}

/** The answer for an upload id that is already stored: the same photo if it is for this order, otherwise the id is taken. */
function repeat(id: string | null, orderId: string | null, wantedOrder: string): { id: string; duplicate: boolean } {
  if (!id || orderId !== wantedOrder) throw new AppError(409, 'conflict', 'That upload id is already used')
  return { id, duplicate: true }
}

export interface PendingPhoto { id: string; orderId: string; po: string; buyerName: string; stage: string; takenOn: string; bytes: number; createdAt: string }

/** Photos waiting for a decision, newest last. */
export async function listPendingPhotos(tx: Tx, ctx: Ctx): Promise<PendingPhoto[]> {
  if (!isStaff(ctx)) throw forbidden('The review queue is for merchandisers')
  const rows = await tx.query<{ id: string; order_id: string; po: string; buyer_name: string; stage: string; taken_on: string; bytes: number; created_at: string }>(
    `select p.id::text as id, p.order_id::text as order_id, o.po, b.name as buyer_name, p.stage, p.taken_on::text as taken_on, p.bytes,
            to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
       from photo p join orders o on o.id = p.order_id join buyer b on b.id = p.buyer_id
      where p.approved_by is null and p.rejected_at is null order by p.created_at, p.id`)
  return rows.map((r) => ({ id: r.id, orderId: r.order_id, po: r.po, buyerName: r.buyer_name, stage: r.stage, takenOn: r.taken_on, bytes: r.bytes, createdAt: r.created_at }))
}

export interface VisiblePhoto { id: string; orderId: string; po: string; buyerName: string; stage: string; takenOn: string }

/** Photos a buyer can see right now, newest first, so one can be withdrawn. No cap: every one a buyer sees must be reachable. */
export async function listApprovedPhotos(tx: Tx, ctx: Ctx): Promise<VisiblePhoto[]> {
  if (!isStaff(ctx)) throw forbidden('The review queue is for merchandisers')
  const rows = await tx.query<{ id: string; order_id: string; po: string; buyer_name: string; stage: string; taken_on: string }>(
    `select p.id::text as id, p.order_id::text as order_id, o.po, b.name as buyer_name, p.stage, p.taken_on::text as taken_on
       from photo p join orders o on o.id = p.order_id join buyer b on b.id = p.buyer_id
      where p.approved_by is not null and p.rejected_at is null and p.purged_at is null order by p.approved_at desc, p.id`)
  return rows.map((r) => ({ id: r.id, orderId: r.order_id, po: r.po, buyerName: r.buyer_name, stage: r.stage, takenOn: r.taken_on }))
}

/** Files handled per round of the clean-up: each round is two short transactions, so no transaction waits on the photo store. */
export const PURGE_BATCH = 100

/**
 * Delete the FILES of photos rejected more than `days` ago. The row stays (an update may point at it) and
 * is marked purged, so it simply reads as "not found" from then on. Safe to run again and again.
 *
 * No transaction is open while a file is deleted (BE-046): a short transaction picks up to PURGE_BATCH candidates, the files are
 * deleted with nothing held, and a second short transaction marks purged only the ones whose delete succeeded. A delete that fails
 * leaves its row as it was (it is tried again at the next clean-up), the others of the round are still marked, and the first failure
 * is thrown at the end, so the caller sees the error and the work done is kept. A crash between deleting and marking is harmless: the
 * delete is repeated and finds nothing (stores treat a missing file as success).
 */
export async function purgeRejectedPhotos(db: Db, ctx: Ctx, store: MediaStore, days: number): Promise<number> {
  if (!isStaff(ctx)) throw forbidden()
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw badRequest('days must be a whole number from 0 to 3650')
  let purged = 0
  const skip: string[] = []   // ids whose delete failed in this run: not picked again, or a stuck file would be retried for ever
  let firstFailure: unknown
  for (;;) {
    const rows = await db.tx(ctx, (tx) => tx.query<{ id: string; storage_key: string }>(
      `select id::text as id, storage_key from photo
        where rejected_at is not null and purged_at is null and rejected_at < now() - make_interval(days => $1::int) and id <> all($3::uuid[])
        order by rejected_at, id limit $2`, [days, PURGE_BATCH, skip]))
    if (!rows.length) break
    const done: string[] = []
    for (const r of rows) {
      try { await store.delete(r.storage_key); done.push(r.id) } catch (e) { skip.push(r.id); firstFailure ??= e }
    }
    if (done.length) {
      await db.tx(ctx, (tx) => tx.query('update photo set purged_at = now() where id = any($1::uuid[]) and purged_at is null', [done]))
      purged += done.length
    }
    if (rows.length < PURGE_BATCH) break
  }
  if (firstFailure !== undefined) throw firstFailure
  return purged
}

/**
 * Show a photo to its buyer. Withdrawing it later is a reject. A cleaned (purged) photo has no file, so it cannot come back.
 * One statement decides everything: it changes only a photo that is not approved now (new, or withdrawn), so approving again
 * keeps the first approver and time, and two approvals at the same moment cannot both pass (the second waits for the row, then
 * finds it already approved). Only the one that changed the row tells the buyer.
 */
export async function approvePhoto(tx: Tx, ctx: Ctx, userId: string, id: string): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  if (!UUID.test(String(id)) || !UUID.test(String(userId))) throw badRequest('Invalid request')
  const done = await tx.query<{ order_id: string; stage: string | null }>(
    `update photo set approved_by = $2, approved_at = now(), rejected_at = null
      where id = $1 and purged_at is null and (approved_by is null or rejected_at is not null) returning order_id::text as order_id, stage`, [id, userId])
  if (!done.length) {
    // Nothing changed: either there is no such usable photo, or it is approved already, and approving again tells nobody anything.
    const approved = await tx.query('select 1 from photo where id = $1 and purged_at is null and approved_by is not null and rejected_at is null', [id])
    if (approved.length) return
    throw notFound('No such photo')
  }
  // Mocked alert to the buyer's contact, in this same transaction. Says only that a photo is ready.
  const o = (await tx.query<{ po: string; buyer_name: string }>(
    'select o.po, b.name as buyer_name from orders o join buyer b on b.id = o.buyer_id where o.id = $1', [done[0]!.order_id]))[0]
  if (o) await writeOutbox(tx, { channel: 'email', recipientKind: 'buyer', recipient: o.buyer_name, subject: `New photo for PO ${o.po}`, body: photoAlertBody(o.po, done[0]!.stage), orderId: done[0]!.order_id })
}

/** Withdraw or turn down a photo. Rejecting a rejected photo keeps the first time, so the purge date does not move. */
export async function rejectPhoto(tx: Tx, ctx: Ctx, id: string): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  if (!UUID.test(String(id))) throw badRequest('Invalid request')
  const done = await tx.query('update photo set rejected_at = now(), approved_by = null, approved_at = null where id = $1 and rejected_at is null returning id', [id])
  if (!done.length && !(await tx.query('select 1 from photo where id = $1', [id])).length) throw notFound('No such photo')
}

/**
 * Where a buyer's photo is kept: only an approved, not-withdrawn photo of THIS buyer. The conditions are stated here
 * as well as in the database policy, so a mistake in either one alone would not leak a photo.
 * Only the key is looked up here, in a short transaction the caller ends BEFORE the bytes are fetched (BE-046): see `readPhoto`.
 */
export async function getBuyerPhotoKey(tx: Tx, buyerId: string, id: string): Promise<string> {
  if (!UUID.test(String(id))) throw notFound('No such photo')
  const row = (await tx.query<{ storage_key: string }>(
    'select storage_key from photo where id = $1 and buyer_id = $2 and approved_by is not null and rejected_at is null and purged_at is null', [id, buyerId]))[0]
  if (!row) throw notFound('No such photo')
  return row.storage_key
}

/**
 * Where one photo is kept. Which photos the caller may read is decided by row-level security (staff:
 * all; a supervisor: their unit's; a buyer: only their own APPROVED ones), so a photo the caller
 * may not see is simply "not found", the same answer as one that does not exist.
 */
export async function getPhotoKey(tx: Tx, id: string): Promise<string> {
  if (!UUID.test(String(id))) throw notFound('No such photo')
  const row = (await tx.query<{ storage_key: string }>('select storage_key from photo where id = $1', [id]))[0]
  if (!row) throw notFound('No such photo')
  return row.storage_key
}

/**
 * The bytes of a photo: the authorisation (the key lookup) runs in its own short transaction, the connection goes back to the pool,
 * and only then does the store work (BE-046, O-7). A file that is gone is the same "not found" as a photo that is not there.
 */
export async function readPhoto(db: Db, ctx: Ctx, store: MediaStore, lookup: (tx: Tx) => Promise<string>): Promise<Buffer> {
  const key = await db.tx(ctx, lookup)
  const bytes = await store.get(key)
  if (!bytes) throw notFound('No such photo')
  return bytes
}

/** A buyer's photo as bytes (see getBuyerPhotoKey and readPhoto). */
export const getBuyerPhotoBytes = (db: Db, ctx: Ctx, store: MediaStore, buyerId: string, id: string): Promise<Buffer> =>
  readPhoto(db, ctx, store, (tx) => getBuyerPhotoKey(tx, buyerId, id))

/** One photo as bytes for a signed-in person (see getPhotoKey and readPhoto). */
export const getPhotoBytes = (db: Db, ctx: Ctx, store: MediaStore, id: string): Promise<Buffer> =>
  readPhoto(db, ctx, store, (tx) => getPhotoKey(tx, id))
