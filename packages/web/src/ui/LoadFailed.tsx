import { Link } from 'react-router-dom'
import { useLang } from '../i18n'

interface Props {
  /** The cause is the connection (see isUnreachable): show the one calm "cannot reach the server" card. */
  unreachable: boolean
  /** Shown instead when the server answered but refused or failed. Already in the reader's language. */
  message: string
  onRetry: () => void
  /** Supervisor screens: also say that what is saved on this phone is safe. */
  workSafe?: boolean
  /** Buyers must not be sent to the internal status page. */
  statusLink?: boolean
}

/** One state for a failed load, so no screen invents its own. Neutral colours: a lost connection is not an order status. */
export function LoadFailed({ unreachable, message, onRetry, workSafe = false, statusLink = true }: Props) {
  const { t } = useLang()
  return (
    <div className={`card loadfailed${unreachable ? ' loadfailed--offline' : ''}`} role="alert">
      <p className="loadfailed__text">{unreachable ? t('err.cantReach') : message}</p>
      {unreachable && workSafe && <p className="loadfailed__safe">{t('err.workSafe')}</p>}
      <div className="loadfailed__actions">
        <button type="button" className="btn" onClick={onRetry}>{t('err.retry')}</button>
        {unreachable && statusLink && <Link className="link" to="/status">{t('err.checkStatus')}</Link>}
      </div>
    </div>
  )
}
