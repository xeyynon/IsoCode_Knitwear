import type { QueueStore, QueuedEvent, SendBatch, SyncError, SyncOutcome, UploadPhoto } from './types'

export const BATCH_SIZE = 200   // the server accepts 1 to 200 per request

/** Classify a failed request. Network trouble and server trouble are temporary; a 401 means sign in again. */
export function classifyError(e: unknown): SyncError {
  const status = (e as { status?: number })?.status
  if (status === 401) return 'auth'
  if (status === 0 || status === undefined) return 'network'
  if (status === 429 || status >= 500) return 'server'
  return 'server'
}

/**
 * Send what is waiting, oldest first, in batches.
 *  - accepted or duplicate: the server has it, so it leaves the queue.
 *  - rejected: the server refused it for good (bad stage, wrong unit...). It STAYS, flagged
 *    with the reason, and is never retried by itself: a person decides.
 *  - anything that fails to send leaves the whole batch queued, untouched, to be retried.
 * Nothing is ever dropped without the server's say-so, which is what makes it safe to retry
 * after a lost response.
 *
 * A photo is a first step: it is uploaded (keyed by its own id, so a retry cannot make a second),
 * the update then carries the photo's id, and the local copy is freed. If the server REFUSES a
 * photo for good (not a JPEG, too large), the photo is dropped with a note and the pieces are
 * still sent: a count must never be lost because of a picture.
 */
export async function syncQueue(store: QueueStore, send: SendBatch, upload?: UploadPhoto): Promise<SyncOutcome> {
  let pending = (await store.list()).filter((e) => e.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)
  let sent = 0
  let rejected = 0
  let error: SyncError = null

  if (upload) {
    for (const item of pending) {
      if (error || !item.photo || item.photoId) continue
      try {
        const { id } = await upload({ photoUuid: item.photoUuid ?? item.clientUuid, orderId: item.orderId, stage: item.stage, date: item.date, blob: item.photo })
        await store.update(item.clientUuid, { photoId: id, photo: undefined })
      } catch (e) {
        const kind = classifyError(e)
        const status = (e as { status?: number })?.status ?? 0
        if (kind === 'server' && status >= 400 && status < 500 && status !== 429) {
          await store.update(item.clientUuid, { photo: undefined, photoNote: (e as Error).message || 'The photo was not accepted.' })
        } else { error = kind; await store.update(item.clientUuid, { attempts: item.attempts + 1 }) }
      }
    }
    pending = (await store.list()).filter((e) => e.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)
    if (error) return { sent, rejected, remaining: pending.length, error }
  }

  for (let i = 0; i < pending.length && !error; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE)
    let results
    try {
      ;({ results } = await send(batch.map(({ clientUuid, orderId, stage, date, qty, photoId }) => ({ clientUuid, orderId, stage, date, qty, ...(photoId ? { photoId } : {}) }))))
    } catch (e) {
      error = classifyError(e)
      await Promise.all(batch.map((b) => store.update(b.clientUuid, { attempts: b.attempts + 1 })))
      break
    }
    const byId = new Map(results.map((r) => [r.clientUuid, r]))
    const done: string[] = []
    for (const item of batch) {
      const r = byId.get(item.clientUuid)
      if (!r) continue   // the server said nothing about it: leave it queued and try again
      if (r.result === 'rejected') {
        rejected++
        await store.update(item.clientUuid, { status: 'rejected', reason: r.message ?? 'The server could not accept this update.', attempts: item.attempts + 1 })
      } else {
        sent++
        done.push(item.clientUuid)
      }
    }
    await store.remove(done)
  }

  const remaining = (await store.list()).filter((e) => e.status === 'pending').length
  return { sent, rejected, remaining, error }
}

/** A store that keeps everything in an array. Used by tests, and as a last resort when IndexedDB is unavailable. */
export function memoryStore(durable = false): QueueStore & { items: QueuedEvent[] } {
  const items: QueuedEvent[] = []
  return {
    items,
    durable,
    list: async () => items.map((e) => ({ ...e })),
    add: async (e) => { items.push({ ...e }) },
    remove: async (ids) => { for (const id of ids) { const i = items.findIndex((e) => e.clientUuid === id); if (i >= 0) items.splice(i, 1) } },
    update: async (id, patch) => { const e = items.find((x) => x.clientUuid === id); if (e) Object.assign(e, patch) },
  }
}
