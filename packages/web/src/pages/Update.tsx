import { useEffect, useRef, useState } from 'react'
import { PhotoError, resizeToJpeg, sizeText } from '../photo/resize'
import { useParams } from 'react-router-dom'
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
import { SupervisorShell } from '../ui/templates/SupervisorShell'
import { LoadFailed } from '../ui/LoadFailed'
import { Loading } from '../ui/Loading'
import { Banner } from '../ui/atoms/Banner'
import { Button, ButtonLink } from '../ui/atoms/Button'
import { Card } from '../ui/atoms/Card'
import { ErrorText } from '../ui/atoms/ErrorText'
import { Input, Textarea } from '../ui/atoms/Input'
import { LinkButton, TextLink } from '../ui/atoms/TextLink'
import { ActionBar } from '../ui/molecules/ActionBar'
import { Field } from '../ui/molecules/Field'
import { UpdateHero } from '../ui/organisms/UpdateHero'
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
    <SupervisorShell title={stageName ? stageLabel(lang, stageName).replace(/^./, (c) => c.toUpperCase()) : t('sup.title')} plainTitle={!!stage}>
        {/* One row: the way back and the sync chip. Two rows pushed the number field behind the bar when the keyboard is up (phase 8A). */}
        <div className="update__bar">
          <TextLink className="back back--arrow" to="/today"><svg className="back__arrow" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M16 10H4M9.5 4.5 4 10l5.5 5.5" /></svg> <span className="back__text">{t('sup.title')}</span></TextLink>
          {queue && state && <SyncChip state={state} ctl={queue.ctl} />}
        </div>

        {!st.stages && !st.error && <Loading label={t('common.loading')} />}
        {st.error && !st.stages && <LoadFailed unreachable={st.error.unreachable} message={stagesErrorText(st.error, lang)} onRetry={() => void st.reload()} workSafe />}
        {st.stages && !stage && <Card as="div"><p>{t('update.notInList')}</p></Card>}

        {stage && (
          <form className="update" onSubmit={(e) => { e.preventDefault(); void send() }}>
            <UpdateHero po={stage.po} meta={`${stage.style} · ${stage.colour} · ${t('update.due', { date: dayMonth(lang, stage.plannedEnd) })}`}
              done={done} qty={stage.qty} todaySoFar={todayTotal} left={left} labels={{ todaySoFar: t('update.todaySoFar'), left: t('update.left') }} />

            <Card as="div" className="update__body">
            <Field label={t('sup.pieces')}>
              <Input ref={input} big mono asking={confirming} inputMode="numeric" pattern="[0-9]*" autoComplete="off"
                value={raw} aria-describedby={confirming ? 'hint toomany' : 'hint'} aria-invalid={notWholeNumber(raw)} onChange={(e) => { setRaw(e.target.value); setConfirming(false) }} />
            </Field>
            <p id="hint" className="sub">{t('update.hint')}</p>
            {notWholeNumber(raw) && <ErrorText>{t('sup.wholeNumber')}</ErrorText>}

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
            <Field label={t('sup.note')}>
              <Textarea rows={2} maxLength={MAX_NOTE} value={noteText} onChange={(e) => setNoteText(e.target.value)} /></Field>

            <div className="photobox">
              <input ref={fileInput} type="file" accept="image/*" capture="environment" className="visually-hidden" onChange={pick} aria-label={t('photo.input')} tabIndex={-1} />
              {!photo && <Button ref={addPhoto} type="button" disabled={preparing} onClick={() => fileInput.current?.click()}>{preparing ? t('photo.preparing') : t('photo.add')}</Button>}
              {photo && (
                <div className="photobox__preview">
                  <img src={photo.url} alt={t('photo.alt')} />
                  <div className="photobox__actions"><span className="sub">{t('photo.ready', { size: sizeText(photo.blob.size) })}</span>
                    <Button ref={retakePhoto} type="button" disabled={preparing} onClick={() => { retaking.current = true; fileInput.current?.click() }}>{preparing ? t('photo.preparing') : t('photo.retake')}</Button>
                    <LinkButton ref={removePhoto} type="button" onClick={() => { photoFocus.current = true; retaking.current = false; setPhoto(null) }}>{t('photo.remove')}</LinkButton></div>
                </div>
              )}
              {photoError && <ErrorText>{t(photoError)}</ErrorText>}
            </div>

            {/* The action stays at the bottom of the screen while the form scrolls (slice 1.1). Reading order: a failure, what
                happened to the last update, a question about this number, then the button. */}
            <ActionBar>
              {saveError && <ErrorText>{t(saveError)}</ErrorText>}

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
                <ButtonLink block to={stageHref(next.orderId, next.stage)}>
                  {t('update.next', { po: next.po, stage: stageLabel(lang, next.stage).replace(/^./, (c) => c.toUpperCase()) })}
                </ButtonLink>
              )}

              {confirming && qty !== null && (
                <Banner id="toomany">{t('update.tooMany', { qty, left })}</Banner>
              )}
              <Button variant="primary" block size="big" disabled={qty === null || !queue || busy}>
                {confirming ? t('update.sendAnyway', { qty: qty ?? '' }) : t('sup.send')}
              </Button>
            </ActionBar>
            </Card>
          </form>
        )}
    </SupervisorShell>
  )
}
