import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, apiFetch } from '../api/session'
import { Banner } from '../ui/atoms/Banner'
import { Button } from '../ui/atoms/Button'
import { Card } from '../ui/atoms/Card'
import { DateWords } from '../ui/atoms/DateWords'
import { Input, Select } from '../ui/atoms/Input'
import { Field } from '../ui/molecules/Field'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import { dateWithYear } from '../board/boardLogic'
import { isRealDate } from '../orders/orderForm'
import { LoadFailed } from '../ui/LoadFailed'
import { useConfirm } from '../ui/ConfirmDialog'
import { clearDayBody, dayBody, dayKind, latestRequest } from './setupLogic'

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
  const [loadFail, setLoadFail] = useState<LoadFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { confirm, dialog } = useConfirm()

  const loadUnits = useCallback(() => {
    apiFetch<{ units: Unit[] }>('/api/units').then((r) => { setUnits(r.units); setUnitId((cur) => cur || r.units[0]?.id || ''); setLoadFail(null) })
      .catch((e) => setLoadFail(describeFailure(e, 'Could not load the units.')))
  }, [])
  useEffect(loadUnits, [loadUnits])
  const latest = useRef(latestRequest())
  const load = useCallback(async () => {
    const current = latest.current.start()
    if (!unitId) return
    try { const r = await apiFetch<{ days: Day[] }>(`/api/calendar?unitId=${unitId}`); if (!current()) return; setDays(r.days); setError(null); setLoadFail(null) } catch (e) { if (current()) setLoadFail(describeFailure(e, 'Could not load the closed days.')) }
  }, [unitId])
  useEffect(() => { setDays(null); void load() }, [load])

  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null); setNotice(null)
    if (!isRealDate(date)) return setError('Choose a real date.')
    try {
      await apiFetch('/api/calendar', { method: 'POST', body: JSON.stringify(dayBody({ unitId, date, working, note, existing: days?.find((x) => x.date === date) })) })
      setNotice(`${dateWithYear(date)} is now ${working ? 'a worked day' : 'closed'} for this unit. Orders already created keep their planned dates; the board uses the new working days from now on.`)
      setDate(''); setNote(''); await load()
    } catch (err) { setError(msg(err)) }
  }
  async function clear(d: Day) {
    // The working days behind every board rate change with this, so it asks (FE-M-04).
    if (!(await confirm({
      title: 'Back to the normal week?',
      body: `${dateWithYear(d.date)} stops being a special day for this unit. Orders keep their planned dates, but the board counts the working days again, so the daily rates it shows can change.`,
      confirmLabel: 'Back to normal', cancelLabel: 'Keep this day', destructive: true,
    }))) return
    try { await apiFetch('/api/calendar/clear', { method: 'POST', body: JSON.stringify(clearDayBody(d)) }); setNotice(`${dateWithYear(d.date)} is back to the normal week.`); await load() } catch (err) { setError(msg(err)) }
  }

  return (
    <>
      <h2>Closed days</h2>
      <p className="sub">Sundays are closed by default. Add holidays (Deepavali, a power shutdown) or an extra day worked. Each unit has its own calendar, so a subcontractor can close on different days.</p>
      {error && <Banner>{error}</Banner>}
      {loadFail && <LoadFailed unreachable={loadFail.unreachable} message={loadFail.message} onRetry={() => (units.length ? void load() : loadUnits())} />}
      {notice && <p className="notice-box" role="status">{notice}</p>}
      <Field label="Unit">
        <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>

      <Card as="form" className="change" onSubmit={save} noValidate>
        <div className="grid3">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /><DateWords iso={date} /></Field>
          <Field label="That day is">
            <Select value={working ? 'yes' : 'no'} onChange={(e) => setWorking(e.target.value === 'yes')}>
              <option value="no">Closed</option><option value="yes">Worked (an extra day)</option></Select></Field>
          <Field label="Note (optional)"><Input value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <Button variant="primary" disabled={!unitId}>Save day</Button>
      </Card>

      {days && days.length === 0 && <p className="sub">This unit follows the normal week: no special days are set.</p>}
      {days && days.length > 0 && (
        <table className="plan">
          <thead><tr><th scope="col">Date</th><th scope="col">Setting</th><th scope="col">Note</th><th scope="col"><span className="visually-hidden">Action</span></th></tr></thead>
          <tbody>{days.map((d) => (
            <tr key={d.date}><td className="mono">{dateWithYear(d.date)}</td><td>{dayKind(d.working)}</td><td>{d.note ?? '-'}</td>
              <td><Button size="small" onClick={() => void clear(d)}>Back to normal</Button></td></tr>
          ))}</tbody>
        </table>
      )}
      {dialog}
    </>
  )
}
