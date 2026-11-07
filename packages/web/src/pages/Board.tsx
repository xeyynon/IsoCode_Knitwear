import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../api/session'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import {
  activeConstraints, applyFilters, applyScope, buyersOf, counts, isUnknownChoice, parseFilters, parseScope, parseView, preview, progressOf, searchRows, shortDate,
  SHIP_WEEKS, sortRows, SORTS, STATUSES, unitsOf, weekRange, withFilter, withQuery, withSort, type BoardRow, type ShipWeek, type Sort,
} from '../board/boardLogic'
import { istDate } from '../dates'
import { pieces } from '../numberFormat'
import { orderLink } from '../orders/orderDetailLogic'
import { lowConfidenceText } from '../orders/visitEntry'
import { useLang } from '../i18n'
import { AppBar } from '../ui/AppBar'
import { LoadFailed } from '../ui/LoadFailed'
import { Loading } from '../ui/Loading'
import { LowConfidence } from '../ui/LowConfidence'
import { StatusBadge } from '../ui/StatusBadge'
import { useNarrow } from '../ui/useNarrow'
import { appliedFilters, filtersButtonText, panelFilterCount, type PanelFilters } from '../board/filterPanel'

const POLL_MS = 60_000
const SEARCH_DEBOUNCE_MS = 250
const SORT_LABEL: Record<Sort, string> = {
  status: 'Worst status first',
  exfactory: 'Ex-factory date, soonest first',
  buyer: 'Buyer, A to Z',
  po: 'PO number',
}
/** Ship week is the week of the ex-factory date, Monday to Sunday; the dates are spelled out so "this week" is never a guess. */
const weekLabel = (w: ShipWeek, today: string): string => {
  const range = (offset: number) => { const r = weekRange(today, offset); return r ? ` (${r})` : '' }
  return w === 'overdue' ? 'Overdue (earlier weeks)' : w === 'this' ? `This week${range(0)}` : w === 'next' ? `Next week${range(1)}` : 'Later'
}

/** Stages finished out of all, as a thin bar plus the current stage in words: the length is never the only signal, and it is not a status colour. */
function Progress({ row }: { row: BoardRow }) {
  const p = progressOf(row)
  if (!p) return null
  return (
    <span className="prog" role="img" aria-label={p.label}>
      <span className="prog__bar"><span className="prog__fill" style={{ width: `${Math.round(p.fraction * 100)}%` }} /></span>
      <span className="prog__text">{p.text}<span className="prog__n"> · {p.done}/{p.total} done</span></span>
    </span>
  )
}

