// The one queue for the whole app, created on first use. It prefers IndexedDB; if the browser
// refuses, it falls back to memory AND marks itself not durable so the screen says so.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { apiFetch, getClaims, subscribe as onSession, snapshot as sessionSnapshot } from '../api/session'
import { createQueueController, type QueueController, type QueueState } from './controller'
import { createIdbStore, type IdbStore } from './idbStore'
import { memoryStore } from './sync'
import type { BatchItemResult, SendBatch, UploadPhoto } from './types'

const SYNC_EVERY_MS = 30_000

const send: SendBatch = (events) => apiFetch<{ results: BatchItemResult[] }>('/api/events/batch', { method: 'POST', body: JSON.stringify({ events }) })

/** One photo as the raw JPEG. Its own id makes a retry return the same photo. */
const uploadPhoto: UploadPhoto = ({ photoUuid, orderId, stage, date, blob }) =>
  apiFetch<{ id: string }>('/api/photos', {
    method: 'POST', body: blob,
    headers: { 'content-type': 'image/jpeg', 'x-client-uuid': photoUuid, 'x-order-id': orderId, 'x-stage': encodeURIComponent(stage), 'x-date': date },
  })

export interface Queue { ctl: QueueController; idb: IdbStore | null }
let started: Promise<Queue> | null = null

export function getQueue(): Promise<Queue> {
  started ??= (async () => {
    let idb: IdbStore | null = null
    try { idb = await createIdbStore() } catch { /* fall back to memory; the screen warns */ }
    const ctl = createQueueController({ store: idb ?? memoryStore(false), send, uploadPhoto, getOwner: () => getClaims()?.sub ?? null })
    await ctl.refresh()

    // When to try sending: opening the app, the signal returning, the app coming back to the
    // front, signing in again, and every 30 s while something is waiting.
    const go = () => { void ctl.syncNow() }
    window.addEventListener('online', go)
    window.addEventListener('offline', () => ctl.setOnline(false))
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') go() })
    let lastToken = sessionSnapshot()
    onSession(() => { const t = sessionSnapshot(); if (t && t !== lastToken) go(); lastToken = t })
    window.setInterval(() => { if (document.visibilityState === 'visible' && ctl.getState().pending > 0) go() }, SYNC_EVERY_MS)
    go()
    return { ctl, idb }
  })()
  return started
}

/** The queue once it has opened (null for a moment on first load). */
export function useQueue(): { queue: Queue | null; state: QueueState | null } {
  const [queue, setQueue] = useState<Queue | null>(null)
  useEffect(() => { let live = true; void getQueue().then((q) => { if (live) setQueue(q) }); return () => { live = false } }, [])
  const state = useSyncExternalStore(
    queue ? queue.ctl.subscribe : noopSubscribe,
    queue ? queue.ctl.getState : () => null,
  )
  return { queue, state }
}
const noopSubscribe = () => () => undefined
