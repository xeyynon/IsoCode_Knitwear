import { useEffect, useRef, useState } from 'react'
import { istDate } from '../dates'
import { pieces } from '../numberFormat'
import { dayMonth, serverWords, stageLabel, useLang, type Key } from '../i18n'
import { useQueue } from '../queue/instance'
import { readStorageFacts, storageWarningKey } from '../queue/storageStatus'
import { stageHref } from '../stages/stageLink'
import { dayProgress } from '../stages/dayProgress'
import { stagesErrorText, useStages, type Stage } from '../stages/useStages'
import { AppBar } from '../ui/AppBar'
import { LoadFailed } from '../ui/LoadFailed'
import { Banner } from '../ui/atoms/Banner'
import { Card } from '../ui/atoms/Card'
import { LinkButton } from '../ui/atoms/TextLink'
import { Skeleton } from '../ui/atoms/Skeleton'
import { SyncChip } from '../ui/SyncChip'
import { StageCard } from '../ui/organisms/StageCard'
import { TodayHero } from '../ui/organisms/TodayHero'

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
        {/* The day at a glance (phase 8A): a ring, the sentence and the date the counts go to, with the sync chip inside. With no day to
            show (loading, or nothing to update) the chip stands alone, as before. */}
        {progress ? (
          <TodayHero updated={progress.updated} total={progress.total} headline={t('today.progress', { n: progress.updated, m: progress.total })}
            dateLine={st.today ? t('today.countsFor', { date: dayMonth(lang, st.today) }) : undefined}>
            {queue && state && <SyncChip state={state} ctl={queue.ctl} />}
          </TodayHero>
        ) : (queue && state && <SyncChip state={state} ctl={queue.ctl} />)}
        {warning && <Banner>{t(warning)}</Banner>}

        {state && state.rejected.length > 0 && queue && (
          <Card className="attention" aria-label={t('today.attention')}>
            <h2 tabIndex={-1} ref={refusedHeading}>{t('sync.notAccepted')}</h2>
            <ul className="plain">
              {state.rejected.map((r) => (
                <li key={r.clientUuid}>
                  <span><b className="mono">{pieces(r.qty)}</b> {t('today.refusedLine', { date: dayMonth(lang, r.date), reason: serverWords(lang, r.reason, 'sync.refusedGeneric') })}</span>
                  <LinkButton onClick={() => { removed.current = true; void queue.ctl.discard(r.clientUuid) }}>{t('common.remove')}</LinkButton>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {queue && queue.ctl.droppedPhotos().length > 0 && (
          <Card className="attention" aria-label={t('sync.photoNotAccepted')}>
            <h2>{t('sync.photoNotAccepted')}</h2>
            <ul className="plain">
              {queue.ctl.droppedPhotos().map((d) => (
                <li key={d.clientUuid}><span><b className="mono">{pieces(d.qty)}</b> {t('today.droppedLine', { stage: stageLabel(lang, d.stage), date: dayMonth(lang, d.date), note: serverWords(lang, d.note, 'sync.photoGeneric') })}</span></li>
              ))}
            </ul>
            <LinkButton onClick={() => queue.ctl.clearDroppedPhotos()}>{t('common.ok')}</LinkButton>
          </Card>
        )}

        {st.source === 'saved' && st.savedAt && (
          <p className="notice" role="status">{t('today.savedList', { date: dayMonth(lang, istDate(new Date(st.savedAt))), time: new Date(st.savedAt).toLocaleTimeString() })}</p>
        )}
        {st.stages === null && !st.error && (
          <div className="skeletons" role="status" aria-label={t('today.loading')}>
            <ul className="stages plain" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <li key={i} className="stage stage--skeleton">
                  <Skeleton width="45%" height={22} />
                  <Skeleton width="30%" height={20} />
                  <Skeleton width="70%" height={20} />
                  <Skeleton height={56} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {st.stages === null && st.error && (
          <LoadFailed unreachable={st.error.unreachable} message={stagesErrorText(st.error, lang)} onRetry={() => void st.reload()} workSafe />
        )}
        {st.stages && open.length === 0 && <Card as="div"><p>{t('today.nothing')}</p><p className="sub">{t('today.nothingNext')}</p></Card>}
        <ul className="stages plain">
          {open.map((s) => {
            const n = shown(s)
            return (
              <StageCard key={`${s.orderId}/${s.stage}`} po={s.po} meta={`${s.style} · ${s.colour}`} stageName={stageLabel(lang, s.stage)}
                done={n.total} qty={s.qty} today={n.today} dueText={dayMonth(lang, s.plannedEnd)} href={stageHref(s.orderId, s.stage)}
                labels={{ today: t('today.today'), done: t('today.done'), due: t('today.due'), update: t('today.update') }} />
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
