import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { downloadFile } from '../api/download'
import { ApiError, apiFetch } from '../api/session'
import { shortDateIn } from '../board/boardLogic'
import { istDate } from '../dates'
import { exportFileName } from '../review/exportLogic'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import { oneAtATime } from '../queue/oneAtATime'
import { activeLinkCount, afterRevoke, buyerLinkUrl, emptyLine, linkStatus, offersNoReason, parseDays, reviewSummary, sectionAnchor, sectionTitle, splitLinks, type ReviewSectionId } from '../review/reviewLogic'
import { MerchandiserShell } from '../ui/templates/MerchandiserShell'
import { LoadFailed } from '../ui/LoadFailed'
import { notifyReviewChanged } from '../ui/useReviewCount'
import { Loading } from '../ui/Loading'
import { reasonById, type Reason } from '../notes/reasons'
import { AI_REST_MS, aiLine, defaultMeaning, defaultReason, disagreement, MAX_AI_ROUNDS, reasonSource, waitingForAi, type NoteSuggestion } from '../review/noteAiLogic'
import { AuthImage } from '../ui/AuthImage'
import { StatusBadge } from '../ui/StatusBadge'
import { Banner } from '../ui/atoms/Banner'
import { Button } from '../ui/atoms/Button'
import { Card } from '../ui/atoms/Card'
import { ErrorText } from '../ui/atoms/ErrorText'
import { Input, Select, Textarea } from '../ui/atoms/Input'
import { Field } from '../ui/molecules/Field'
import { InlineUndo } from '../ui/molecules/InlineUndo'
import { afterHide, afterUndo, offersUndo, undoOutcome, type HiddenFrom, type HiddenItem } from '../review/undoLogic'

interface Item { id: string; orderId: string; po: string; buyerName: string; stage: string; status: 'amber' | 'red'; buyerText: string; maths: string; state: string }
interface PendingNote { id: string; po: string; buyerName: string; stage: string; takenOn: string; language: 'ta' | 'en' | null; original: string | null; textEn: string | null; category: string | null; categoryBy: string | null; ai: NoteSuggestion | null }
interface VisiblePhoto { id: string; po: string; buyerName: string; stage: string; takenOn: string }
interface PendingPhoto { id: string; po: string; buyerName: string; stage: string; takenOn: string; bytes: number }
interface LinkRow { id: string; buyerId: string; buyerName: string; label: string | null; expiresAt: string; revoked: boolean; expired: boolean }
interface Options { buyers: { id: string; name: string }[] }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function Review() {
  const [data, setData] = useState<{ needsReview: Item[]; confirmed: Item[]; photos: PendingPhoto[]; approvedPhotos: VisiblePhoto[]; notes: PendingNote[]; reasons: Reason[]; aiEnabled?: boolean } | null>(null)
  const [meaning, setMeaning] = useState<Record<string, string>>({})
  const [noteReason, setNoteReason] = useState<Record<string, string>>({})
  const [links, setLinks] = useState<LinkRow[]>([])
  const [buyers, setBuyers] = useState<Options['buyers']>([])
  const [error, setError] = useState<LoadFailure | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // A refusal is drawn above the list, often far from the button that was pressed: focus goes to it once it has rendered (same as the new-order form).
  const [actionFailures, setActionFailures] = useState(0)
  const actionErrorRef = useRef<HTMLParagraphElement>(null)
  const fail = (message: string) => { setActionError(message); setActionFailures((n) => n + 1) }
  useEffect(() => { if (actionFailures > 0) actionErrorRef.current?.focus() }, [actionFailures])
  const [announce, setAnnounce] = useState('')
  // Warnings hidden from the waiting list during this visit, each with an Undo line where its card was (slice 4.1). Local to the page: a reload ends them.
  const [hidden, setHidden] = useState<HiddenItem[]>([])
  const [undoFailed, setUndoFailed] = useState<Record<string, { text: string; final: boolean }>>({})
  const pendingHeading = useRef<HTMLHeadingElement>(null)
  const notesHeading = useRef<HTMLHeadingElement>(null)
  const photosHeading = useRef<HTMLHeadingElement>(null)
  const approvedHeading = useRef<HTMLHeadingElement>(null)
  const confirmedHeading = useRef<HTMLHeadingElement>(null)
  const linksHeading = useRef<HTMLHeadingElement>(null)

