import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { shortDate } from '../board/boardLogic'
import { useLang } from '../i18n'
import { useQueue } from '../queue/instance'
import { readStorageFacts, storageWarning } from '../queue/storageStatus'
import { useStages, type Stage } from '../stages/useStages'
import { AppBar } from '../ui/AppBar'
import { Loading } from '../ui/Loading'
import { SyncChip } from '../ui/SyncChip'

export default function Today() {
  const { t } = useLang()
  const { queue, state } = useQueue()
  // Fetch again whenever a sync finishes, so the totals catch up with what the server holds.
  const st = useStages(queue?.idb ?? null, state?.lastSyncedAt ?? 0)
  const [warning, setWarning] = useState<string | null>(null)
  useEffect(() => {
    if (!queue) return
    void readStorageFacts(queue.ctl.getState().durable).then((f) => setWarning(storageWarning(f, queue.ctl.getState().pending)))
  }, [queue, state?.pending])

  const shown = (s: Stage) => {
    // server total + still waiting + sent after the list was fetched = what the supervisor has really done today
    const extra = queue && st.today ? queue.ctl.waitingQty(s.orderId, s.stage, st.today) + queue.ctl.sentSince(s.orderId, s.stage, st.today, st.fetchStartedAt) : 0
    return { today: s.todayQty + extra, total: s.produced + extra }
  }
  const open = st.stages?.filter((s) => !s.complete) ?? []
  const finished = st.stages?.filter((s) => s.complete) ?? []

  return (
    <>
      <AppBar title={t('sup.title')} />
      <main className="page page--narrow">
        {queue && state && <SyncChip state={state} ctl={queue.ctl} />}
        {warning && <p className="banner" role="alert">{warning}</p>}

        {state && state.rejected.length > 0 && queue && (
          <section className="card attention" aria-label="Updates that need attention">
            <h2>Not accepted</h2>
            <ul className="plain">
              {state.rejected.map((r) => (
                <li key={r.clientUuid}>
                  <b className="mono">{r.qty}</b> pieces on {shortDate(r.date)}: {r.reason}
                  <button className="link" onClick={() => void queue.ctl.discard(r.clientUuid)}>Remove</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {st.source === 'saved' && st.savedAt && (
          <p className="notice" role="status">No connection. Showing your list saved at {new Date(st.savedAt).toLocaleTimeString()}.</p>
        )}
        {st.stages === null && !st.error && <Loading label="Loading your orders" />}
        {st.stages === null && st.error && (
          <div className="card" role="alert"><p>{st.error}</p><button className="btn" onClick={() => void st.reload()}>Try again</button></div>
        )}
        {st.stages && open.length === 0 && <div className="card"><p>Nothing to update right now.</p></div>}

        <ul className="stages plain">
          {open.map((s) => {
            const n = shown(s)
            return (
              <li key={`${s.orderId}/${s.stage}`} className="stage">
                <div className="stage__head">
                  <b className="mono stage__po">{s.po}</b>
                  <span className="sub">{s.style} · {s.colour}</span>
                </div>
                <div className="stage__name">{s.stage}</div>
                <div className="stage__nums mono">
                  <span>Today <b>{n.today}</b></span>
                  <span>Done <b>{n.total}</b> / {s.qty}</span>
                  <span>Due <b>{shortDate(s.plannedEnd)}</b></span>
                </div>
                <Link className="btn btn--primary btn--block stage__go" to={`/today/${s.orderId}/${encodeURIComponent(s.stage)}`}>Update</Link>
              </li>
            )
          })}
        </ul>

        {finished.length > 0 && (
          <details className="finished">
            <summary>Finished ({finished.length})</summary>
            <ul className="plain">{finished.map((s) => <li key={`${s.orderId}/${s.stage}`}><b className="mono">{s.po}</b> · {s.stage}</li>)}</ul>
          </details>
        )}
      </main>
    </>
  )
}
