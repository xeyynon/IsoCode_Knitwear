import { useLang } from '../i18n'
import type { QueueController, QueueState } from '../queue/controller'

/**
 * "3 waiting" / "All sent": the supervisor's proof that their work is safe. It never says
 * "sent" until the server has confirmed it, and a failure is shown, not hidden.
 * Neutral colours only: red, amber and green are reserved for order status.
 */
export function SyncChip({ state, ctl }: { state: QueueState; ctl: QueueController }) {
  const { t } = useLang()
  const { pending, rejected, syncing, online, error } = state

  let text: string
  let tone: 'ok' | 'wait' | 'problem' = 'wait'
  if (error === 'auth' && pending > 0) { text = `Sign in again to send ${pending} waiting`; tone = 'problem' }
  else if (!online && pending > 0) text = `${t('sync.offline')} · ${pending} ${t('sync.waiting')}`
  else if (!online) text = t('sync.offline')
  else if (syncing) text = `Sending… ${pending} ${t('sync.waiting')}`
  else if (pending > 0 && error) { text = `${pending} ${t('sync.waiting')} · could not send`; tone = 'problem' }
  else if (pending > 0) text = `${pending} ${t('sync.waiting')}`
  else { text = t('sync.allSent'); tone = 'ok' }

  return (
    <div className="syncbar">
      <span className={`sync sync--${tone}`} role="status" aria-live="polite">
        <span className="sync__dot" aria-hidden="true" />
        {text}
      </span>
      {pending > 0 && online && !syncing && (
        <button className="btn btn--small" onClick={() => void ctl.syncNow()}>Try now</button>
      )}
      {rejected.length > 0 && <span className="sync sync--problem">{rejected.length} need{rejected.length === 1 ? 's' : ''} attention</span>}
    </div>
  )
}