  const [buyerId, setBuyerId] = useState('')
  const [days, setDays] = useState('30')
  const [label, setLabel] = useState('')
  const [made, setMade] = useState<{ id: string; url: string; copied: boolean } | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)   // the cancelled and expired links are folded until asked for
  const making = useRef(false)

  const load = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([
        apiFetch<{ needsReview: Item[]; confirmed: Item[]; photos: PendingPhoto[]; approvedPhotos: VisiblePhoto[]; notes: PendingNote[]; reasons: Reason[]; aiEnabled?: boolean }>('/api/review'),
        apiFetch<{ links: LinkRow[] }>('/api/buyer-links'),
      ])
      setData(r); setLinks(l.links); setError(null)
      notifyReviewChanged()   // the number on the Review tab in the app bar follows what this page just loaded
    } catch (e) { setError(describeFailure(e, 'Could not load the review queue.')) }
  }, [])
  useEffect(() => {
    void load()
    apiFetch<Options>('/api/orders/options').then((o) => setBuyers(o.buyers)).catch(() => undefined)
  }, [load])

  // AI suggestions for notes still waiting for one: a few per call, again while any are left, at most MAX_AI_ROUNDS rounds per visit. A round
  // that asked nothing (the server is pausing a rate-limited batch) is followed by a rest of a minute. When the page stops (a failure, or the rounds
  // are used) the notes still without an answer say so and can be asked again by hand. Nothing here moves focus or blocks the page.
  const aiRounds = useRef(0)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [aiResting, setAiResting] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  const [allMessage, setAllMessage] = useState<string | null>(null)                           // the server's sentence when it refused the whole batch
  const [noteMessage, setNoteMessage] = useState<Record<string, string>>({})                  // ...or one note (asked enough times)
  const restTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(restTimer.current), [])
  useEffect(() => {
    if (!data?.aiEnabled || aiBusy || aiResting || gaveUp || !data.notes.some(waitingForAi)) return
    if (aiRounds.current >= MAX_AI_ROUNDS) { setGaveUp(true); return }
    aiRounds.current++
    setAiBusy('all')
    apiFetch<{ asked?: number }>('/api/notes/suggest', { method: 'POST', body: '{}' })
      .then((r) => {
        if (!r?.asked) {
          setAiResting(true)
          restTimer.current = window.setTimeout(() => setAiResting(false), AI_REST_MS)
        }
        return load()
      })
      .catch((e) => {   // the service is down, busy for the day, or AI was switched off: stop asking on this visit and say so on the notes
        aiRounds.current = MAX_AI_ROUNDS
        if (e instanceof ApiError && e.code === 'ai_busy') setAllMessage(e.message)
        setGaveUp(true)
      })
      .finally(() => setAiBusy(null))
  }, [data, aiBusy, aiResting, gaveUp, load])

  async function askAgain(n: PendingNote) {
    setAiBusy(n.id); setActionError(null)
    setNoteMessage(({ [n.id]: _gone, ...rest }) => rest)
    try {
      await apiFetch(`/api/notes/${n.id}/suggest`, { method: 'POST', body: '{}' })
      setAnnounce(`Asked the AI again about the note on ${n.po}.`)
      await load()
    } catch (e) {
      // "Asked enough" and "busy today" are about this note's suggestion, so they are said on the note; anything else is a message for the page.
      if (e instanceof ApiError && (e.code === 'ai_ask_limit' || e.code === 'ai_busy')) setNoteMessage((m) => ({ ...m, [n.id]: e.message }))
      else fail(e instanceof ApiError ? e.message : 'That did not work. Please try again.')
    }
    setAiBusy(null)
  }

  // 'dismiss-waiting' is "Don't show" on a warning still waiting for review; 'dismiss' is "Hide from buyer" on one that was confirmed. Both call the same
  // route, but only the first can be undone: a confirmed warning may already have been seen by a buyer (rule 18).
  async function decide(item: Item, action: 'confirm' | 'dismiss-waiting' | 'dismiss', heading: React.RefObject<HTMLHeadingElement | null>) {
    setBusy(item.id); setActionError(null)
    try {
      const text = edits[item.id]
      // Say what was on screen, so a warning a refresh has changed since is not confirmed unseen.
      const body = action === 'confirm' ? { ...(text !== undefined ? { text } : {}), seenStatus: item.status, seenText: item.buyerText } : {}
      await apiFetch(`/api/warnings/${item.id}/${action === 'confirm' ? 'confirm' : 'dismiss'}`, { method: 'POST', body: JSON.stringify(body) })
      const from: HiddenFrom = action === 'dismiss-waiting' ? 'waiting' : 'confirmed'
      const undoable = action !== 'confirm' && offersUndo(from)
      if (undoable) {
        setHidden((h) => afterHide(h, { id: item.id, po: item.po, stage: item.stage, buyerName: item.buyerName }))
        setUndoFailed(({ [item.id]: _gone, ...rest }) => rest)
      }
      setAnnounce(action === 'confirm' ? `Confirmed. ${item.po} ${item.stage} is now visible to ${item.buyerName}.` : `Dismissed. ${item.buyerName} will not see it.${undoable ? ' You can undo this below the section heading.' : ''}`)
      await load()
      heading.current?.focus()      // the card that had focus is gone: back to the heading of its own section
    } catch (e) {
      fail(e instanceof ApiError ? e.message : 'That did not work. Please try again.')
      if (e instanceof ApiError && e.code === 'changed') await load()      // show the new colour and wording
    }
    setBusy(null)
  }

  // Bring a hidden warning back to "waiting for review" (the server refreshes its wording and figures in the same step). A refusal or a failure is said
  // in words on the same line and changes nothing else on the page.
  async function undoHide(h: HiddenItem, heading: React.RefObject<HTMLHeadingElement | null>) {
    const key = `undo:${h.id}`
    setBusy(key); setUndoFailed(({ [h.id]: _gone, ...rest }) => rest)
    try {
      await apiFetch(`/api/warnings/${h.id}/undo-dismiss`, { method: 'POST', body: '{}' })
      setHidden((list) => afterUndo(list, h.id))
      setAnnounce(`Back in the list: ${h.po} ${cap(h.stage)}. ${h.buyerName} still cannot see it until you confirm it.`)
      await load(); heading.current?.focus()      // the Undo button is gone with its line: back to the heading of its own section
    } catch (e) {
      const o = undoOutcome(e)
      if (o.back) {
        setHidden((list) => afterUndo(list, h.id)); setAnnounce(o.text)
        await load(); heading.current?.focus()
      } else {
        setUndoFailed((f) => ({ ...f, [h.id]: { text: o.text, final: o.final } }))
      }
    }
    setBusy(null)
  }

  async function reviewNote(n: PendingNote, heading: React.RefObject<HTMLHeadingElement | null>) {
    setBusy(n.id); setActionError(null)
    try {
      await apiFetch(`/api/notes/${n.id}/confirm`, {
        method: 'POST',
        // What is on screen is what is saved: the English box (an AI draft the person may have edited) and the reason in the picker.
        body: JSON.stringify((() => {
          const textEn = defaultMeaning(n, meaning[n.id]).trim()
          const category = defaultReason(n, noteReason[n.id])
          return { ...(n.language === 'ta' && textEn ? { textEn } : {}), ...(category ? { category } : {}) }
        })()),
      })
      setAnnounce(`Reviewed the note on ${n.po}.`)
      await load(); heading.current?.focus()
    } catch (e) { fail(e instanceof ApiError ? e.message : 'That did not work. Please try again.') }
    setBusy(null)
  }

  async function decidePhoto(p: PendingPhoto | VisiblePhoto, action: 'approve' | 'reject', heading: React.RefObject<HTMLHeadingElement | null>) {
    setBusy(p.id); setActionError(null)
    try {
      await apiFetch(`/api/photos/${p.id}/${action}`, { method: 'POST', body: '{}' })
      setAnnounce(action === 'approve' ? `Approved. The ${p.stage} photo for ${p.po} is now visible to ${p.buyerName}.` : 'Rejected. It will not be shown.')
      await load(); heading.current?.focus()
    } catch (e) { fail(e instanceof ApiError ? e.message : 'That did not work. Please try again.') }
    setBusy(null)
  }

  // A jump link moves focus to the heading (so a screen reader reads where it landed) and scrolls it
  // clear of the sticky bars (scroll-margin-top on the heading); the address is left alone.
  const headings: Record<ReviewSectionId, React.RefObject<HTMLHeadingElement | null>> = {
    warnings: pendingHeading, notes: notesHeading, photos: photosHeading, approved: approvedHeading, confirmed: confirmedHeading, links: linksHeading,
  }
  function jump(e: React.MouseEvent, id: ReviewSectionId) {
    const h = headings[id].current
    if (!h) return
    e.preventDefault()
    h.focus({ preventScroll: true })
    h.scrollIntoView({ block: 'start' })
  }

  async function makeLink(e: React.FormEvent) {
    e.preventDefault()
    setLinkError(null); setMade(null)
    const d = parseDays(days)
    if (!buyerId) return setLinkError('Choose a buyer.')
    if (d === null) return setLinkError('Enter a number of days from 1 to 180.')
    // A second click while the first is running would make a second active link whose token nobody sees.
    await oneAtATime(making, async () => {
      setBusy('link')
      try {
        const r = await apiFetch<{ id: string; token: string }>('/api/buyer-links', { method: 'POST', body: JSON.stringify({ buyerId, days: d, label }) })
        setMade({ id: r.id, url: buyerLinkUrl(window.location.origin, r.token), copied: false })
        setLabel(''); await load()
      } catch (err) { setLinkError(err instanceof ApiError ? err.message : 'Could not make the link.') }
      setBusy(null)
    })
  }

  async function copy() {
    if (!made) return
    try { await navigator.clipboard.writeText(made.url); setMade({ ...made, copied: true }) }
    catch { document.getElementById('link-url')?.focus(); (document.getElementById('link-url') as HTMLInputElement | null)?.select() }   // no clipboard access: select it so Ctrl+C works
  }

  async function revoke(id: string) {
    try {
      await apiFetch(`/api/buyer-links/${id}/revoke`, { method: 'POST', body: '{}' })
      const next = afterRevoke(made, id)      // a cancelled link must not stay on offer for copying
      setMade(next.made); setAnnounce(next.announce)
      await load(); linksHeading.current?.focus()      // the Cancel button is gone with the link
    }
    catch (e) { setLinkError(e instanceof ApiError ? e.message : 'Could not cancel the link.') }
  }

  // The file is the buyer's own page as a spreadsheet; the button sits on the buyer's row.
  async function exportBuyer(l: LinkRow) {
    setBusy(`export:${l.id}`); setExportError(null)
    try { await downloadFile(`/api/buyers/${l.buyerId}/export.csv`, exportFileName(l.buyerName, istDate())) }
    catch (e) { setExportError(`${l.buyerName}: ${(e as Error).message}`) }
    finally { setBusy(null) }
  }

  const today = istDate()
  const active = activeLinkCount(links)
  const { working, past } = splitLinks(links)
  const shownLinks = showPast ? [...working, ...past] : working
  // A section with nothing in it keeps its heading and shrinks to one calm line.
  const sec = (count: number) => (count === 0 ? 'rvsec rvsec--empty' : 'rvsec')

  return (
    <MerchandiserShell title="Review" form>
        <p className="visually-hidden" role="status" aria-live="polite">{announce}</p>
        {!data && !error && <Loading label="Loading" />}
        {error && <LoadFailed unreachable={error.unreachable} message={error.message} onRetry={() => void load()} />}
        {actionError && <Banner tabIndex={-1} ref={actionErrorRef}>{actionError}</Banner>}

        {data && (
          <>
            <nav className="rvbar" aria-label="Sections of this page">
              <ul className="plain rvbar__list">
                {reviewSummary({ warnings: data.needsReview.length, notes: data.notes.length, photos: data.photos.length, approved: data.approvedPhotos.length, confirmed: data.confirmed.length, activeLinks: active }).map((i) => (
                  <li key={i.key}>
                    <a className={`rvbar__item${i.count === 0 ? ' rvbar__item--none' : ''}`} href={`#${sectionAnchor(i.target)}`} title={i.fullLabel} onClick={(e) => jump(e, i.target)}>
                      <b className="mono">{i.count}</b> <span>{i.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <section className={sec(data.needsReview.length)} aria-labelledby={sectionAnchor('warnings')}>
              <h2 id={sectionAnchor('warnings')} tabIndex={-1} ref={pendingHeading}>{sectionTitle('Waiting for your review', data.needsReview.length)}</h2>
              {hidden.length > 0 && (
                <ul className="plain stagelist" aria-label="Hidden from buyers, can be undone">
                  {hidden.map((h) => (
                    <InlineUndo key={h.id} label={`${h.po} · ${cap(h.stage)} is hidden. ${h.buyerName} will not see it.`} name={`${h.po} ${cap(h.stage)}`}
                      busy={busy === `undo:${h.id}`} error={undoFailed[h.id]?.text} final={undoFailed[h.id]?.final} onUndo={() => void undoHide(h, pendingHeading)} />
                  ))}
                </ul>
              )}
              {data.needsReview.length === 0 ?<p className="sub">{emptyLine('warnings')}</p> : (
                <>
                  <p className="sub">Nothing here is visible to a buyer until you confirm it. You can change the wording first. The figures below the wording are for you only.</p>
                  <ul className="plain stagelist">
                    {data.needsReview.map((w) => (
                      <li key={w.id} className="stagecard">
                        <div className="stagecard__top"><b className="mono">{w.po}</b><span className="sub">{w.buyerName} · {cap(w.stage)}</span><StatusBadge status={w.status} /></div>
                        <p className="sub internal">Only you see this: {w.maths}</p>
                        <Field label={<>What {w.buyerName} would read</>}>
                          <Textarea rows={2} maxLength={300} value={edits[w.id] ?? w.buyerText}
                            onChange={(e) => setEdits({ ...edits, [w.id]: e.target.value })} /></Field>
                        <div className="actions">
                          <Button variant="primary" disabled={busy === w.id || !(edits[w.id] ?? w.buyerText).trim()} onClick={() => void decide(w, 'confirm', pendingHeading)}>Confirm for buyer</Button>
                          <Button disabled={busy === w.id} onClick={() => void decide(w, 'dismiss-waiting', pendingHeading)}>Don't show</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className={sec(data.notes.length)} aria-labelledby={sectionAnchor('notes')}>
              <h2 id={sectionAnchor('notes')} tabIndex={-1} ref={notesHeading}>{sectionTitle('Notes from the floor', data.notes.length)}</h2>
              {data.notes.length === 0 ? <p className="sub">{emptyLine('notes')}</p> : (
                <>
                  <p className="sub">What supervisors wrote about why a stage is slow. These are only for you: buyers never see notes. {data.aiEnabled ? 'AI drafts the English and suggests a reason; check both against the original, then mark it reviewed.' : 'Add the English meaning of a Tamil note and check the reason.'}</p>
                  <ul className="plain stagelist">
                    {data.notes.map((n) => {
                      const chosen = defaultReason(n, noteReason[n.id])
                      const message = noteMessage[n.id] ?? (n.ai ? null : allMessage)
                      const line = aiLine(n, data.reasons, !!data.aiEnabled, { gaveUp, message })
                      const clash = disagreement(n, data.reasons)
                      return (
                        <li key={n.id} className="stagecard">
                          <div className="stagecard__top"><b className="mono">{n.po}</b><span className="sub">{n.buyerName} · {cap(n.stage)} · {shortDateIn(n.takenOn, today)}</span></div>
                          {n.original ? <p className="orig" lang={n.language === 'ta' ? 'ta' : 'en'}><span className="lang-tag">{n.language === 'ta' ? 'Tamil' : 'English'}</span> {n.original}</p> : <p className="sub">No words, only a reason.</p>}
                          {line && (
                            <div className={`ai-box ai-box--${line.kind}`} role="status" aria-live="polite">
                              <span className="lang-tag">AI</span>{' '}
                              <span>{line.text}</span>
                              {'detail' in line && line.detail && <p className="sub ai-box__why">Why: {line.detail}</p>}
                              {clash && <p className="ai-box__clash">{clash}</p>}
                              {message && n.ai && <p className="sub ai-box__why">{message}</p>}
                              {data.aiEnabled && (n.ai || line.kind === 'failed') && !(noteMessage[n.id] || allMessage) && (
                                <Button size="small" disabled={aiBusy !== null} onClick={() => void askAgain(n)}>{aiBusy === n.id ? 'Asking…' : 'Ask AI again'}</Button>
                              )}
                            </div>
                          )}
                          {n.language === 'ta' && (
                            <Field label={<>What it means, in English{n.ai?.textEn && meaning[n.id] === undefined ? ' (AI draft, check it against the Tamil)' : ''}</>}>
                              <Textarea rows={2} maxLength={500} value={defaultMeaning(n, meaning[n.id])} onChange={(e) => setMeaning({ ...meaning, [n.id]: e.target.value })} /></Field>
                          )}
                          <Field label={<>Reason{reasonSource(n, noteReason[n.id])}</>}>
                            <Select value={chosen} onChange={(e) => setNoteReason({ ...noteReason, [n.id]: e.target.value })}>
                              {offersNoReason(n.category) && <option value="">No reason chosen</option>}
                              {data.reasons.map((r) => <option key={r.id} value={r.id}>{r.en}</option>)}
                              {n.category && !data.reasons.some((r) => r.id === n.category) && <option value={n.category}>{reasonById(data.reasons, n.category)?.en}</option>}
                            </Select></Field>
                          <div className="actions"><Button variant="primary" disabled={busy === n.id} onClick={() => void reviewNote(n, notesHeading)}>Mark as reviewed</Button></div>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </section>

            <section className={sec(data.photos.length)} aria-labelledby={sectionAnchor('photos')}>
              <h2 id={sectionAnchor('photos')} tabIndex={-1} ref={photosHeading}>{sectionTitle('Photos waiting for approval', data.photos.length)}</h2>
              {data.photos.length === 0 ? <p className="sub">{emptyLine('photos')}</p> : (
                <ul className="plain photogrid">
                  {data.photos.map((p) => (
                    <li key={p.id} className="stagecard">
                      <AuthImage zoomable path={`/api/photos/${p.id}/file`} alt={`${cap(p.stage)} photo for ${p.po}`} />
                      <p className="sub"><b className="mono">{p.po}</b> · {p.buyerName} · {cap(p.stage)} · {shortDateIn(p.takenOn, today)}</p>
                      <div className="actions">
                        <Button variant="primary" size="small" disabled={busy === p.id} onClick={() => void decidePhoto(p, 'approve', photosHeading)}>Approve for buyer</Button>
                        <Button size="small" disabled={busy === p.id} onClick={() => void decidePhoto(p, 'reject', photosHeading)}>Reject</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={sec(data.approvedPhotos.length)} aria-labelledby={sectionAnchor('approved')}>
              <h2 id={sectionAnchor('approved')} tabIndex={-1} ref={approvedHeading}>{sectionTitle('Photos visible to buyers now', data.approvedPhotos.length)}</h2>
              {data.approvedPhotos.length === 0 ? <p className="sub">{emptyLine('approved')}</p> : (
                <ul className="plain photogrid">
                  {data.approvedPhotos.map((p) => (
                    <li key={p.id} className="stagecard">
                      <AuthImage zoomable path={`/api/photos/${p.id}/file`} alt={`${cap(p.stage)} photo for ${p.po}`} />
                      <p className="sub"><b className="mono">{p.po}</b> · {p.buyerName} · {cap(p.stage)} · {shortDateIn(p.takenOn, today)}</p>
                      <div className="actions"><Button size="small" disabled={busy === p.id} onClick={() => void decidePhoto(p, 'reject', approvedHeading)}>Withdraw from buyer</Button></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={sec(data.confirmed.length)} aria-labelledby={sectionAnchor('confirmed')}>
              <h2 id={sectionAnchor('confirmed')} tabIndex={-1} ref={confirmedHeading}>{sectionTitle('Warnings visible to buyers now', data.confirmed.length)}</h2>
              {data.confirmed.length === 0 ? <p className="sub">{emptyLine('confirmed')}</p> : (
                <ul className="plain stagelist">
                  {data.confirmed.map((w) => (
                    <li key={w.id} className="stagecard">
                      <div className="stagecard__top"><b className="mono">{w.po}</b><span className="sub">{w.buyerName} · {cap(w.stage)}</span><StatusBadge status={w.status} /></div>
                      <p className="why">{w.buyerText}</p>
                      <div className="actions"><Button size="small" disabled={busy === w.id} onClick={() => void decide(w, 'dismiss', confirmedHeading)}>Hide from buyer</Button></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rvsec" aria-labelledby={sectionAnchor('links')}>
              <h2 id={sectionAnchor('links')} tabIndex={-1} ref={linksHeading}>{sectionTitle('Buyer links', active, 'working')}</h2>
              <Card as="form" className="change" onSubmit={makeLink} noValidate>
                <p className="sub">A link lets one buyer contact see only that buyer's orders, read-only. Share it by email or message. Anyone who has it can open it, so cancel it if it goes to the wrong person.</p>
                <div className="grid2">
                  <Field label="Buyer">
                    <Select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                      <option value="">Choose a buyer</option>{buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select></Field>
                  <Field label="Works for (days)">
                    <Input mono inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
                </div>
                <Field label="Who it is for (optional)">
                  <Input value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></Field>
                {linkError && <ErrorText>{linkError}</ErrorText>}
                <Button variant="primary" disabled={busy === 'link'}>Make link</Button>
              </Card>

              {made && (
                <div className="notice-box" role="status">
                  <b>Copy this link now. For safety it is shown only once.</b>
                  <Input id="link-url" mono readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} aria-label="Buyer link" />
                  <Button size="small" onClick={() => void copy()}>{made.copied ? 'Copied' : 'Copy link'}</Button>
                </div>
              )}

              {exportError && <ErrorText>{exportError}</ErrorText>}
              {links.length === 0 ? <p className="sub">{emptyLine('links')}</p> : (
                <>
                  {/* Working links first; cancelled and expired ones sit behind a button with their number (AUDIT-03 finding 15). */}
                  {working.length === 0 && <p className="sub">No link works right now.</p>}
                  {shownLinks.length > 0 && (
                    <table className="plan links">
                      <thead><tr><th scope="col">Buyer</th><th scope="col">For</th><th scope="col">State</th><th scope="col"><span className="visually-hidden">Action</span></th></tr></thead>
                      <tbody>{shownLinks.map((l) => {
                        const s = linkStatus(l)
                        return (
                          <tr key={l.id}>
                            <td data-label="Buyer">{l.buyerName}</td><td data-label="For">{l.label ?? '-'}</td><td data-label="State">{s.text}</td>
                            <td className="links__actions">
                              <Button size="small" disabled={busy === `export:${l.id}`} onClick={() => void exportBuyer(l)}>Download (Excel)</Button>
                              {s.active && <Button size="small" onClick={() => void revoke(l.id)}>Cancel link</Button>}
                            </td>
                          </tr>
                        )
                      })}</tbody>
                    </table>
                  )}
                  {past.length > 0 && (
                    <p><Button size="small" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide' : 'Show'} cancelled and expired links ({past.length})</Button></p>
                  )}
                </>
              )}
            </section>
          </>
        )}
    </MerchandiserShell>
  )
}
