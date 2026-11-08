import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '../i18n'
import { useQueue } from '../queue/instance'
import { Button } from './atoms/Button'
import { getBottomSlot, subscribeBottomSlot } from './bottomSlot'
import { applyUpdate, dismissUpdate, subscribeUpdate, updateDismissed, updateWaiting } from './swUpdateStore'
import { queueAtRisk, showUpdateBanner } from './swUpdate'
import { hasUnsentInput, subscribeUnsentInput } from './unsentInput'

/**
 * "A new version is ready." Shown only when a new version is waiting, the person is not in the
 * middle of typing, and a reload cannot lose anything. Pressing Reload is the only thing that
 * swaps the version in.
 */
export function UpdateBanner() {
  const waiting = useSyncExternalStore(subscribeUpdate, updateWaiting)
  // Only look at the queue once there is something to say, so the sign-in screen never starts it.
  return waiting ? <Ready /> : null
}

function Ready() {
  const { t } = useLang()
  const dismissed = useSyncExternalStore(subscribeUpdate, updateDismissed)
  const unsentInput = useSyncExternalStore(subscribeUnsentInput, hasUnsentInput)
  const slot = useSyncExternalStore(subscribeBottomSlot, getBottomSlot)
  const { state } = useQueue()
  // Saved updates are kept in IndexedDB (queue/idbStore.ts), not in the page, so they are still
  // there after the reload and are sent from there. Only the memory-only fallback loses them.
  // Before the queue has opened, say nothing yet.
  if (!state) return null
  if (!showUpdateBanner({ waiting: true, dismissed, unsentInput, queueAtRisk: queueAtRisk(state.durable, state.pending) })) return null
  const bar = (
    <div className="updatebar" role="status">
      <p className="updatebar__text">{t('app.updateReady')}</p>
      <div className="updatebar__actions">
        <Button type="button" variant="primary" onClick={applyUpdate}>{t('app.updateReload')}</Button>
        <Button type="button" onClick={dismissUpdate}>{t('app.updateLater')}</Button>
      </div>
    </div>
  )
  // A screen with a bottom ActionBar (the supervisor's Update) offers a slot inside it: this bar appears exactly when a send has
  // cleared the form, and drawn at the foot of the page it would sit on top of the bar's "Saved ... Sent." line (ui/bottomSlot.ts).
  return slot ? createPortal(bar, slot) : bar
}
