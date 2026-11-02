import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { shortDate } from '../board/boardLogic'
import { istDate, parsePieces, remainingPieces } from '../dates'
import { useLang } from '../i18n'
import { useQueue } from '../queue/instance'
import { useStages } from '../stages/useStages'
import { AppBar } from '../ui/AppBar'
import { Loading } from '../ui/Loading'
import { SyncChip } from '../ui/SyncChip'

/**
 * One stage, one number, one big button. The number is saved to the phone FIRST (so it
 * survives a dead signal or a closed app) and sent after. "Saved" means saved on the phone;
 * the chip says when the server has it.
 */
export default function Update() {
  const { t } = useLang()
  const { orderId = '', stage: stageParam = '' } = useParams()
  const stageName = decodeURIComponent(stageParam)
  const { queue, state } = useQueue()
  const st = useStages(queue?.idb ?? null, state?.lastSyncedAt ?? 0)
  const [raw, setRaw] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saved, setSaved] = useState<{ qty: number; at: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [queue])

  const stage = st.stages?.find((s) => s.orderId === orderId && s.stage === stageName)
  const date = st.today ?? istDate()
  const extra = stage && queue ? queue.ctl.waitingQty(orderId, stageName, date) + queue.ctl.sentSince(orderId, stageName, date, st.fetchStartedAt) : 0
  const todayTotal = (stage?.todayQty ?? 0) + extra
  const done = (stage?.produced ?? 0) + extra
  const left = stage ? remainingPieces(stage.qty, done) : 0
  const qty = parsePieces(raw)
  // More than is left is possible (over-production), but it is far more often a typing slip: ask once.
  const overLeft = qty !== null && stage !== undefined && qty > left

  async function send() {
    if (qty === null || !queue || !stage) return
    if (overLeft && !confirming) { setConfirming(true); return }
    await queue.ctl.enqueue({ orderId, stage: stageName, date, qty })
    setSaved({ qty, at: Date.now() })
    setRaw(''); setConfirming(false)
    input.current?.focus()
  }

  return (
    <>
      <AppBar title={stageName ? stageName.charAt(0).toUpperCase() + stageName.slice(1) : t('sup.title')} />
      <main className="page page--narrow">
        <Link className="link back" to="/today">← {t('sup.title')}</Link>
        {queue && state && <SyncChip state={state} ctl={queue.ctl} />}

        {!st.stages && !st.error && <Loading label="Loading" />}
        {st.error && !st.stages && <div className="card" role="alert"><p>{st.error}</p></div>}
        {st.stages && !stage && <div className="card"><p>This stage is not in your list.</p></div>}

        {stage && (
          <form className="card update" onSubmit={(e) => { e.preventDefault(); void send() }}>
            <h1 className="mono">{stage.po}</h1>
            <p className="sub">{stage.style} · {stage.colour} · due {shortDate(stage.plannedEnd)}</p>
            <p className="update__nums mono">
              <span>Today so far <b>{todayTotal}</b></span>
              <span>Left <b>{left}</b></span>
            </p>

            <label className="field">
              <span>{t('sup.pieces')}</span>
              <input ref={input} className="input input--big mono" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
                value={raw} aria-describedby="hint" onChange={(e) => { setRaw(e.target.value.replace(/\D/g, '')); setConfirming(false) }} />
            </label>
            <p id="hint" className="sub">Enter the pieces made since your last update. They are added to today's total.</p>

            {confirming && qty !== null && (
              <p className="banner" role="alert">{qty} is more than the {left} pieces left. Check the number, then tap Send again.</p>
            )}
            <button className="btn btn--primary btn--block btn--big" disabled={qty === null || !queue}>
              {confirming ? `${t('sup.send')} ${qty} anyway` : t('sup.send')}
            </button>

            {saved && (
              <p className="saved" role="status" aria-live="polite">
                Saved {saved.qty} pieces. {state && state.pending > 0 ? `${state.pending} ${t('sync.waiting')} to send.` : 'Sent.'}
              </p>
            )}
          </form>
        )}
      </main>
    </>
  )
}
