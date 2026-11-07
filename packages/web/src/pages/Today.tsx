import { Link } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { istDate } from '../dates'
import { dayMonth, serverWords, stageLabel, useLang, type Key } from '../i18n'
import { useQueue } from '../queue/instance'
import { readStorageFacts, storageWarningKey } from '../queue/storageStatus'
import { stageHref } from '../stages/stageLink'
import { dayProgress } from '../stages/dayProgress'
import { stagesErrorText, useStages, type Stage } from '../stages/useStages'
import { AppBar } from '../ui/AppBar'
import { LoadFailed } from '../ui/LoadFailed'
import { Loading } from '../ui/Loading'
import { SyncChip } from '../ui/SyncChip'

export default function Today() {
  const { t, lang } = useLang()
  const { queue, state } = useQueue()
  // Fetch again whenever a sync finishes, so the totals catch up with what the server holds.
  const st = useStages(queue?.idb ?? null, state?.lastSyncedAt ?? 0)
  const [warning, setWarning] = useState<Key | null>(null)
  useEffect(() => {
    if (!queue) return
    void readStorageFacts(queue.ctl.getState().durable).then((f) => setWarning(storageWarningKey(f, queue.ctl.getState().pending)))
  }, [queue, state?.pending])

  const shown = (s: Stage) => {
    // server total + still waiting + sent after the list was fetched = what the supervisor has really done today
    const extra = queue && st.today ? queue.ctl.waitingQty(s.orderId, s.stage, st.today) + queue.ctl.sentSince(s.orderId, s.stage, st.today, st.fetchStartedAt) : 0
    return { today: s.todayQty + extra, total: s.produced + extra }
  }
  // Remove takes its row away (and the whole box with the last one): focus the box's heading,
  // or once the box is gone the first stage, never <body>.
  const main = useRef<HTMLElement>(null)
  const refusedHeading = useRef<HTMLHeadingElement>(null)
  const removed = useRef(false)
  const refusedCount = state?.rejected.length ?? 0
  useEffect(() => {
    if (!removed.current) return
    removed.current = false
    ;(refusedHeading.current ?? main.current?.querySelector<HTMLElement>('.stage__go') ?? main.current)?.focus()
  }, [refusedCount])

  const open = st.stages?.filter((s) => !s.complete) ?? []
  // How the day is going, from the real counts (the server's total for today plus what is saved on this phone and not yet sent).
  const progress = st.stages ? dayProgress(st.stages, (s) => shown(s).today - s.todayQty) : null
  const finished = st.stages?.filter((s) => s.complete) ?? []

  return (
    <>
      <AppBar title={t('sup.title')} />
      <main className="page page--narrow" ref={main} tabIndex={-1}>
        {queue && state && <SyncChip state={state} ctl={queue.ctl} />}
        {warning && <p className="banner" role="alert">{t(warning)}</p>}

        {state && state.rejected.length > 0 && queue && (
          <section className="card attention" aria-label={t('today.attention')}>
            <h2 tabIndex={-1} ref={refusedHeading}>{t('sync.notAccepted')}</h2>
            <ul className="plain">
              {state.rejected.map((r) => (
                <li key={r.clientUuid}>
                  <span><b className="mono">{r.qty}</b> {t('today.refusedLine', { date: dayMonth(lang, r.date), reason: serverWords(lang, r.reason, 'sync.refusedGeneric') })}</span>
                  <button className="link" onClick={() => { removed.current = true; void queue.ctl.discard(r.clientUuid) }}>{t('common.remove')}</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {queue && queue.ctl.droppedPhotos().length > 0 && (
          <section className="card attention" aria-label={t('sync.photoNotAccepted')}>
            <h2>{t('sync.photoNotAccepted')}</h2>
            <ul className="plain">
              {queue.ctl.droppedPhotos().map((d) => (
                <li key={d.clientUuid}><span><b className="mono">{d.qty}</b> {t('today.droppedLine', { stage: stageLabel(lang, d.stage), date: dayMonth(lang, d.date), note: serverWords(lang, d.note, 'sync.photoGeneric') })}</span></li>
              ))}
            </ul>
            <button className="link" onClick={() => queue.ctl.clearDroppedPhotos()}>{t('common.ok')}</button>
          </section>
        )}

        {st.source === 'saved' && st.savedAt && (
          <p className="notice" role="status">{t('today.savedList', { date: dayMonth(lang, istDate(new Date(st.savedAt))), time: new Date(st.savedAt).toLocaleTimeString() })}</p>
        )}
        {st.stages === null && !st.error && <Loading label={t('today.loading')} />}
        {st.stages === null && st.error && (
          <LoadFailed unreachable={st.error.unreachable} message={stagesErrorText(st.error, lang)} onRetry={() => void st.reload()} workSafe />
        )}
        {st.stages && open.length === 0 && <div className="card"><p>{t('today.nothing')}</p></div>}
        {progress && (
          <p className="sub today__progress">
            <b>{t('today.progress', { n: progress.updated, m: progress.total })}</b>
            {st.today ? ` · ${t('today.countsFor', { date: dayMonth(lang, st.today) })}` : ''}
          </p>
        )}

        <ul className="stages plain">
          {open.map((s) => {
            const n = shown(s)
            return (
              <li key={`${s.orderId}/${s.stage}`} className="stage">
                <div className="stage__head">
                  <b className="mono stage__po">{s.po}</b>
                  <span className="sub">{s.style} · {s.colour}</span>
                </div>
                <div className="stage__name">{stageLabel(lang, s.stage)}</div>
                <div className="stage__nums mono">
                  <span>{t('today.today')} <b>{n.today}</b></span>
                  <span>{t('today.done')} <b>{n.total}</b> / {s.qty}</span>
                  <span>{t('today.due')} <b>{dayMonth(lang, s.plannedEnd)}</b></span>
                </div>
                <Link className="btn btn--primary btn--block stage__go" to={stageHref(s.orderId, s.stage)}>{t('today.update')}</Link>
              </li>
            )
          })}
        </ul>

        {finished.length > 0 && (
          <details className="finished">
            <summary>{t('today.finished', { n: finished.length })}</summary>
            <ul className="plain">{finished.map((s) => <li key={`${s.orderId}/${s.stage}`}><b className="mono">{s.po}</b> · {stageLabel(lang, s.stage)}</li>)}</ul>
          </details>
        )}
      </main>
    </>
  )
}
