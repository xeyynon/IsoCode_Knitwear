import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiFetch } from '../api/session'
import { shortDate } from '../board/boardLogic'
import { isRealDate } from '../orders/orderForm'
import { dayKind } from './setupLogic'

interface Unit { id: string; name: string }
interface Day { unitId: string; date: string; working: boolean; note: string | null }

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'That did not work. Please try again.')

export function DaysTab() {
  const [units, setUnits] = useState<Unit[]>([])
  const [unitId, setUnitId] = useState('')
  const [days, setDays] = useState<Day[] | null>(null)
  const [date, setDate] = useState('')
  const [working, setWorking] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => { apiFetch<{ units: Unit[] }>('/api/units').then((r) => { setUnits(r.units); if (r.units[0]) setUnitId(r.units[0].id) }).catch((e) => setError(msg(e))) }, [])
  const load = useCallback(async () => {
    if (!unitId) return
    try { setDays((await apiFetch<{ days: Day[] }>(`/api/calendar?unitId=${unitId}`)).days); setError(null) } catch (e) { setError(msg(e)) }
  }, [unitId])
  useEffect(() => { setDays(null); void load() }, [load])

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null); setNotice(null)
    if (!isRealDate(date)) return setError('Choose a real date.')
    try {
      await apiFetch('/api/calendar', { method: 'POST', body: JSON.stringify({ unitId, date, working, note }) })
      setNotice(`${shortDate(date)} is now ${working ? 'a worked day' : 'closed'} for this unit. Orders already created keep their planned dates; the board uses the new working days from now on.`)
      setDate(''); setNote(''); await load()
    } catch (err) { setError(msg(err)) }
  }
  async function clear(d: Day) {
    try { await apiFetch('/api/calendar/clear', { method: 'POST', body: JSON.stringify({ unitId, date: d.date }) }); setNotice(`${shortDate(d.date)} is back to the normal week.`); await load() } catch (err) { setError(msg(err)) }
  }

  return (
    <>
      <h2>Closed days</h2>
      <p className="sub">Sundays are closed by default. Add holidays (Deepavali, a power shutdown) or an extra day worked. Each unit has its own calendar, so a subcontractor can close on different days.</p>
      {error && <p className="banner" role="alert">{error}</p>}
      {notice && <p className="notice-box" role="status">{notice}</p>}
      <label className="field"><span>Unit</span>
        <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>

      <form className="card change" onSubmit={save} noValidate>
        <div className="grid3">
          <label className="field"><span>Date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>That day is</span>
            <select className="input" value={working ? 'yes' : 'no'} onChange={(e) => setWorking(e.target.value === 'yes')}>
              <option value="no">Closed</option><option value="yes">Worked (an extra day)</option></select></label>
          <label className="field"><span>Note (optional)</span><input className="input" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <button className="btn btn--primary" disabled={!unitId}>Save day</button>
      </form>

      {days && days.length === 0 && <p className="sub">This unit follows the normal week: no special days are set.</p>}
      {days && days.length > 0 && (
        <table className="plan">
          <thead><tr><th scope="col">Date</th><th scope="col">Setting</th><th scope="col">Note</th><th scope="col"><span className="visually-hidden">Action</span></th></tr></thead>
          <tbody>{days.map((d) => (
            <tr key={d.date}><td className="mono">{shortDate(d.date)} {d.date.slice(0, 4)}</td><td>{dayKind(d.working)}</td><td>{d.note ?? '-'}</td>
              <td><button className="btn btn--small" onClick={() => void clear(d)}>Back to normal</button></td></tr>
          ))}</tbody>
        </table>
      )}
    </>
  )
}
