import { useCallback, useEffect, useState } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, apiFetch } from '../api/session'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import { shortDate, type Status } from '../board/boardLogic'
import { BACK_PARAM, backToBoard } from '../orders/orderDetailLogic'
import type { CalendarUnit } from '../orders/timelineLayout'
import { isRealDate, slipText } from '../orders/orderForm'
import { LOW_CONFIDENCE } from '../orders/visitEntry'
import { istDate } from '../dates'
import { pieces } from '../numberFormat'
import { Button } from '../ui/atoms/Button'
import { Card } from '../ui/atoms/Card'
import { DateWords } from '../ui/atoms/DateWords'
import { ErrorText } from '../ui/atoms/ErrorText'
import { Input } from '../ui/atoms/Input'
import { TextLink } from '../ui/atoms/TextLink'
import { Field } from '../ui/molecules/Field'
import { KeyFacts } from '../ui/organisms/KeyFacts'
import { BentoCell, OrderBento } from '../ui/organisms/OrderBento'
import { dateInWords } from '../dateWords'
import { reasonById, usableReasons, type Reason } from '../notes/reasons'
import { MerchandiserShell } from '../ui/templates/MerchandiserShell'
import { LoadFailed } from '../ui/LoadFailed'
import { Loading } from '../ui/Loading'
import { LowConfidence } from '../ui/LowConfidence'
import { VisitEntryForm } from '../ui/VisitEntryForm'
import { StageTimeline } from '../ui/StageTimeline'
import { StatusBadge } from '../ui/StatusBadge'

interface StageDetail {
  stage: string; sequence: number; unitId: string; unitName: string; qty: number; produced: number; remaining: number; complete: boolean
  status: Status; reasons: string[]; plannedEnd: string; projectedEnd: string | null; maths: string
  madeIsEstimate: boolean; noRecentUpdate: boolean
  /** Absent from an older server. */
  lowConfidence?: boolean
}
interface NoteEntry { id: string; stage: string; takenOn: string; language: 'ta' | 'en' | null; original: string | null; textEn: string | null; category: string | null; categoryBy: string | null; reviewed: boolean }
interface HistoryEntry { at: string; by: string | null; what: string; from: string | null; to: string | null; reason: string }
interface Detail {
  /** The factory's date today, as the server counts it. Absent from an older server, then the computer's India date stands in. */
  today?: string
  order: { id: string; po: string; buyerName: string; style: string; colour: string; sizes: Record<string, number>; qty: number; exFactory: string; status: Status }
  stages: StageDetail[]
  calendar: { from: string; to: string; units: CalendarUnit[] }
  history: HistoryEntry[]
  notes: NoteEntry[]
  /** The server's reason list (DEC-022); absent from an older server, then the built-in list stands in. */
  reasons?: Reason[]
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// Always the factory's time (India), whatever zone the viewer's computer is set to.
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' IST'

export default function OrderDetail() {
  const { id = '' } = useParams()
  const created = (useLocation().state as { created?: boolean } | null)?.created === true
  const boardPath = backToBoard(useSearchParams()[0].get(BACK_PARAM))
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<LoadFailure | null>(null)
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [changeError, setChangeError] = useState<string | null>(null)
  const [moved, setMoved] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setD(await apiFetch<Detail>(`/api/orders/${id}`)); setError(null) }
    catch (e) { setError(describeFailure(e, 'Could not load this order.')) }
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

  const last = d?.stages[d.stages.length - 1]

