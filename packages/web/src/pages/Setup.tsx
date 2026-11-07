import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError, apiFetch, getClaims } from '../api/session'
import { AlertsTab } from '../setup/AlertsTab'
import { DaysTab } from '../setup/DaysTab'
import { PeopleTab } from '../setup/PeopleTab'
import { purgeDays } from '../setup/setupLogic'
import { TemplatesTab } from '../setup/TemplatesTab'
import { AppBar } from '../ui/AppBar'

const TABS = [['people', 'People'], ['days', 'Closed days'], ['templates', 'Templates'], ['alerts', 'Alerts'], ['housekeeping', 'Housekeeping']] as const
type Tab = (typeof TABS)[number][0]

/** The things that have to be set up before the pilot: who can sign in, when each unit is closed, and the stage lists. */
export default function Setup() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find(([id]) => id === params.get('tab'))?.[0] ?? 'people') as Tab
  const me = getClaims()?.sub
  // Plain buttons with aria-current, not the ARIA tabs pattern: each section is a page of its own with its own h2.
  // After a change focus moves to that h2, so a keyboard or screen-reader user lands on the new section, never on <body>.
  const panel = useRef<HTMLDivElement>(null)
  const changed = useRef(false)
  useEffect(() => {
    if (!changed.current) return
    changed.current = false
    const h = panel.current?.querySelector<HTMLElement>('h2')
    if (h) { h.tabIndex = -1; h.focus() }
  }, [tab])

  return (
    <>
      <AppBar title="Setup" />
      <main className="page page--form">
        <nav className="seg seg--tabs" aria-label="Setup sections">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" aria-current={tab === id ? 'true' : undefined} className="seg__btn"
              onClick={() => { if (id !== tab) { changed.current = true; setParams({ tab: id }) } }}>{label}</button>
          ))}
        </nav>
        <div ref={panel}>
          {tab === 'people' && <PeopleTab meId={me} />}
          {tab === 'days' && <DaysTab />}
          {tab === 'templates' && <TemplatesTab />}
          {tab === 'alerts' && <AlertsTab />}
          {tab === 'housekeeping' && <Housekeeping />}
        </div>
      </main>
    </>
  )
}

function Housekeeping() {
  const [days, setDays] = useState('7')
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function purge(e: React.FormEvent) {
    e.preventDefault(); setError(null); setResult(null)
    const n = purgeDays(days)
    if (n === null) return setError('Enter a whole number of days, from 0 to 3650.')
    try {
      const r = await apiFetch<{ purged: number }>('/api/photos/purge', { method: 'POST', body: JSON.stringify({ days: n }) })
      setResult(r.purged === 0 ? 'No photos were old enough to clear.' : `Cleared the files of ${r.purged} rejected photo${r.purged === 1 ? '' : 's'}.`)
    } catch (err) { setError(err instanceof ApiError ? err.message : 'That did not work. Please try again.') }
  }
  return (
    <>
      <h2>Housekeeping</h2>
      <form className="card change" onSubmit={purge} noValidate>
        <p>Photos you reject are kept for a while, then their files can be cleared to save space. Photos that are waiting or approved are never cleared.</p>
        <label className="field"><span>Clear files of photos rejected more than this many days ago</span>
          <input className="input mono" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        {result && <p className="notice-box" role="status">{result}</p>}
        <button className="btn btn--primary">Clear old rejected photos</button>
      </form>
    </>
  )
}
