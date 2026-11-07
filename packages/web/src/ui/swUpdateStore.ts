// Registers the service worker and tells the banner when a new version is waiting. Nothing
// here reloads the page by itself: only applyUpdate(), called from the banner's Reload button.
import { isUpdateWaiting, shouldCheckForUpdate, shouldReloadOnTakeover } from './swUpdate'

const RELOADED_KEY = 'orders.swReloadAt'

let waiting: ServiceWorker | null = null
let dismissed = false
let asked = false
let reloaded = false
let lastCheckAt: number | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const subscribeUpdate = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const updateWaiting = (): boolean => waiting !== null
export const updateDismissed = (): boolean => dismissed

export function dismissUpdate(): void { dismissed = true; emit() }

/** Test and demo hook: act as if a worker were waiting (a stand-in worker needs only postMessage). */
export function offerUpdate(worker: Pick<ServiceWorker, 'postMessage'>): void { waiting = worker as ServiceWorker; emit() }

/** The person pressed Reload: let the waiting version take over; controllerchange then reloads, once. */
export function applyUpdate(): void {
  if (!waiting) return
  asked = true
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

function readLastReload(): number | null {
  try { return Number(window.sessionStorage.getItem(RELOADED_KEY)) || null } catch { return null }
}

function onControllerChange(): void {
  if (!shouldReloadOnTakeover({ asked, reloadedThisPage: reloaded, lastReloadAt: readLastReload(), now: Date.now() })) return
  reloaded = true
  try { window.sessionStorage.setItem(RELOADED_KEY, String(Date.now())) } catch { /* the in-memory flag still stops a second reload */ }
  window.location.reload()
}

/** Production only (the caller checks). Safe to call once at load. */
export function watchForUpdate(): void {
  const sw = navigator.serviceWorker
  sw.addEventListener('controllerchange', onControllerChange)
  void sw.register('/sw.js').then((reg) => {
    const offer = (w: ServiceWorker) => { waiting = w; emit() }
    if (reg.waiting && isUpdateWaiting(reg.waiting.state, !!sw.controller)) offer(reg.waiting)
    reg.addEventListener('updatefound', () => {
      const w = reg.installing
      w?.addEventListener('statechange', () => { if (isUpdateWaiting(w.state, !!sw.controller)) offer(w) })
    })
    // An app that is never closed never navigates, so the browser would never look for a new version.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !shouldCheckForUpdate(lastCheckAt, Date.now())) return
      lastCheckAt = Date.now()
      void reg.update().catch(() => undefined)
    })
  }).catch(() => undefined)
}
