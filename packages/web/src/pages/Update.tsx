import { useEffect, useRef, useState } from 'react'
import { PhotoError, resizeToJpeg, sizeText } from '../photo/resize'
import { Link, useParams } from 'react-router-dom'
import { istDate, notWholeNumber, parsePieces, remainingPieces } from '../dates'
import { pieces } from '../numberFormat'
import { dayMonth, savedText, serverWords, stageLabel, useLang, type Key } from '../i18n'
import { useQueue } from '../queue/instance'
import { oneAtATime } from '../queue/oneAtATime'
import { saveFailedKey } from '../queue/storageStatus'
import { nextStage } from '../stages/dayProgress'
import { stageFromParam, stageHref } from '../stages/stageLink'
import { stagesErrorText, useReasons, useStages } from '../stages/useStages'
import { MAX_NOTE, noteToSend, reasonLabel, toggleReason } from '../notes/reasons'
import { AppBar } from '../ui/AppBar'
import { LoadFailed } from '../ui/LoadFailed'
import { Loading } from '../ui/Loading'
import { ActionBar } from '../ui/molecules/ActionBar'
import { SyncChip } from '../ui/SyncChip'
import { setUnsentInput } from '../ui/unsentInput'

/**
 * One stage, one number, one big button. The number is saved to the phone FIRST (so it
 * survives a dead signal or a closed app) and sent after. "Saved" means saved on the phone;
 * the chip says when the server has it.
 */
export default function Update() {
  const { orderId = '', stage = '' } = useParams()
  // Keyed by the stage it shows: "Next stage" moves here without leaving the screen, and a fresh form must not carry the last
  // stage's "Saved" line or typed number.
  return <UpdateStage key={`${orderId}/${stage}`} />
}

