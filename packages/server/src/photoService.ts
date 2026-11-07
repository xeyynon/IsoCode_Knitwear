import { randomUUID } from 'node:crypto'
import { compareDates } from '@isocode/engine/dates'
import { AppError, badRequest, forbidden, notFound } from './errors.js'
import { isStaff, type Ctx, type Tx } from './db.js'
import type { MediaStore } from './mediaStore.js'
import { isIsoDate, isStageName } from './today.js'
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
 */
export async function savePhoto(tx: Tx, ctx: Ctx, store: MediaStore, input: PhotoUpload, today: string): Promise<{ id: string; duplicate: boolean }> {
  if (ctx.role !== 'supervisor' && !isStaff(ctx)) throw forbidden()
  if (!UUID.test(input.clientUuid)) throw badRequest('clientUuid must be a UUID')
  if (!UUID.test(input.orderId)) throw badRequest('orderId must be a UUID')
  if (!input.stage?.trim()) throw badRequest('stage is required')
  if (!isStageName(input.stage)) throw badRequest('stage is not a valid stage name')
  if (!isIsoDate(input.date)) throw badRequest('date must be YYYY-MM-DD')
  if (compareDates(input.date, today) > 0) throw badRequest('date is in the future')
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length > MAX_PHOTO_BYTES) throw new AppError(400, 'photo_too_large', 'That photo is too large')
  if (!looksLikeJpeg(input.bytes)) throw new AppError(400, 'not_a_photo', 'That file is not a JPEG photo')

  const stage = (await tx.query<{ buyer_id: string; unit_id: string }>(
    'select buyer_id::text as buyer_id, unit_id::text as unit_id from milestone where order_id = $1 and stage = $2', [input.orderId, input.stage]))[0]
  if (!stage) throw notFound('No such stage for your unit')

  const key = `photos/${randomUUID()}.jpg`
  const made = await tx.query<{ id: string }>(
    `insert into photo (client_uuid, order_id, buyer_id, storage_key, stage, unit_id, taken_on, bytes)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (client_uuid) do nothing returning id::text as id`,
    [input.clientUuid, input.orderId, stage.buyer_id, key, input.stage, stage.unit_id, input.date, input.bytes.length])
  if (made.length) {
    await store.put(key, input.bytes)           // if this throws, the transaction rolls back: no row without a file
    return { id: made[0]!.id, duplicate: false }
  }
  // A repeat. Return the existing photo, but only if it really is this caller's (row-level security filters the read).
  const existing = (await tx.query<{ id: string; order_id: string }>('select id::text as id, order_id::text as order_id from photo where client_uuid = $1', [input.clientUuid]))[0]
  if (!existing || existing.order_id !== input.orderId) throw new AppError(409, 'conflict', 'That upload id is already used')
  return { id: existing.id, duplicate: true }
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

/**
 * Delete the FILES of photos rejected more than `days` ago. The row stays (an update may point at it) and
 * is marked purged, so it simply reads as "not found" from then on. Safe to run again and again.
 */
export async function purgeRejectedPhotos(tx: Tx, ctx: Ctx, store: MediaStore, days: number): Promise<number> {
  if (!isStaff(ctx)) throw forbidden()
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw badRequest('days must be a whole number from 0 to 3650')
  const rows = await tx.query<{ id: string; storage_key: string }>(
    `select id::text as id, storage_key from photo where rejected_at is not null and purged_at is null and rejected_at < now() - make_interval(days => $1::int)`, [days])
  for (const r of rows) {
    await store.delete(r.storage_key)
    await tx.query('update photo set purged_at = now() where id = $1', [r.id])
  }
  return rows.length
}

/** Show a photo to its buyer. Withdrawing it later is a reject. A cleaned (purged) photo has no file, so it cannot come back. */
export async function approvePhoto(tx: Tx, ctx: Ctx, userId: string, id: string): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  if (!UUID.test(String(id)) || !UUID.test(String(userId))) throw badRequest('Invalid request')
  const before = (await tx.query<{ approved: boolean }>('select approved_by is not null as approved from photo where id = $1', [id]))[0]
  const done = await tx.query<{ order_id: string; stage: string | null }>(
    'update photo set approved_by = $2, approved_at = now(), rejected_at = null where id = $1 and purged_at is null returning order_id::text as order_id, stage', [id, userId])
  if (!done.length) throw notFound('No such photo')
  if (before?.approved) return   // approving again changes nothing, so it tells nobody anything
  // Mocked alert to the buyer's contact, in this same transaction. Says only that a photo is ready.
  const o = (await tx.query<{ po: string; buyer_name: string }>(
    'select o.po, b.name as buyer_name from orders o join buyer b on b.id = o.buyer_id where o.id = $1', [done[0]!.order_id]))[0]
  if (o) await writeOutbox(tx, { channel: 'email', recipientKind: 'buyer', recipient: o.buyer_name, subject: `New photo for PO ${o.po}`, body: photoAlertBody(o.po, done[0]!.stage), orderId: done[0]!.order_id })
}

export async function rejectPhoto(tx: Tx, ctx: Ctx, id: string): Promise<void> {
  if (!isStaff(ctx)) throw forbidden()
  if (!UUID.test(String(id))) throw badRequest('Invalid request')
  const done = await tx.query('update photo set rejected_at = now(), approved_by = null, approved_at = null where id = $1 returning id', [id])
  if (!done.length) throw notFound('No such photo')
}

/**
 * A buyer's photo: only an approved, not-withdrawn photo of THIS buyer. The conditions are stated here
 * as well as in the database policy, so a mistake in either one alone would not leak a photo.
 */
export async function getBuyerPhotoBytes(tx: Tx, store: MediaStore, buyerId: string, id: string): Promise<Buffer> {
  if (!UUID.test(String(id))) throw notFound('No such photo')
  const row = (await tx.query<{ storage_key: string }>(
    'select storage_key from photo where id = $1 and buyer_id = $2 and approved_by is not null and rejected_at is null and purged_at is null', [id, buyerId]))[0]
  const bytes = row ? await store.get(row.storage_key) : null
  if (!bytes) throw notFound('No such photo')
  return bytes
}

/**
 * The bytes of one photo. Which photos the caller may read is decided by row-level security (staff:
 * all; a supervisor: their unit's; a buyer: only their own APPROVED ones), so a photo the caller
 * may not see is simply "not found", the same answer as one that does not exist.
 */
export async function getPhotoBytes(tx: Tx, store: MediaStore, id: string): Promise<Buffer> {
  if (!UUID.test(String(id))) throw notFound('No such photo')
  const row = (await tx.query<{ storage_key: string }>('select storage_key from photo where id = $1', [id]))[0]
  const bytes = row ? await store.get(row.storage_key) : null
  if (!bytes) throw notFound('No such photo')
  return bytes
}
