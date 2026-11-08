// The queue's brain: owns the store, decides when to sync, and exposes a stable snapshot for
// the screen. No React and no browser globals are used directly (they are passed in), so the
// whole thing runs under test.
import { isMine, syncQueue } from './sync'
import type { DroppedPhoto, NewEvent, QueuedEvent, QueueStore, SendBatch, SyncError, UploadPhoto } from './types'

export interface QueueState {
  pending: number
  /** Waiting under ANOTHER person's sign-in on this phone: they send when that person signs in. */
  foreign: number
  /** Refused updates of the signed-in person only: another person's are never listed or removable here. */
  rejected: QueuedEvent[]
  /** Refused updates of ANOTHER person's sign-in on this phone: shown only as a count. */
  foreignRejected: number
  syncing: boolean
  online: boolean
  /** Why the last sync stopped early, or null. */
  error: SyncError
  /** How many syncs in a row stopped early for a reason that is not a sign-in (a lost reply, no signal, a server fault). 0 after one succeeds. */
  failedTries?: number
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
  /** The signed-in account's id. Updates are stamped with it, and only the author's sign-in sends them. */
  getOwner?: () => string | null
  now?: () => number
  uuid?: () => string
  isOnline?: () => boolean
  /** Waits before the 1st, 2nd, 3rd... automatic retry after a failed sync (the last one repeats). Default 3 s, 8 s, 20 s (FE-S-06). */
  retryDelaysMs?: number[]
}