function UpdateStage() {
  const { t, lang } = useLang()
  const { orderId = '', stage: stageParam = '' } = useParams()
  const stageName = stageFromParam(stageParam)
  const { queue, state } = useQueue()
  const st = useStages(queue?.idb ?? null, state?.lastSyncedAt ?? 0)
  const reasons = useReasons(queue?.idb ?? null)
  const [raw, setRaw] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saved, setSaved] = useState<{ id: string; qty: number; at: number; photo: boolean; note: boolean } | null>(null)
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null)
  const [photoError, setPhotoError] = useState<Key | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [saveError, setSaveError] = useState<Key | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  // A save still running: a second tap on Send must not queue the same count again.
  const saving = useRef(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const addPhoto = useRef<HTMLButtonElement>(null)
  const removePhoto = useRef<HTMLButtonElement>(null)
  const retakePhoto = useRef<HTMLButtonElement>(null)
  // Picking or removing a photo swaps one button for the other: move focus to the new one, never to <body>.
  // After a retake the same button stays, so focus returns to Retake rather than jumping to Remove.
  const photoFocus = useRef(false)
  const retaking = useRef(false)
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url) }, [photo])
  useEffect(() => {
    if (!photoFocus.current) return
    photoFocus.current = false
    ;(photo ? (retaking.current ? retakePhoto : removePhoto) : addPhoto).current?.focus()
    retaking.current = false
  }, [photo])

  // The "new version is ready" banner waits while anything here is typed but not yet saved; it
  // shows once the update is saved (the fields are cleared) or this screen is left.
  const unsent = raw !== '' || noteText !== '' || reason !== null || photo !== null || preparing
  useEffect(() => { setUnsentInput('update', unsent) }, [unsent])
  useEffect(() => () => setUnsentInput('update', false), [])

  const stage = st.stages?.find((s) => s.orderId === orderId && s.stage === stageName)
  // The number field only exists once the stage has loaded, so that is when it takes the cursor (it used to wait for the queue, which
  // opens first, and focused nothing).
  const hasStage = stage !== undefined
  useEffect(() => { if (hasStage) input.current?.focus() }, [hasStage])
  const date = st.today ?? istDate()
  const extra = stage && queue ? queue.ctl.waitingQty(orderId, stageName, date) + queue.ctl.sentSince(orderId, stageName, date, st.fetchStartedAt) : 0
  const todayTotal = (stage?.todayQty ?? 0) + extra
  const done = (stage?.produced ?? 0) + extra
  const left = stage ? remainingPieces(stage.qty, done) : 0
  const qty = parsePieces(raw)
  // More than is left is possible (over-production), but it is far more often a typing slip: ask once.
  const overLeft = qty !== null && stage !== undefined && qty > left
  // What became of the last update: "Sent." only once the server confirmed THAT update.
  const savedStatus = saved && queue ? queue.ctl.statusOf(saved.id) : null
  const refusedWhy = savedStatus === 'rejected' ? state?.rejected.find((r) => r.clientUuid === saved?.id)?.reason : undefined
  // After a send, the next stage with no update today is one tap away (slice 1.9). Pieces saved on this phone count as an update.
  const next = saved && savedStatus !== 'rejected' && st.stages && queue && stage
    ? nextStage(st.stages, { orderId, stage: stageName }, (s) => queue.ctl.waitingQty(s.orderId, s.stage, date) + queue.ctl.sentSince(s.orderId, s.stage, date, st.fetchStartedAt))
    : null
  // The pieces went but the server refused the photo: say so, never "sent with a photo".
  const photoDropped = saved && queue ? queue.ctl.photoNoteOf(saved.id) : null

  async function send() {
    if (qty === null || !queue || !stage) return
    if (overLeft && !confirming) { setConfirming(true); return }
    const note = noteToSend(noteText, reason)
    setBusy(true)
    setSaveError(null)
    await oneAtATime(saving, async () => {
      try {
        const item = await queue.ctl.enqueue({ orderId, stage: stageName, date, qty, ...(photo ? { photo: photo.blob } : {}), ...(note ? { note } : {}) })
        setSaved({ id: item.clientUuid, qty, at: Date.now(), photo: photo !== null, note: note !== undefined })
        setRaw(''); setConfirming(false); setPhoto(null); setReason(null); setNoteText('')
      } catch (err) {
        // The phone could not keep it (storage full): the old "Saved … Sent." line must not stand for this update.
        setSaved(null); setConfirming(false); setSaveError(saveFailedKey(err))
      }
    }).finally(() => setBusy(saving.current))
    input.current?.focus()
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''                      // so choosing the same picture again still fires
    if (!file) return
    setPhotoError(null); setPreparing(true)
    try { const blob = await resizeToJpeg(file); photoFocus.current = true; setPhoto({ blob, url: URL.createObjectURL(blob) }) }
    catch (err) { retaking.current = false; setPhotoError(err instanceof PhotoError ? err.key : 'photo.unusable') }
    setPreparing(false)
  }

  return (
    <>
      <AppBar title={stageName ? stageLabel(lang, stageName).replace(/^./, (c) => c.toUpperCase()) : t('sup.title')} plainTitle={!!stage} />
      <main className="page page--narrow">
        <Link className="link back" to="/today">← {t('sup.title')}</Link>
        {queue && state && <SyncChip state={state} ctl={queue.ctl} />}

        {!st.stages && !st.error && <Loading label={t('common.loading')} />}
        {st.error && !st.stages && <LoadFailed unreachable={st.error.unreachable} message={stagesErrorText(st.error, lang)} onRetry={() => void st.reload()} workSafe />}
        {st.stages && !stage && <div className="card"><p>{t('update.notInList')}</p></div>}

        {stage && (
          <form className="card update" onSubmit={(e) => { e.preventDefault(); void send() }}>
            <h1 className="mono">{stage.po}</h1>
            <p className="sub">{stage.style} · {stage.colour} · {t('update.due', { date: dayMonth(lang, stage.plannedEnd) })}</p>
            <p className="update__nums mono">
              <span>{t('update.todaySoFar')} <b>{pieces(todayTotal)}</b></span>
              <span>{t('update.left')} <b>{pieces(left)}</b></span>
            </p>

            <label className="field">
              <span>{t('sup.pieces')}</span>
              <input ref={input} className={`input input--big mono${confirming ? ' input--asking' : ''}`} inputMode="numeric" pattern="[0-9]*" autoComplete="off"
                value={raw} aria-describedby={confirming ? 'hint toomany' : 'hint'} aria-invalid={notWholeNumber(raw)} onChange={(e) => { setRaw(e.target.value); setConfirming(false) }} />
            </label>
            <p id="hint" className="sub">{t('update.hint')}</p>
            {notWholeNumber(raw) && <p className="error" role="alert">{t('sup.wholeNumber')}</p>}

            <fieldset className="reasons">
              <legend>{t('sup.reason')}</legend>
              {/* Real radios (arrow keys and the group come from the browser); the click, not "change", decides so a second tap clears. */}
              <div className="reasons__list">
                {reasons.map((r) => (
                  <label key={r.id} className="reason">
                    <input type="radio" name="reason" className="visually-hidden" value={r.id} checked={reason === r.id}
                      onChange={() => undefined} onClick={() => setReason(toggleReason(reason, r.id))} />
                    <span className="reason__pill">{reasonLabel(r, lang)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field"><span>{t('sup.note')}</span>
              <textarea className="input textarea" rows={2} maxLength={MAX_NOTE} value={noteText} onChange={(e) => setNoteText(e.target.value)} /></label>

            <div className="photobox">
              <input ref={fileInput} type="file" accept="image/*" capture="environment" className="visually-hidden" onChange={pick} aria-label={t('photo.input')} tabIndex={-1} />
              {!photo && <button ref={addPhoto} type="button" className="btn" disabled={preparing} onClick={() => fileInput.current?.click()}>{preparing ? t('photo.preparing') : t('photo.add')}</button>}
              {photo && (
                <div className="photobox__preview">
                  <img src={photo.url} alt={t('photo.alt')} />
                  <div className="photobox__actions"><span className="sub">{t('photo.ready', { size: sizeText(photo.blob.size) })}</span>
                    <button ref={retakePhoto} type="button" className="btn" disabled={preparing} onClick={() => { retaking.current = true; fileInput.current?.click() }}>{preparing ? t('photo.preparing') : t('photo.retake')}</button>
                    <button ref={removePhoto} type="button" className="link" onClick={() => { photoFocus.current = true; retaking.current = false; setPhoto(null) }}>{t('photo.remove')}</button></div>
                </div>
              )}
              {photoError && <p className="error" role="alert">{t(photoError)}</p>}
            </div>

            {/* The action stays at the bottom of the screen while the form scrolls (slice 1.1). Reading order: a failure, what
                happened to the last update, a question about this number, then the button. */}
            <ActionBar>
              {saveError && <p className="error" role="alert">{t(saveError)}</p>}

              {saved && (
                <p className="saved" role="status" aria-live="polite">
                  {savedText(lang, saved.qty, saved.photo, saved.note)}{' '}
                  {savedStatus === 'sent' && photoDropped ? <b>{t('sync.photoNotAccepted')}: {serverWords(lang, photoDropped, 'sync.photoGeneric')}</b>
                    : savedStatus === 'sent' ? t('sync.sent')
                    : savedStatus === 'rejected' ? <b>{t('sync.notAccepted')}: {serverWords(lang, refusedWhy, 'sync.refusedGeneric')}</b>
                    : savedStatus === 'pending' && state ? t('sync.waitingToSend', { n: state.pending }) : ''}
                </p>
              )}

              {next && (
                <Link className="btn btn--block" to={stageHref(next.orderId, next.stage)}>
                  {t('update.next', { po: next.po, stage: stageLabel(lang, next.stage).replace(/^./, (c) => c.toUpperCase()) })}
                </Link>
              )}

              {confirming && qty !== null && (
                <p id="toomany" className="banner" role="alert">{t('update.tooMany', { qty, left })}</p>
              )}
              <button className="btn btn--primary btn--block btn--big" disabled={qty === null || !queue || busy}>
                {confirming ? t('update.sendAnyway', { qty: qty ?? '' }) : t('sup.send')}
              </button>
            </ActionBar>
          </form>
        )}
      </main>
    </>
  )
}
