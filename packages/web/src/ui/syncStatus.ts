import type { T } from '../i18n'
import type { QueueState } from '../queue/controller'

/** What the sync chip says, with no React: kept apart so the rules can be tested. */
export function syncChipStatus(state: QueueState, t: T): { text: string; tone: 'ok' | 'wait' | 'problem' } {
  const { pending, syncing, online, error } = state
  if (error === 'auth' && pending > 0) return { text: t('sync.signInAgain', { n: pending }), tone: 'problem' }
  if (!online && pending > 0) return { text: t('sync.offlineWaiting', { n: pending }), tone: 'wait' }
  if (!online) return { text: t('sync.offline'), tone: 'wait' }
  if (syncing) return { text: t('sync.sendingWaiting', { n: pending }), tone: 'wait' }
  // The first failure is usually a reply lost on the way back, and the phone is already trying again: say so calmly. From the second one
  // in a row it is worth the honest "could not send" (FE-S-06).
  if (pending > 0 && error && (state.failedTries ?? 0) < 2) return { text: t('sync.retrying', { n: pending }), tone: 'wait' }
  if (pending > 0 && error) return { text: t('sync.waitingFailed', { n: pending }), tone: 'problem' }
  if (pending > 0) return { text: t('sync.waitingN', { n: pending }), tone: 'wait' }
  // A refused update is not waiting, but it was not sent either: never "All sent" while one is left.
  if (state.rejected.length > 0) return { text: t('sync.refusedCount', { n: state.rejected.length }), tone: 'problem' }
  return { text: t('sync.allSent'), tone: 'ok' }
}