export default function Board() {
  const { t } = useLang()
  const [params, setParams] = useSearchParams()
  const filters = parseFilters(params)
  const scope = parseScope(params)
  const { q, sort } = parseView(params)
  // The box shows what was typed at once; the URL (and so the list) follows after a short pause.
  // The 60 s poll never touches this state, so it cannot reset the text, the focus or the scroll position.
  const [text, setText] = useState(q)
  const paramsRef = useRef(params)
  paramsRef.current = params
  const pushedQ = useRef(q)
  const searchTimer = useRef<number | undefined>(undefined)
  const [rows, setRows] = useState<BoardRow[] | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [error, setError] = useState<LoadFailure | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [showAll, setShowAll] = useState(false)
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    inFlight.current?.abort()
    const ctl = new AbortController()
    inFlight.current = ctl
    try {
      const r = await apiFetch<{ today: string; rows: BoardRow[] }>('/api/board', { signal: ctl.signal })
      setRows(r.rows); setToday(r.today); setError(null); setUpdatedAt(new Date())
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      // A failed refresh must be visible, and must not throw away what is already on screen.
      setError(describeFailure(e, 'Could not load the board.'))
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, POLL_MS)
    return () => { window.clearInterval(id); inFlight.current?.abort() }
  }, [load])

  useEffect(() => () => window.clearTimeout(searchTimer.current), [])

  // Back, forward or an edited address changes q from outside: show it. Our own pushes are skipped.
  useEffect(() => {
    if (q !== pushedQ.current) { pushedQ.current = q; setText(q) }
  }, [q])

  const pushQuery = (value: string) => {
    window.clearTimeout(searchTimer.current)
    pushedQ.current = value.trim() === '' ? '' : value
    // replace: a search typed letter by letter is one history entry at most, not one per pause.
    setParams(withQuery(paramsRef.current, value), { replace: true })
  }
  const onType = (value: string) => {
    setText(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => pushQuery(value), SEARCH_DEBOUNCE_MS)
  }
  const clearSearch = () => { setText(''); pushQuery('') }

  // Search narrows everything below it, including the status counts, so a chip's number is what clicking it shows.
  // Unit and ship week narrow it too, before the status counts are worked out, so every number matches what its button shows.
  const day = today ?? istDate()
  const searched = useMemo(() => (rows ? searchRows(rows, q) : []), [rows, q])
  const scoped = useMemo(() => applyScope(searched, scope, day), [searched, scope.unit, scope.week, day]) // eslint-disable-line react-hooks/exhaustive-deps
  const c = useMemo(() => (rows ? counts(scoped, filters) : null), [rows, scoped, filters.buyer]) // eslint-disable-line react-hooks/exhaustive-deps
  const buyers = useMemo(() => (rows ? buyersOf(rows) : []), [rows])
  const units = useMemo(() => (rows ? unitsOf(rows) : []), [rows])
  const filtered = useMemo(() => sortRows(applyFilters(scoped, filters), sort), [scoped, sort, filters.status, filters.buyer]) // eslint-disable-line react-hooks/exhaustive-deps
  const { shown, capped } = preview(filtered, showAll)
  const narrowedBy = activeConstraints({ q, status: filters.status, buyer: filters.buyer, unit: scope.unit, week: scope.week })

  // On a phone, buyer, sort, unit and ship week sit behind one Filters button and the ones that are on show as chips that remove
  // themselves (slice 3.2). Wide screens keep the layout they had. Every filter is still read from and written to the address.
  const narrow = useNarrow()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const panel: PanelFilters = { buyer: filters.buyer, unit: scope.unit, week: scope.week, sort }
  const applied = appliedFilters(panel, { buyers, units, week: (w) => weekLabel(w, day), sort: (x) => SORT_LABEL[x] })
  const removeApplied = (key: 'buyer' | 'unit' | 'week' | 'sort') => setParams(key === 'sort' ? withSort(params, 'status') : withFilter(params, key, null))

  return (
    <>
      <AppBar title={t('board.title')} />
      <main className="page">
        {rows === null && !error && <Loading label="Loading orders" />}
        {rows === null && error && <LoadFailed unreachable={error.unreachable} message={error.message} onRetry={() => void load()} />}

        {rows && c && (
          <>
            {(() => {
              const chips = (
                <>
                  <button className="chip" aria-pressed={!filters.status} onClick={() => setParams(withFilter(params, 'status', null))}>
                    {t('board.all')} <b>{c.total}</b>
                  </button>
                  {STATUSES.map((s) => (
                    <button key={s} className={`chip chip--${s}`} aria-pressed={filters.status === s} onClick={() => setParams(withFilter(params, 'status', s))}>
                      {t(`status.${s}`)} <b>{c[s]}</b>
                    </button>
                  ))}
                </>
              )
              const buyerSelect = (
                <label className="strip__buyer">
                  <span className="visually-hidden">Buyer</span>
                  <select className="input" value={filters.buyer ?? ''} onChange={(e) => setParams(withFilter(params, 'buyer', e.target.value || null))}>
                    <option value="">All buyers</option>
                    {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    {/* A shared link can name a buyer with no orders here: keep the choice visible so "All buyers" is a real change that clears it. */}
                    {isUnknownChoice(buyers, filters.buyer) && <option value={filters.buyer!}>Unknown buyer</option>}
                  </select>
                </label>
              )
              const sortSelect = (
                <label className="strip__sort">
                  <span className="visually-hidden">Sort orders</span>
                  <select className="input" value={sort} onChange={(e) => setParams(withSort(params, e.target.value as Sort))}>
                    {SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
                  </select>
                </label>
              )
              const unitSelect = (
                <label className="strip__unit">
                  <span className="visually-hidden">Unit</span>
                  <select className="input" value={scope.unit ?? ''} onChange={(e) => setParams(withFilter(params, 'unit', e.target.value || null))}>
                    <option value="">All units</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    {/* A shared link can name a unit that is gone: keep the choice visible rather than showing "All units" over an empty list. */}
                    {scope.unit && !units.some((u) => u.id === scope.unit) && <option value={scope.unit}>Unknown unit</option>}
                  </select>
                </label>
              )
              const weekSelect = (
                <label className="strip__week">
                  <span className="visually-hidden">Ship week</span>
                  <select className="input" value={scope.week ?? ''} onChange={(e) => setParams(withFilter(params, 'week', e.target.value || null))}>
                    <option value="">Any ship week</option>
                    {SHIP_WEEKS.map((w) => <option key={w} value={w}>{weekLabel(w, day)}</option>)}
                  </select>
                </label>
              )
              const searchBox = (
                <label className="strip__search">
                  <span className="visually-hidden">Search by PO, buyer or style</span>
                  <input className="input" type="search" enterKeyHint="search" autoComplete="off" spellCheck={false}
                    placeholder="Search PO, buyer or style" value={text} onChange={(e) => onType(e.target.value)} />
                </label>
              )
              const tools = (
                <>
                  <span className="strip__meta">
                    {/* Only a failed refresh is announced: the time changes on every poll and would be read out every minute. */}
                    <span role="status">{error ? <span className="error">Could not refresh{updatedAt ? `; showing ${updatedAt.toLocaleTimeString()}` : ''}.</span> : null}</span>
                    {error ? <> <button className="link" onClick={() => void load()}>Try again</button></>
                      : updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : ''}
                    {today ? ` · Today ${shortDate(today)}` : ''}
                  </span>
                  <button className="btn btn--small" onClick={() => void load()}>{t('board.refresh')}</button>
                  <Link className="btn btn--primary btn--small" to="/orders/new">New order</Link>
                </>
              )
              return narrow ? (
                <>
                  <div className="strip" role="group" aria-label="Filter by status">{chips}</div>
                  {rows.length > 0 && (
                    <form className="strip strip--find" role="search" onSubmit={(e) => { e.preventDefault(); pushQuery(text) }}>
                      {searchBox}
                      <button type="button" className="btn filtersbtn" aria-expanded={filtersOpen} aria-controls="board-filters" onClick={() => setFiltersOpen((o) => !o)}>
                        {filtersButtonText(panelFilterCount(panel))}
                      </button>
                    </form>
                  )}
                  {applied.length > 0 && (
                    <div className="applied" role="group" aria-label="Filters that are on">
                      {applied.map((a) => (
                        <button key={a.key} type="button" className="chip chip--applied" aria-label={`Remove filter: ${a.text}`} onClick={() => removeApplied(a.key)}>
                          {a.text} <span aria-hidden="true">×</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {filtersOpen && <div id="board-filters" className="filterpanel">{buyerSelect}{sortSelect}{unitSelect}{weekSelect}</div>}
                  <div className="strip strip--tools">{tools}</div>
                </>
              ) : (
                <>
                  <div className="strip" role="group" aria-label="Filter by status">{chips}{buyerSelect}{tools}</div>
                  {rows.length > 0 && (
                    <form className="strip strip--find" role="search" onSubmit={(e) => { e.preventDefault(); pushQuery(text) }}>
                      {searchBox}{sortSelect}{unitSelect}{weekSelect}
                    </form>
                  )}
                </>
              )
            })()}
            {/* Said aloud for a screen reader once the search has settled; the empty case has its own message below. */}
            <p className="visually-hidden" role="status">{q.trim() && filtered.length > 0 ? `${filtered.length} ${filtered.length === 1 ? 'order matches' : 'orders match'}.` : ''}</p>

            {rows.length === 0 ? (
              <div className="card"><p>No orders yet. Orders you set up will appear here.</p><p><Link className="btn" to="/orders/new">Set up the first order</Link></p></div>
            ) : filtered.length === 0 ? (
              <div className="card">
                {/* Only the sentence is a live region: a button inside one is read out with it. */}
                <p role="status">{narrowedBy.includes('q') ? <>No orders match <b>“{q.trim()}”</b>{narrowedBy.length > 1 ? ' with the filters on' : ''}.</> : 'No orders match these filters.'}</p>
                <p className="sub">{narrowedBy.includes('q') ? 'Check the spelling, or search for less: part of a PO number, the buyer or the style. ' : ''}Or widen the view:</p>
                <div className="actions">
                  {narrowedBy.includes('q') && <button className="btn btn--small" onClick={clearSearch}>Clear search</button>}
                  {narrowedBy.includes('status') && <button className="btn btn--small" onClick={() => setParams(withFilter(params, 'status', null))}>Show every status</button>}
                  {narrowedBy.includes('buyer') && <button className="btn btn--small" onClick={() => setParams(withFilter(params, 'buyer', null))}>Show every buyer</button>}
                  {narrowedBy.includes('unit') && <button className="btn btn--small" onClick={() => setParams(withFilter(params, 'unit', null))}>Show every unit</button>}
                  {narrowedBy.includes('week') && <button className="btn btn--small" onClick={() => setParams(withFilter(params, 'week', null))}>Show any ship week</button>}
                </div>
              </div>
            ) : (
              // Explicit roles: under 720 px the table is laid out as cards (display:block), and a browser may drop table semantics for that.
              <table className="board" role="table">
                <caption className="visually-hidden">Orders, {SORT_LABEL[sort].toLowerCase()}</caption>
                <thead role="rowgroup">
                  <tr role="row"><th role="columnheader" scope="col">Status</th><th role="columnheader" scope="col">PO</th><th role="columnheader" scope="col">Buyer</th><th role="columnheader" scope="col">Ship</th><th role="columnheader" scope="col">Gap</th></tr>
                </thead>
                <tbody role="rowgroup">
                  {shown.map((r) => (
                    <tr key={r.orderId} role="row" className={`row row--${r.status}`}>
                      <td role="cell" data-label="Status"><StatusBadge status={r.status} /></td>
                      <td role="cell" data-label="PO">
                        <div className="po">
                        <Link className="po-link mono" to={orderLink(r.orderId, params.toString())}>{r.po}</Link>
                        <span className="sub">{r.style} · {r.colour}</span>
                        {/* The maths behind the colour, always shown: a colour nobody can explain is not trusted. */}
                        <span className="sub why">{r.maths ?? r.reasons.join('; ')}</span>
                        {r.noRecentUpdate && <span className="sub flag">No update on the last working day</span>}
                        {lowConfidenceText(r.lowConfidenceStages) && <LowConfidence text={lowConfidenceText(r.lowConfidenceStages)!} />}
                        <Progress row={r} />
                        </div>
                      </td>
                      <td role="cell" data-label="Buyer">{r.buyerName}</td>
                      <td role="cell" data-label="Ship" className="mono">{shortDate(r.exFactory)}</td>
                      <td role="cell" data-label="Gap" className="mono">{r.shortBy && r.shortBy > 0 ? `${pieces(r.shortBy)} ${t('board.shortBy')}` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {capped && (
              <p className="more">Showing {shown.length} of {filtered.length} orders. <button className="link" onClick={() => setShowAll(true)}>Show all</button></p>
            )}
          </>
        )}
      </main>
    </>
  )
}
