import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError, apiFetch, getClaims } from '../api/session'
import { AlertsTab } from '../setup/AlertsTab'
import { DaysTab } from '../setup/DaysTab'
import { PeopleTab } from '../setup/PeopleTab'
import type { SetupTab } from '../setup/setupChecklist'
import { purgeDays } from '../setup/setupLogic'
import { TemplatesTab } from '../setup/TemplatesTab'
import { useSetupChecklist } from '../setup/useSetupChecklist'
import { AppBar } from '../ui/AppBar'
import { SetupChecklist } from '../ui/organisms/SetupChecklist'

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
  // A request to move focus names the section it is for, and waits for it: the route can catch up a render after the click, and a
  // focus request that fires on the old section would be lost when that section goes. A checklist link can also name a part of the
  // section (the unit form on People): focus goes there, else to the section's heading.
  const pending = useRef<{ tab: Tab; anchor: string | null } | null>(null)
  const [jumps, setJumps] = useState(0)
  const checklist = useSetupChecklist(tab)
  useEffect(() => {
    const p = pending.current
    if (!p || p.tab !== tab) return
    pending.current = null
    const target = p.anchor ? document.getElementById(p.anchor) : null
    const h = target ?? panel.current?.querySelector<HTMLElement>('h2')
    if (h) { h.tabIndex = -1; h.focus(); if (target) target.scrollIntoView({ block: 'start' }) }
  }, [tab, jumps])
  const goTo = (section: SetupTab, at?: string) => { pending.current = { tab: section, anchor: at ?? null }; setJumps((n) => n + 1) }

  return (
    <>
      <AppBar title="Setup" />
      <main className="page page--form">
        <SetupChecklist result={checklist.result} failure={checklist.failure} onRetry={checklist.reload} onGo={goTo} />
        <nav className="seg seg--tabs" aria-label="Setup sections">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" aria-current={tab === id ? 'true' : undefined} className="seg__btn"
              onClick={() => { if (id !== tab) { pending.current = { tab: id, anchor: null }; setParams({ tab: id }) } }}>{label}</button>
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
