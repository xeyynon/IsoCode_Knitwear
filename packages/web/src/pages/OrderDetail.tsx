import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ApiError, apiFetch } from '../api/session'
import { shortDate, type Status } from '../board/boardLogic'
import { isRealDate, slipText } from '../orders/orderForm'
import { AppBar } from '../ui/AppBar'
import { Loading } from '../ui/Loading'
import { StatusBadge } from '../ui/StatusBadge'

interface StageDetail {
  stage: string; sequence: number; unitName: string; qty: number; produced: number; remaining: number; complete: boolean
  status: Status; reasons: string[]; plannedEnd: string; projectedEnd: string | null; maths: string
  madeIsEstimate: boolean; noRecentUpdate: boolean
}
interface HistoryEntry { at: string; by: string | null; what: string; from: string | null; to: string | null; reason: string }
interface Detail {
  order: { id: string; po: string; buyerName: string; style: string; colour: string; sizes: Record<string, number>; qty: number; exFactory: string; status: Status }
  stages: StageDetail[]
  history: HistoryEntry[]
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// Always the factory's time (India), whatever zone the viewer's computer is set to.
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' IST'

export default function OrderDetail() {
  const { id = '' } = useParams()
  const created = (useLocation().state as { created?: boolean } | null)?.created === true
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [changeError, setChangeError] = useState<string | null>(null)
  const [moved, setMoved] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setD(await apiFetch<Detail>(`/api/orders/${id}`)); setError(null) }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load this order.') }
  }, [id])
  useEffect(() => { void load() }, [load])

  async function change(e: React.FormEvent) {
    e.preventDefault()
    setChangeError(null); setMoved(null)
    if (!isRealDate(date)) return setChangeError('Choose the new ex-factory date.')
    if (!reason.trim()) return setChangeError('Give a reason for the change.')
    setBusy(true)
    try {
      const r = await apiFetch<{ exFactory: { old: string; new: string }; milestones: unknown[]; leftAlone: string[] }>(
        `/api/orders/${id}/ex-factory`, { method: 'POST', body: JSON.stringify({ exFactory: date, reason }) })
      setMoved(`Ex-factory moved from ${shortDate(r.exFactory.old)} to ${shortDate(r.exFactory.new)}. ${r.milestones.length} stage date${r.milestones.length === 1 ? '' : 's'} moved with it.${r.leftAlone.length ? ` Left where they were (set by hand): ${r.leftAlone.map(cap).join(', ')}.` : ''}`)
      setDate(''); setReason('')
      await load()
    } catch (err) { setChangeError(err instanceof ApiError ? err.message : 'Could not change the date.') }
    setBusy(false)
  }

  return (
    <>
      <AppBar title={d ? d.order.po : 'Order'} />
      <main className="page page--form">
        <Link className="link back" to="/board">← Order board</Link>
        {!d && !error && <Loading label="Loading order" />}
        {error && <div className="card" role="alert"><p>{error}</p><button className="btn" onClick={() => void load()}>Try again</button></div>}

        {d && (
          <>
            {created && <p className="notice-box" role="status">Order created. Its stage dates were worked out from ex-factory.</p>}
            <section className="card summary">
              <div className="summary__top">
                <h1 className="mono">{d.order.po}</h1>
                <StatusBadge status={d.order.status} />
              </div>
              <p className="sub">{d.order.buyerName} · {d.order.style} · {d.order.colour}</p>
              <p className="summary__nums mono">
                <span>Quantity <b>{d.order.qty.toLocaleString('en-IN')}</b></span>
                <span>Ex-factory <b>{shortDate(d.order.exFactory)}</b></span>
              </p>
              <p className="sub mono">{Object.entries(d.order.sizes).map(([s, q]) => `${s} ${q.toLocaleString('en-IN')}`).join(' · ')}</p>
            </section>

            <h2>Stages</h2>
            <ol className="stagelist plain">
              {d.stages.map((s) => {
                const pct = s.qty ? Math.min(100, Math.round((s.produced / s.qty) * 100)) : 0
                const slip = slipText(s.plannedEnd, s.projectedEnd)
                return (
                  <li key={s.stage} className={`stagecard stagecard--${s.status}`}>
                    <div className="stagecard__top">
                      <b>{cap(s.stage)}</b><span className="sub">{s.unitName}</span><StatusBadge status={s.status} />
                    </div>
                    <div className="bar" role="img" aria-label={`${s.produced} of ${s.qty} pieces made`}><span style={{ width: `${pct}%` }} /></div>
                    <p className="mono sub">{s.produced.toLocaleString('en-IN')} of {s.qty.toLocaleString('en-IN')} pieces</p>
                    <dl className="dates">
                      <div><dt>Plan</dt><dd className="mono">{shortDate(s.plannedEnd)}</dd></div>
                      <div><dt>Projected</dt><dd className="mono">{s.complete ? 'Done' : s.projectedEnd ? shortDate(s.projectedEnd) : 'Not enough data'}{!s.complete && slip ? <span className="sub"> ({slip})</span> : null}</dd></div>
                    </dl>
                    {/* The working behind the colour, always shown. */}
                    <p className="why">{s.maths}</p>
                    {s.madeIsEstimate && <p className="sub flag">The rate is an estimate: fewer than 3 days of updates so far.</p>}
                    {s.noRecentUpdate && <p className="sub flag">No update on the last working day.</p>}
                  </li>
                )
              })}
            </ol>

            <section className="card">
              <details open={moved !== null || changeError !== null}>
                <summary><b>Change the ex-factory date</b></summary>
                <form onSubmit={change} noValidate className="change">
                  <label className="field"><span>New ex-factory date</span>
                    <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
                  <label className="field"><span>Reason (kept in the history)</span>
                    <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></label>
                  {changeError && <p className="error" role="alert">{changeError}</p>}
                  <button className="btn btn--primary" disabled={busy}>{busy ? 'Changing…' : 'Change date'}</button>
                </form>
              </details>
              {moved && <p className="notice-box" role="status">{moved}</p>}
            </section>

            <h2>History of date changes</h2>
            {d.history.length === 0 ? <p className="sub">No dates have been changed on this order.</p> : (
              <table className="plan history">
                <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Change</th><th scope="col">Reason</th></tr></thead>
                <tbody>{d.history.map((h, i) => (
                  <tr key={i}>
                    <td data-label="When">{when(h.at)}<span className="sub">{h.by ?? ''}</span></td>
                    <td data-label="What">{h.what}</td>
                    <td data-label="Change" className="mono">{h.from ? shortDate(h.from) : '-'} → {h.to ? shortDate(h.to) : '-'}</td>
                    <td data-label="Reason">{h.reason}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </>
        )}
      </main>
    </>
  )
}
