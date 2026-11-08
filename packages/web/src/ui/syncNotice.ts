export type SyncTone = 'ok' | 'wait' | 'problem'

/** How long the chip stays marked after its state changes. */
export const NOTICE_MS = 1600

/**
 * Should the sync chip draw attention to itself (UI/UX plan, slice 4.4)? Only when its tone changes, for example "3 waiting" to "All sent":
 * the moment a supervisor looks for. Never on the first look, and not while the count just goes down inside the same tone.
 */
export function noticeFor(previous: SyncTone | null, next: SyncTone): boolean {
  return previous !== null && previous !== next
}
