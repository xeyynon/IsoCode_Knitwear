import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../api/session'
import { Loading } from '../ui/Loading'
import { BUILD_LABEL } from '../release/buildInfo'
import { checkedText } from '../statusRules'

interface Check { name: string; state: 'up' | 'down'; ms?: number }
interface StatusBody { ok: boolean; checkedAt: string; checks: Check[] }

/** Public: no sign-in. Tells "the backend is down" apart from "there is no data". Plain names and states only. */
export default function Status() {
  const [body, setBody] = useState<StatusBody | null>(null)
  const [unreachable, setUnreachable] = useState(false)

  useEffect(() => {
    let live = true
    const run = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status`)
        if (!res.ok) throw new Error('bad status')
        const b = (await res.json()) as StatusBody
        if (live) { setBody(b); setUnreachable(false) }
      } catch { if (live) setUnreachable(true) }
    }
    void run()
    const id = window.setInterval(run, 60_000)
    return () => { live = false; window.clearInterval(id) }
  }, [])

  const headline = unreachable ? 'Cannot reach the server' : !body ? 'Checking…' : body.ok ? 'Everything is working' : 'Some parts are not working'
  return (
    <main className="page page--narrow">
      <h1>System status</h1>
      {/* aria-live covers the headline only, so a screen reader is not interrupted every minute. */}
      <p className="status-headline" role="status" aria-live="polite">{headline}</p>
      {!body && !unreachable && <Loading label="Checking" />}
      {body && (
        <ul className="checks">
          {body.checks.map((c) => (
            <li key={c.name}><span>{c.name}</span><b className={c.state === 'up' ? 'ok' : 'bad'}>{c.state === 'up' ? 'Up' : 'Down'}</b></li>
          ))}
        </ul>
      )}
      {body && <p className="sub">{checkedText(body.checkedAt)}</p>}
      {BUILD_LABEL && <p className="sub">{BUILD_LABEL}</p>}
      {/* Not a dead end: the app opens on the right place for whoever is signed in, or on the sign-in. */}
      <p><Link to="/">← Back to the app</Link></p>
    </main>
  )
}
