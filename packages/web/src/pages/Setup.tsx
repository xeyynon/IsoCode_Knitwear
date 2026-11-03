import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, apiFetch, getClaims } from '../api/session'
import { DaysTab } from '../setup/DaysTab'
import { PeopleTab } from '../setup/PeopleTab'
import { TemplatesTab } from '../setup/TemplatesTab'
import { AppBar } from '../ui/AppBar'

const TABS = [['people', 'People'], ['days', 'Closed days'], ['templates', 'Templates'], ['housekeeping', 'Housekeeping']] as const
type Tab = (typeof TABS)[number][0]

/** The things that have to be set up before the pilot: who can sign in, when each unit is closed, and the stage lists. */
export default function Setup() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find(([id]) => id === params.get('tab'))?.[0] ?? 'people') as Tab
  const me = getClaims()?.sub

  return (
    <>
      <AppBar title="Setup" />
      <main className="page page--form">
        <Link className="link back" to="/board">← Order board</Link>
        <div className="seg seg--tabs" role="tablist" aria-label="Setup sections">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className="seg__btn" onClick={() => setParams({ tab: id })}>{label}</button>
          ))}
        </div>
        {tab === 'people' && <PeopleTab meId={me} />}
        {tab === 'days' && <DaysTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'housekeeping' && <Housekeeping />}
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
    const n = Number(days)
    if (!Number.isInteger(n) || n < 0 || n > 3650) return setError('Enter a whole number of days.')
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
