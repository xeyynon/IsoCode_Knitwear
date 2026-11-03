import { useEffect, useRef, useState } from 'react'
import { resizeToJpeg, sizeText } from '../photo/resize'
import { Link, useParams } from 'react-router-dom'
import { shortDate } from '../board/boardLogic'
import { istDate, parsePieces, remainingPieces } from '../dates'
import { useLang } from '../i18n'
import { useQueue } from '../queue/instance'
import { useReasons, useStages } from '../stages/useStages'
import { MAX_NOTE, noteToSend, reasonLabel } from '../notes/reasons'
import { AppBar } from '../ui/AppBar'
import { Loading } from '../ui/Loading'
import { SyncChip } from '../ui/SyncChip'

/**
 * One stage, one number, one big button. The number is saved to the phone FIRST (so it
 * survives a dead signal or a closed app) and sent after. "Saved" means saved on the phone;
 * the chip says when the server has it.
 */
export default function Update() {
  const { t, lang } = useLang()
  const { orderId = '', stage: stageParam = '' } = useParams()
  const stageName = decodeURIComponent(stageParam)
  const { queue, state } = useQueue()
  const st = useStages(queue?.idb ?? null, state?.lastSyncedAt ?? 0)
  const reasons = useReasons(queue?.idb ?? null)
  const [raw, setRaw] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saved, setSaved] = useState<{ qty: number; at: number; photo: boolean; note: boolean } | null>(null)
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [reason, setReason] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url) }, [photo])

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
    const note = noteToSend(noteText, reason)
    await queue.ctl.enqueue({ orderId, stage: stageName, date, qty, ...(photo ? { photo: photo.blob } : {}), ...(note ? { note } : {}) })
    setSaved({ qty, at: Date.now(), photo: photo !== null, note: note !== undefined })
    setRaw(''); setConfirming(false); setPhoto(null); setReason(null); setNoteText('')
    input.current?.focus()
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''                      // so choosing the same picture again still fires
    if (!file) return
    setPhotoError(null); setPreparing(true)
    try { const blob = await resizeToJpeg(file); setPhoto({ blob, url: URL.createObjectURL(blob) }) }
    catch (err) { setPhotoError(err instanceof Error ? err.message : 'That picture could not be used.') }
    setPreparing(false)
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

            <fieldset className="reasons">
              <legend>{t('sup.reason')}</legend>
              <div className="reasons__list" role="radiogroup" aria-label={t('sup.reason')}>
                {reasons.map((r) => (
                  <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} className="reason"
                    onClick={() => setReason(reason === r.id ? null : r.id)}>{reasonLabel(r, lang)}</button>
                ))}
              </div>
            </fieldset>
            <label className="field"><span>{t('sup.note')}</span>
              <textarea className="input textarea" rows={2} maxLength={MAX_NOTE} value={noteText} onChange={(e) => setNoteText(e.target.value)} /></label>

            <div className="photobox">
              <input ref={fileInput} type="file" accept="image/*" capture="environment" className="visually-hidden" onChange={pick} aria-label="Take or choose a photo" tabIndex={-1} />
              {!photo && <button type="button" className="btn" disabled={preparing} onClick={() => fileInput.current?.click()}>{preparing ? 'Preparing…' : 'Add a photo'}</button>}
              {photo && (
                <div className="photobox__preview">
                  <img src={photo.url} alt="The photo that will be sent with this update" />
                  <div><span className="sub">Photo ready ({sizeText(photo.blob.size)})</span><br />
                    <button type="button" className="link" onClick={() => setPhoto(null)}>Remove photo</button></div>
                </div>
              )}
              {photoError && <p className="error" role="alert">{photoError}</p>}
            </div>

            {confirming && qty !== null && (
              <p className="banner" role="alert">{qty} is more than the {left} pieces left. Check the number, then tap Send again.</p>
            )}
            <button className="btn btn--primary btn--block btn--big" disabled={qty === null || !queue}>
              {confirming ? `${t('sup.send')} ${qty} anyway` : t('sup.send')}
            </button>

            {saved && (
              <p className="saved" role="status" aria-live="polite">
                Saved {saved.qty} pieces{saved.photo ? ' with a photo' : ''}{saved.note ? ' and a note' : ''}. {state && state.pending > 0 ? `${state.pending} ${t('sync.waiting')} to send.` : 'Sent.'}
              </p>
            )}
          </form>
        )}
      </main>
    </>
  )
}
