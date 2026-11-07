import { plural, useLang } from '../i18n'
import type { QueueController, QueueState } from '../queue/controller'
import { syncChipStatus } from './syncStatus'

/**
 * "3 waiting" / "All sent": the supervisor's proof that their work is safe. It never says
 * "sent" until the server has confirmed it, and a failure is shown, not hidden.
 * Neutral colours only: red, amber and green are reserved for order status.
 */
export function SyncChip({ state, ctl }: { state: QueueState; ctl: QueueController }) {
  const { t, lang } = useLang()
  const { pending, rejected, syncing, online, foreign, foreignRejected } = state
  const { text, tone } = syncChipStatus(state, t)
  // The main chip already names the refused updates when nothing else is going on.
  const refusedShown = online && !syncing && pending === 0

  return (
    <div className="syncbar">
      <span className={`sync sync--${tone}`} role="status" aria-live="polite">
        <span className="sync__dot" aria-hidden="true" />
        {text}
      </span>
      {pending > 0 && online && !syncing && (
        <button className="btn btn--small" onClick={() => void ctl.syncNow()}>{t('sync.tryNow')}</button>
      )}
      {foreign > 0 && <span className="sync sync--problem">{plural(lang, foreign, 'sync.foreignOne', 'sync.foreignOther')}</span>}
      {foreignRejected > 0 && <span className="sync sync--problem">{t('sync.foreignRejected', { n: foreignRejected })}</span>}
      {rejected.length > 0 && !refusedShown && <span className="sync sync--problem">{plural(lang, rejected.length, 'sync.attentionOne', 'sync.attentionOther')}</span>}
    </div>
  )
}
