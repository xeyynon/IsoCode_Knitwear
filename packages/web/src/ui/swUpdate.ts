// When to tell a supervisor that a new version of the app is ready, and when it is safe to
// reload for it. The new version waits in the browser until the person says so, never before:
// reloading under a half-typed count would throw it away.
export const SW_RELOAD_WINDOW_MS = 60_000
export const SW_CHECK_EVERY_MS = 30 * 60_000

export interface BannerFacts {
  /** A new version is installed and waiting. */
  waiting: boolean
  /** The person closed the banner on this page. */
  dismissed: boolean
  /** A form on screen holds input that has not been saved yet. */
  unsentInput: boolean
  /** Updates are kept in memory only, so a reload would lose them. */
  queueAtRisk: boolean
}

export const showUpdateBanner = (f: BannerFacts): boolean => f.waiting && !f.dismissed && !f.unsentInput && !f.queueAtRisk

/** Queued updates survive a reload only in IndexedDB; the in-memory fallback does not. */
export const queueAtRisk = (durable: boolean, pending: number): boolean => !durable && pending > 0

/** Installed while an older version still runs the page: a real update. The first install has no controller. */
export const isUpdateWaiting = (workerState: string, hasController: boolean): boolean => workerState === 'installed' && hasController

export interface TakeoverFacts {
  /** The person pressed Reload on the banner. */
  asked: boolean
  /** This page already reloaded for an update. */
  reloadedThisPage: boolean
  /** When a reload for an update last happened in this tab (survives the reload), or null. */
  lastReloadAt: number | null
  now: number
}

/** The controller also changes on the very first install and when another tab updates: only reload for our own request, once. */
export const shouldReloadOnTakeover = (f: TakeoverFacts): boolean =>
  f.asked && !f.reloadedThisPage && (f.lastReloadAt === null || f.now - f.lastReloadAt > SW_RELOAD_WINDOW_MS)

/** A phone app that is never closed never navigates, so the browser never looks: ask now and then when the app comes back to the front. */
export const shouldCheckForUpdate = (lastCheckAt: number | null, now: number): boolean => lastCheckAt === null || now - lastCheckAt >= SW_CHECK_EVERY_MS