export function createQueueController(deps: ControllerDeps) {
  const now = deps.now ?? Date.now
  const uuid = deps.uuid ?? (() => crypto.randomUUID())
  const isOnline = deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  let items: QueuedEvent[] = []
  let sentLog: SentRecord[] = []
  // Updates that went without their photo (the server refused it): shown until the supervisor dismisses them.
  let droppedLog: DroppedPhoto[] = []
  let inFlight: Promise<void> | null = null
  // The last sign-in seen. A sign-in that expires just as Send is tapped reads as nobody; the
  // update is still its author's, never left ownerless for whoever signs in next.
  let lastOwner: string | null = null
  const owner = () => { const w = deps.getOwner?.() ?? null; if (w) lastOwner = w; return w }
  let state: QueueState = { pending: 0, foreign: 0, rejected: [], foreignRejected: 0, syncing: false, online: isOnline(), error: null, failedTries: 0, lastSyncedAt: null, durable: deps.store.durable }
  const listeners = new Set<() => void>()
  // After a failed sync the phone tries again by itself within seconds, not only on the 30 s timer: a reply lost on the way back is the
  // common case, and the server already has the update (the same id is stored once), so the quick second try only confirms it (FE-S-06).
  const retryDelays = deps.retryDelaysMs && deps.retryDelaysMs.length ? deps.retryDelaysMs : [3_000, 8_000, 20_000]
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  const stopRetry = () => { if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null } }
  const scheduleRetry = () => {
    if (retryTimer !== null) return
    const ms = retryDelays[Math.min(state.failedTries ?? 0, retryDelays.length) - 1] ?? retryDelays[retryDelays.length - 1]!
    retryTimer = setTimeout(() => { retryTimer = null; void syncNow() }, ms)
  }

  const publish = (patch: Partial<QueueState>) => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }
  const refresh = async () => {
    items = await deps.store.list()
    const me = owner()
    publish({
      pending: items.filter((e) => e.status === 'pending' && isMine(e, me)).length,
      foreign: items.filter((e) => e.status === 'pending' && !isMine(e, me)).length,
      rejected: items.filter((e) => e.status === 'rejected' && isMine(e, me)),
      foreignRejected: items.filter((e) => e.status === 'rejected' && !isMine(e, me)).length,
      online: isOnline(),
    })
  }

  /** Write to storage first; only then is the update "saved". Syncing happens after, and never blocks saving. */
  async function enqueue(e: NewEvent): Promise<QueuedEvent> {
    const { photo, ...rest } = e
    const clientUuid = uuid()
    const who = owner() ?? lastOwner
    const item: QueuedEvent = { ...rest, clientUuid, createdAt: now(), status: 'pending', attempts: 0, ...(who ? { owner: who } : {}), ...(photo ? { photo, photoUuid: uuid() } : {}) }
    await deps.store.add(item)
    await refresh()
    void syncNow()
    return item
  }

  /** One sync at a time. A call while one is running joins it instead of starting a second. */
  function syncNow(): Promise<void> {
    if (inFlight) return inFlight
    let again = false
    inFlight = (async () => {
      await refresh()
      if (!state.pending) { publish({ error: null }); return }
      if (!isOnline()) { publish({ online: false }); return }
      publish({ syncing: true, online: true })
      try {
        const who = owner()
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
        }, deps.uploadPhoto, who, deps.getOwner ? owner : undefined)
        if (out.droppedPhotos) droppedLog = [...droppedLog, ...out.droppedPhotos].slice(-20)
        await refresh()
        // Someone else signed in mid-sync: the sync stopped with the first person's updates still
        // waiting. That is not a problem to show; start again for whoever is signed in now. (Only
        // signed out: the 'auth' stop stands, and the next sign-in starts a sync.)
        again = owner() !== who && owner() !== null
        const failed = !again && out.error !== null && out.error !== 'auth'
        publish({ syncing: false, error: again ? null : out.error, failedTries: failed ? (state.failedTries ?? 0) + 1 : 0, lastSyncedAt: out.error ? state.lastSyncedAt : now() })
        if (failed && state.pending > 0) scheduleRetry(); else stopRetry()
      } catch {
        await refresh()
        publish({ syncing: false, error: 'server', failedTries: (state.failedTries ?? 0) + 1 })
        if (state.pending > 0) scheduleRetry()
      }
    })().finally(() => { inFlight = null; if (again) void syncNow() })
    return inFlight
  }

  /** Only the author (or anyone, for an update with no recorded author) may remove a refused update. */
  async function discard(clientUuid: string) {
    const it = items.find((e) => e.clientUuid === clientUuid)
    if (it && !isMine(it, owner())) return
    await deps.store.remove([clientUuid])
    await refresh()
  }

  /** Waiting pieces for one stage and day, so the screen can show "today so far" including what is not sent yet. */
  const waitingQty = (orderId: string, stage: string, date: string): number =>
    items.filter((e) => e.status === 'pending' && isMine(e, owner()) && e.orderId === orderId && e.stage === stage && e.date === date).reduce((s, e) => s + e.qty, 0)

  /** Pieces the server accepted AFTER a given moment: not yet visible in a list fetched before then. */
  const sentSince = (orderId: string, stage: string, date: string, sinceMs: number): number =>
    sentLog.filter((e) => e.orderId === orderId && e.stage === stage && e.date === date && e.sentAt >= sinceMs).reduce((s, e) => s + e.qty, 0)

  /** What became of one update: still waiting, refused by the server, confirmed sent, or unknown (discarded). */
  const statusOf = (clientUuid: string): 'pending' | 'rejected' | 'sent' | null => {
    const it = items.find((e) => e.clientUuid === clientUuid)
    if (it) return it.status
    return sentLog.some((e) => e.clientUuid === clientUuid) ? 'sent' : null
  }

  /** Why this update's photo was left out when its pieces were sent, or null. */
  const photoNoteOf = (clientUuid: string): string | null => droppedLog.find((d) => d.clientUuid === clientUuid)?.note ?? null
  const droppedPhotos = (): DroppedPhoto[] => droppedLog
  const clearDroppedPhotos = () => { droppedLog = []; publish({}) }

  return {
    enqueue, syncNow, discard, refresh, waitingQty, sentSince, statusOf, photoNoteOf, droppedPhotos, clearDroppedPhotos,
    getState: () => state,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
    setOnline: (online: boolean) => publish({ online }),
  }
}

export type QueueController = ReturnType<typeof createQueueController>
