import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError, apiFetch } from '../api/session'
import { applyFilters, buyersOf, counts, parseFilters, preview, shortDate, STATUSES, withFilter, type BoardRow } from '../board/boardLogic'
import { useLang } from '../i18n'
import { AppBar } from '../ui/AppBar'
import { Loading } from '../ui/Loading'
import { StatusBadge } from '../ui/StatusBadge'

const POLL_MS = 60_000

export default function Board() {
  const { t } = useLang()
  const [params, setParams] = useSearchParams()
  const filters = parseFilters(params)
  const [rows, setRows] = useState<BoardRow[] | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
      setError(e instanceof ApiError ? e.message : 'Could not load the board.')
    }
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, POLL_MS)
    return () => { window.clearInterval(id); inFlight.current?.abort() }
  }, [load])

  const c = useMemo(() => (rows ? counts(rows, filters) : null), [rows, filters.buyer]) // eslint-disable-line react-hooks/exhaustive-deps
  const buyers = useMemo(() => (rows ? buyersOf(rows) : []), [rows])
  const filtered = useMemo(() => (rows ? applyFilters(rows, filters) : []), [rows, filters.status, filters.buyer]) // eslint-disable-line react-hooks/exhaustive-deps
  const { shown, capped } = preview(filtered, showAll)

  return (
    <>
      <AppBar title={t('board.title')} />
      <main className="page">
        {rows === null && !error && <Loading label="Loading orders" />}
        {rows === null && error && (
          <div className="card" role="alert">
            <p>{error}</p>
            <button className="btn" onClick={() => void load()}>Try again</button>
          </div>
        )}

        {rows && c && (
          <>
            <div className="strip" role="group" aria-label="Filter by status">
              <button className="chip" aria-pressed={!filters.status} onClick={() => setParams(withFilter(params, 'status', null))}>
                {t('board.all')} <b>{c.total}</b>
              </button>
              {STATUSES.map((s) => (
                <button key={s} className={`chip chip--${s}`} aria-pressed={filters.status === s} onClick={() => setParams(withFilter(params, 'status', s))}>
                  {t(`status.${s}`)} <b>{c[s]}</b>
                </button>
              ))}
              <label className="strip__buyer">
                <span className="visually-hidden">Buyer</span>
                <select className="input" value={filters.buyer ?? ''} onChange={(e) => setParams(withFilter(params, 'buyer', e.target.value || null))}>
                  <option value="">All buyers</option>
                  {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
              <span className="strip__meta" role="status">
                {error ? <span className="error">Could not refresh{updatedAt ? `; showing ${updatedAt.toLocaleTimeString()}` : ''}. <button className="link" onClick={() => void load()}>Try again</button></span>
                  : updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : ''}
                {today ? ` · Today ${shortDate(today)}` : ''}
              </span>
              <button className="btn btn--small" onClick={() => void load()}>{t('board.refresh')}</button>
            </div>

            {rows.length === 0 ? (
              <div className="card"><p>No orders yet. Orders you set up will appear here.</p></div>
            ) : filtered.length === 0 ? (
              <div className="card"><p>No orders match these filters.</p></div>
            ) : (
              <table className="board">
                <caption className="visually-hidden">Orders, most urgent first</caption>
                <thead>
                  <tr><th scope="col">Status</th><th scope="col">PO</th><th scope="col">Buyer</th><th scope="col">Ship</th><th scope="col">Gap</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.orderId} className={`row row--${r.status}`}>
                      <td data-label="Status"><StatusBadge status={r.status} /></td>
                      <td data-label="PO">
                        <div className="po">
                        <b className="mono">{r.po}</b>
                        <span className="sub">{r.style} · {r.colour}</span>
                        {/* The maths behind the colour, always shown: a colour nobody can explain is not trusted. */}
                        <span className="sub why">{r.maths ?? r.reasons.join('; ')}</span>
                        {r.noRecentUpdate && <span className="sub flag">No update on the last working day</span>}
                        </div>
                      </td>
                      <td data-label="Buyer">{r.buyerName}</td>
                      <td data-label="Ship" className="mono">{shortDate(r.exFactory)}</td>
                      <td data-label="Gap" className="mono">{r.shortBy && r.shortBy > 0 ? `${r.shortBy.toLocaleString('en-IN')} ${t('board.shortBy')}` : '–'}</td>
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
