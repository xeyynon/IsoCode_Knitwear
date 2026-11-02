import type { QueueStore, QueuedEvent, SendBatch, SyncError, SyncOutcome } from './types'

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
 */
export async function syncQueue(store: QueueStore, send: SendBatch): Promise<SyncOutcome> {
  const pending = (await store.list()).filter((e) => e.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)
  let sent = 0
  let rejected = 0
  let error: SyncError = null

  for (let i = 0; i < pending.length && !error; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE)
    let results
    try {
      ;({ results } = await send(batch.map(({ clientUuid, orderId, stage, date, qty }) => ({ clientUuid, orderId, stage, date, qty }))))
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
