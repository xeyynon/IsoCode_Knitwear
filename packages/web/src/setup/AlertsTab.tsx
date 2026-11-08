import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../api/session'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import { Card } from '../ui/atoms/Card'
import { LoadFailed } from '../ui/LoadFailed'
import { Loading } from '../ui/Loading'
import { alertTime, channelLabel, recipientLabel } from './alertLogic'

interface Alert {
  id: string; channel: 'email' | 'whatsapp'; recipientKind: 'buyer' | 'merchandiser'; recipient: string
  subject: string; body: string; po: string | null; createdAt: string
}

/** What the system would have emailed or sent on WhatsApp. A demo: nothing is sent, the list only records it. */
export function AlertsTab() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null)
  const [error, setError] = useState<LoadFailure | null>(null)
  const load = useCallback(async () => {
    try { setAlerts((await apiFetch<{ alerts: Alert[] }>('/api/outbox')).alerts); setError(null) }
    catch (e) { setError(describeFailure(e, 'Could not load the alerts.')) }
  }, [])
  useEffect(() => { void load() }, [load])

  return (
    <>
      <h2>Alerts (not sent: demo)</h2>
      <p className="sub">When a warning is confirmed for a buyer, a stage turns red, or a photo is approved, the alert that would go out is written here. Nothing is sent to anyone. The latest 50 are shown, newest first.</p>
      {error && <LoadFailed unreachable={error.unreachable} message={error.message} onRetry={() => void load()} />}
      {!error && alerts === null && <Loading />}
      {alerts && alerts.length === 0 && <Card as="div"><p>No alerts yet. They appear here when a warning is confirmed, a stage turns red or a photo is approved.</p></Card>}
      {alerts && alerts.length > 0 && (
        <ul className="plain stagelist alerts">
          {alerts.map((a) => (
            <Card as="li" key={a.id} className="alert">
              <div className="alert__head">
                <b>{a.subject}</b>
                <span className="alert__when mono">{alertTime(a.createdAt)}</span>
              </div>
              <p className="alert__to">{channelLabel(a.channel)} to {recipientLabel(a.recipientKind, a.recipient)}</p>
              <p className="alert__body">{a.body}</p>
            </Card>
          ))}
        </ul>
      )}
    </>
  )
}
