import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiFetch } from '../api/session'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import {
  activeConstraints, applyFilters, applyScope, buyersOf, counts, isUnknownChoice, parseFilters, parseScope, parseView, preview, progressOf, searchRows, shipIn, shortByStatus, shortDate,
  SHIP_WEEKS, sortRows, SORTS, STATUSES, unitsOf, weekRange, withFilter, withQuery, withSort, type BoardRow, type ShipWeek, type Sort,
} from '../board/boardLogic'
import { istDate } from '../dates'
import { pieces } from '../numberFormat'
import { orderLink } from '../orders/orderDetailLogic'
import { lowConfidenceText } from '../orders/visitEntry'
import { useLang } from '../i18n'
import { MerchandiserShell } from '../ui/templates/MerchandiserShell'
import { LoadFailed } from '../ui/LoadFailed'
import { Loading } from '../ui/Loading'
import { LowConfidence } from '../ui/LowConfidence'
import { StatusBadge } from '../ui/StatusBadge'
import { Button, ButtonLink } from '../ui/atoms/Button'
import { Card } from '../ui/atoms/Card'
import { Chip } from '../ui/atoms/Chip'
import { Input, Select } from '../ui/atoms/Input'
import { LinkButton } from '../ui/atoms/TextLink'
import { StatusTiles, type Tile } from '../ui/organisms/StatusTiles'
import './Board.css'
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
  const short = useMemo(() => (rows ? shortByStatus(scoped, filters) : null), [rows, scoped, filters.buyer]) // eslint-disable-line react-hooks/exhaustive-deps
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
    <MerchandiserShell title={t('board.title')}>
        {rows === null && !error && <Loading label="Loading orders" />}
        {rows === null && error && <LoadFailed unreachable={error.unreachable} message={error.message} onRetry={() => void load()} />}

        {rows && c && (
          <>
            {(() => {
              const chips = (
                <>
                  <Chip aria-pressed={!filters.status} onClick={() => setParams(withFilter(params, 'status', null))}>
                    {t('board.all')} <b>{c.total}</b>
                  </Chip>
                  {STATUSES.map((s) => (
                    <Chip key={s} tone={s} aria-pressed={filters.status === s} onClick={() => setParams(withFilter(params, 'status', s))}>
                      {t(`status.${s}`)} <b>{c[s]}</b>
                    </Chip>
                  ))}
                </>
              )
              // The same numbers as the chips (counts), each with the pieces still short for those orders when there are any.
              const note = (n: number | undefined, suffix: string) => (n && n > 0 ? `${pieces(n)} pcs short${suffix}` : undefined)
              const tiles: Tile[] = [
                { key: 'all', label: t('board.all'), count: c.total, note: note(short?.total, ' in total'), pressed: !filters.status, onPress: () => setParams(withFilter(params, 'status', null)) },
                ...STATUSES.map((s): Tile => ({
                  key: s, label: t(`status.${s}`), count: c[s], note: s === 'red' || s === 'amber' ? note(short?.[s], '') : undefined,
                  pressed: filters.status === s, onPress: () => setParams(withFilter(params, 'status', s)),
                })),
              ]
              const buyerSelect = (
                <label className="strip__buyer">
                  <span className="visually-hidden">Buyer</span>
                  <Select value={filters.buyer ?? ''} onChange={(e) => setParams(withFilter(params, 'buyer', e.target.value || null))}>
                    <option value="">All buyers</option>
                    {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    {/* A shared link can name a buyer with no orders here: keep the choice visible so "All buyers" is a real change that clears it. */}
                    {isUnknownChoice(buyers, filters.buyer) && <option value={filters.buyer!}>Unknown buyer</option>}
                  </Select>
                </label>
              )
              const sortSelect = (
                <label className="strip__sort">
                  <span className="visually-hidden">Sort orders</span>
                  <Select value={sort} onChange={(e) => setParams(withSort(params, e.target.value as Sort))}>
                    {SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
                  </Select>
                </label>
              )
              const unitSelect = (
                <label className="strip__unit">
                  <span className="visually-hidden">Unit</span>
                  <Select value={scope.unit ?? ''} onChange={(e) => setParams(withFilter(params, 'unit', e.target.value || null))}>
                    <option value="">All units</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    {/* A shared link can name a unit that is gone: keep the choice visible rather than showing "All units" over an empty list. */}
                    {scope.unit && !units.some((u) => u.id === scope.unit) && <option value={scope.unit}>Unknown unit</option>}
                  </Select>
                </label>
              )
              const weekSelect = (
                <label className="strip__week">
                  <span className="visually-hidden">Ship week</span>
                  <Select value={scope.week ?? ''} onChange={(e) => setParams(withFilter(params, 'week', e.target.value || null))}>
                    <option value="">Any ship week</option>
                    {SHIP_WEEKS.map((w) => <option key={w} value={w}>{weekLabel(w, day)}</option>)}
                  </Select>
                </label>
              )
              const searchBox = (
                <label className="strip__search">
                  <span className="visually-hidden">Search by PO, buyer or style</span>
                  <Input type="search" enterKeyHint="search" autoComplete="off" spellCheck={false}
                    placeholder="Search PO, buyer or style" value={text} onChange={(e) => onType(e.target.value)} />
                </label>
              )
              const tools = (
                <>
                  <span className="strip__meta">
                    {/* Only a failed refresh is announced: the time changes on every poll and would be read out every minute. */}
                    <span role="status">{error ? <span className="error">Could not refresh{updatedAt ? `; showing ${updatedAt.toLocaleTimeString()}` : ''}.</span> : null}</span>
                    {error ? <> <LinkButton onClick={() => void load()}>Try again</LinkButton></>
                      : updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : ''}
                    {today ? ` · Today ${shortDate(today)}` : ''}
                  </span>
                  <Button size="small" onClick={() => void load()}>{t('board.refresh')}</Button>
                  <ButtonLink variant="primary" size="small" to="/orders/new">New order</ButtonLink>
                </>
              )
              return narrow ? (
                <>
                  <div className="strip" role="group" aria-label="Filter by status">{chips}</div>
                  {rows.length > 0 && (
                    <form className="strip strip--find" role="search" onSubmit={(e) => { e.preventDefault(); pushQuery(text) }}>
                      {searchBox}
                      <Button type="button" className="filtersbtn" aria-expanded={filtersOpen} aria-controls="board-filters" onClick={() => setFiltersOpen((o) => !o)}>
                        {filtersButtonText(panelFilterCount(panel))}
                      </Button>
                    </form>
                  )}
                  {applied.length > 0 && (
                    <div className="applied" role="group" aria-label="Filters that are on">
                      {applied.map((a) => (
                        <Chip key={a.key} type="button" className="chip--applied" aria-label={`Remove filter: ${a.text}`} onClick={() => removeApplied(a.key)}>
                          {a.text} <span aria-hidden="true">×</span>
                        </Chip>
                      ))}
                    </div>
                  )}
                  {filtersOpen && <div id="board-filters" className="filterpanel">{buyerSelect}{sortSelect}{unitSelect}{weekSelect}</div>}
                  <div className="strip strip--tools">{tools}</div>
                </>
              ) : (
                <>
                  <div className="strip boardhead">{buyerSelect}{tools}</div>
                  <StatusTiles label="Filter by status" tiles={tiles} />
                  {rows.length > 0 && (
                    <form className="strip strip--find strip--attached" role="search" onSubmit={(e) => { e.preventDefault(); pushQuery(text) }}>
                      {searchBox}{sortSelect}{unitSelect}{weekSelect}
                    </form>
                  )}
                </>
              )
            })()}
            {/* Said aloud for a screen reader once the search has settled; the empty case has its own message below. */}
            <p className="visually-hidden" role="status">{q.trim() && filtered.length > 0 ? `${filtered.length} ${filtered.length === 1 ? 'order matches' : 'orders match'}.` : ''}</p>

            {rows.length === 0 ? (
              <Card as="div"><p>No orders yet. Orders you set up will appear here.</p><p><ButtonLink to="/orders/new">Set up the first order</ButtonLink></p></Card>
            ) : filtered.length === 0 ? (
              <Card as="div">
                {/* Only the sentence is a live region: a button inside one is read out with it. */}
                <p role="status">{narrowedBy.includes('q') ? <>No orders match <b>“{q.trim()}”</b>{narrowedBy.length > 1 ? ' with the filters on' : ''}.</> : 'No orders match these filters.'}</p>
                <p className="sub">{narrowedBy.includes('q') ? 'Check the spelling, or search for less: part of a PO number, the buyer or the style. ' : ''}Or widen the view:</p>
                <div className="actions">
                  {narrowedBy.includes('q') && <Button size="small" onClick={clearSearch}>Clear search</Button>}
                  {narrowedBy.includes('status') && <Button size="small" onClick={() => setParams(withFilter(params, 'status', null))}>Show every status</Button>}
                  {narrowedBy.includes('buyer') && <Button size="small" onClick={() => setParams(withFilter(params, 'buyer', null))}>Show every buyer</Button>}
                  {narrowedBy.includes('unit') && <Button size="small" onClick={() => setParams(withFilter(params, 'unit', null))}>Show every unit</Button>}
                  {narrowedBy.includes('week') && <Button size="small" onClick={() => setParams(withFilter(params, 'week', null))}>Show any ship week</Button>}
                </div>
              </Card>
            ) : (
              // Explicit roles: under 720 px the table is laid out as cards (display:block), and a browser may drop table semantics for that.
              <table className={narrow ? 'board' : 'board board--wide'} role="table">
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
                      <td role="cell" data-label="Ship" className="mono">{shortDate(r.exFactory)}{!narrow && today && shipIn(r.exFactory, today) ? <span className="sub ship__in">{shipIn(r.exFactory, today)}</span> : null}</td>
                      <td role="cell" data-label="Gap" className="mono">{r.shortBy && r.shortBy > 0 ? `${pieces(r.shortBy)} ${t('board.shortBy')}` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {capped && (
              <p className="more">Showing {shown.length} of {filtered.length} orders. <LinkButton onClick={() => setShowAll(true)}>Show all</LinkButton></p>
            )}
          </>
        )}
    </MerchandiserShell>
  )
}