  return (
    <MerchandiserShell title={d ? d.order.po : 'Order'} plainTitle={!!d} form bento>
        <TextLink className="back" to={boardPath}>← Order board</TextLink>
        {!d && !error && <Loading label="Loading order" />}
        {error && <LoadFailed unreachable={error.unreachable} message={error.message} onRetry={() => void load()} />}

        {d && (
          <>
            {created && <p className="notice-box" role="status">Order created. Its stage dates were worked out from ex-factory.</p>}
            <OrderBento
              head={
            <Card className="summary">
              <div className="summary__top">
                <h1 className="mono">{d.order.po}</h1>
                <StatusBadge status={d.order.status} />
              </div>
              <p className="sub summary__who">{d.order.buyerName} · {d.order.style} · {d.order.colour}</p>
              <KeyFacts facts={[
                { label: 'Quantity', value: pieces(d.order.qty), hint: 'pieces' },
                { label: 'Ex-factory', value: shortDate(d.order.exFactory), hint: dateInWords(d.order.exFactory) || undefined },
                ...(d.stages.length > 0 ? [{ label: 'Stages done', value: `${d.stages.filter((s) => s.complete).length} of ${d.stages.length}` }] : []),
                // The last stage's projected finish, from the server's own projection; no tile when there is none yet (nothing is guessed here).
                ...(last && !last.complete && last.projectedEnd ? [{ label: 'Projected finish', value: shortDate(last.projectedEnd), hint: slipText(last.plannedEnd, last.projectedEnd) ?? undefined, wideOnly: true }] : []),
              ]} />
              <p className="sub mono summary__sizes">{Object.entries(d.order.sizes).map(([s, q]) => `${s} ${pieces(q)}`).join(' · ')}</p>
              {d.history[0] && (
                <p className="sub summary__last">Last date change: {when(d.history[0].at)} by {d.history[0].by ?? 'a person not recorded'}. <a className="link" href="#history">See the history</a></p>
              )}
            </Card>
              }
              timeline={
                <BentoCell>
            <h2>Timeline</h2>
            <StageTimeline stages={d.stages} exFactory={d.order.exFactory} calendar={d.calendar} />
                </BentoCell>
              }
              stages={
                <BentoCell>
            <h2>Stage detail</h2>
            <ol className="stagelist plain">
              {d.stages.map((s) => {
                const pct = s.qty ? Math.min(100, Math.round((s.produced / s.qty) * 100)) : 0
                const slip = slipText(s.plannedEnd, s.projectedEnd)
                return (
                  <li key={s.stage} className={`stagecard stagecard--${s.status}`}>
                    <div className="stagecard__top">
                      <b>{cap(s.stage)}</b><span className="sub">{s.unitName}</span><StatusBadge status={s.status} />
                    </div>
                    <div className="bar" role="img" aria-label={`${pieces(s.produced)} of ${pieces(s.qty)} pieces made`}><span style={{ width: `${pct}%` }} /></div>
                    <p className="mono sub">{pieces(s.produced)} of {pieces(s.qty)} pieces</p>
                    <dl className="dates">
                      <div><dt>Plan</dt><dd className="mono">{shortDate(s.plannedEnd)}</dd></div>
                      <div><dt>Projected</dt><dd className="mono">{s.complete ? 'Done' : s.projectedEnd ? shortDate(s.projectedEnd) : 'Not enough data'}{!s.complete && slip ? <span className="sub"> ({slip})</span> : null}</dd></div>
                    </dl>
                    {/* The working behind the colour, always shown. */}
                    <p className="why">{s.maths}</p>
                    {s.madeIsEstimate && <p className="sub flag">The rate is an estimate: fewer than 3 days of updates so far.</p>}
                    {s.noRecentUpdate && <p className="sub flag">No update on the last working day.</p>}
                    {s.lowConfidence && <LowConfidence text={LOW_CONFIDENCE} />}
                  </li>
                )
              })}
            </ol>
                </BentoCell>
              }
              actions={
                <>
            {d.stages.length > 0 && <VisitEntryForm key={d.order.id} orderId={d.order.id} stages={d.stages.map((s) => s.stage)} today={d.today ?? istDate()} onAdded={load} />}

            <Card>
              <details open={moved !== null || changeError !== null}>
                <summary><b>Change the ex-factory date</b></summary>
                <form onSubmit={change} noValidate className="change">
                  <Field label="New ex-factory date">
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /><DateWords iso={date} /></Field>
                  <Field label="Reason (kept in the history)">
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
                  {changeError && <ErrorText>{changeError}</ErrorText>}
                  <Button disabled={busy}>{busy ? 'Changing…' : 'Change date'}</Button>
                </form>
              </details>
              {moved && <p className="notice-box" role="status">{moved}</p>}
            </Card>
                </>
              }
              log={
                <>
                <BentoCell>
            <h2 id="history" tabIndex={-1}>History of date changes{d.history.length > 0 ? ` (${d.history.length})` : ''}</h2>
            {d.history.length === 0 ? <p className="sub">No dates have been changed on this order.</p> : (
              <ol className="plain historylist">
                {d.history.map((h, i) => (
                  <li key={i} className="historyitem">
                    <div className="historyitem__top">
                      <b>{h.what}</b>
                      <span className="mono">{h.from ? shortDate(h.from) : '-'} → {h.to ? shortDate(h.to) : '-'}</span>
                    </div>
                    <p className="sub">{h.by ?? 'Person not recorded'} · {when(h.at)}</p>
                    {h.reason && <p className="historyitem__reason">Reason: {h.reason}</p>}
                  </li>
                ))}
              </ol>
            )}
                </BentoCell>
                <BentoCell>
            <h2>Notes from the floor</h2>
            {d.notes.length === 0 ? <p className="sub">No notes have been written on this order.</p> : (
              <ul className="plain stagelist">
                {d.notes.map((n) => (
                  <li key={n.id} className="stagecard">
                    <div className="stagecard__top">
                      <b>{cap(n.stage)}</b><span className="sub">{n.takenOn}</span>
                      {n.category && <span className="sub">· {reasonById(usableReasons(d.reasons), n.category)?.en}{n.categoryBy === 'merchandiser' ? ' (set by you)' : ''}</span>}
                      <span className="sub stagecard__end">{n.reviewed ? 'Reviewed' : 'Not reviewed yet'}</span>
                    </div>
                    {n.original && <p className="orig" lang={n.language === 'ta' ? 'ta' : 'en'}><span className="lang-tag">{n.language === 'ta' ? 'Tamil' : 'English'}</span> {n.original}</p>}
                    {n.language === 'ta' && n.textEn && <p className="why">In English: {n.textEn}</p>}
                  </li>
                ))}
              </ul>
            )}
                </BentoCell>
                </>
              }
            />
          </>
        )}
    </MerchandiserShell>
  )
}
