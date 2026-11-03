// The queue's brain: owns the store, decides when to sync, and exposes a stable snapshot for
// the screen. No React and no browser globals are used directly (they are passed in), so the
// whole thing runs under test.
import { syncQueue } from './sync'
import type { NewEvent, QueuedEvent, QueueStore, SendBatch, SyncError, UploadPhoto } from './types'

export interface QueueState {
  pending: number
  rejected: QueuedEvent[]
  syncing: boolean
  online: boolean
  /** Why the last sync stopped early, or null. */
  error: SyncError
  lastSyncedAt: number | null
  /** The queue is memory-only: updates would be lost if the app closes. Must be shown to the user. */
  durable: boolean
}

export interface SentRecord { clientUuid: string; orderId: string; stage: string; date: string; qty: number; sentAt: number }

export interface ControllerDeps {
  store: QueueStore
  send: SendBatch
  /** Uploads a photo before its update is sent. Left out, a queued photo simply stays with its update. */
  uploadPhoto?: UploadPhoto
  now?: () => number
  uuid?: () => string
  isOnline?: () => boolean
}

export function createQueueController(deps: ControllerDeps) {
  const now = deps.now ?? Date.now
  const uuid = deps.uuid ?? (() => crypto.randomUUID())
  const isOnline = deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  let items: QueuedEvent[] = []
  let sentLog: SentRecord[] = []
  let inFlight: Promise<void> | null = null
  let state: QueueState = { pending: 0, rejected: [], syncing: false, online: isOnline(), error: null, lastSyncedAt: null, durable: deps.store.durable }
  const listeners = new Set<() => void>()

  const publish = (patch: Partial<QueueState>) => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }
  const refresh = async () => {
    items = await deps.store.list()
    publish({
      pending: items.filter((e) => e.status === 'pending').length,
      rejected: items.filter((e) => e.status === 'rejected'),
      online: isOnline(),
    })
  }

  /** Write to storage first; only then is the update "saved". Syncing happens after, and never blocks saving. */
  async function enqueue(e: NewEvent): Promise<QueuedEvent> {
    const { photo, ...rest } = e
    const clientUuid = uuid()
    const item: QueuedEvent = { ...rest, clientUuid, createdAt: now(), status: 'pending', attempts: 0, ...(photo ? { photo, photoUuid: uuid() } : {}) }
    await deps.store.add(item)
    await refresh()
    void syncNow()
    return item
  }

  /** One sync at a time. A call while one is running joins it instead of starting a second. */
  function syncNow(): Promise<void> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      await refresh()
      if (!state.pending) { publish({ error: null }); return }
      if (!isOnline()) { publish({ online: false }); return }
      publish({ syncing: true, online: true })
      try {
        const out = await syncQueue(deps.store, async (batch) => {
          const r = await deps.send(batch)
          const t = now()
          for (const res of r.results) {
            if (res.result === 'rejected') continue
            const src = batch.find((b) => b.clientUuid === res.clientUuid)
            if (src) sentLog.push({ ...src, sentAt: t })
          }
          sentLog = sentLog.slice(-200)
          return r
        }, deps.uploadPhoto)
        await refresh()
        publish({ syncing: false, error: out.error, lastSyncedAt: out.error ? state.lastSyncedAt : now() })
      } catch {
        await refresh()
        publish({ syncing: false, error: 'server' })
      }
    })().finally(() => { inFlight = null })
    return inFlight
  }

  async function discard(clientUuid: string) {
    await deps.store.remove([clientUuid])
    await refresh()
  }

  /** Waiting pieces for one stage and day, so the screen can show "today so far" including what is not sent yet. */
  const waitingQty = (orderId: string, stage: string, date: string): number =>
    items.filter((e) => e.status === 'pending' && e.orderId === orderId && e.stage === stage && e.date === date).reduce((s, e) => s + e.qty, 0)

  /** Pieces the server accepted AFTER a given moment: not yet visible in a list fetched before then. */
  const sentSince = (orderId: string, stage: string, date: string, sinceMs: number): number =>
    sentLog.filter((e) => e.orderId === orderId && e.stage === stage && e.date === date && e.sentAt >= sinceMs).reduce((s, e) => s + e.qty, 0)

  return {
    enqueue, syncNow, discard, refresh, waitingQty, sentSince,
    getState: () => state,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
    setOnline: (online: boolean) => publish({ online }),
  }
}

export type QueueController = ReturnType<typeof createQueueController>
