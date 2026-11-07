import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { downloadFile } from '../api/download'
import { ApiError, apiFetch } from '../api/session'
import { istDate } from '../dates'
import { exportFileName } from '../review/exportLogic'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import { oneAtATime } from '../queue/oneAtATime'
import { activeLinkCount, afterRevoke, buyerLinkUrl, emptyLine, linkStatus, offersNoReason, parseDays, reviewSummary, sectionAnchor, sectionTitle, type ReviewSectionId } from '../review/reviewLogic'
import { AppBar } from '../ui/AppBar'
import { LoadFailed } from '../ui/LoadFailed'
import { notifyReviewChanged } from '../ui/useReviewCount'
import { Loading } from '../ui/Loading'
import { reasonById, type Reason } from '../notes/reasons'
import { AuthImage } from '../ui/AuthImage'
import { StatusBadge } from '../ui/StatusBadge'

interface Item { id: string; orderId: string; po: string; buyerName: string; stage: string; status: 'amber' | 'red'; buyerText: string; maths: string; state: string }
interface PendingNote { id: string; po: string; buyerName: string; stage: string; takenOn: string; language: 'ta' | 'en' | null; original: string | null; textEn: string | null; category: string | null; categoryBy: string | null }
interface VisiblePhoto { id: string; po: string; buyerName: string; stage: string; takenOn: string }
interface PendingPhoto { id: string; po: string; buyerName: string; stage: string; takenOn: string; bytes: number }
interface LinkRow { id: string; buyerId: string; buyerName: string; label: string | null; expiresAt: string; revoked: boolean; expired: boolean }
interface Options { buyers: { id: string; name: string }[] }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function Review() {
  const [data, setData] = useState<{ needsReview: Item[]; confirmed: Item[]; photos: PendingPhoto[]; approvedPhotos: VisiblePhoto[]; notes: PendingNote[]; reasons: Reason[] } | null>(null)
  const [meaning, setMeaning] = useState<Record<string, string>>({})
  const [noteReason, setNoteReason] = useState<Record<string, string>>({})
  const [links, setLinks] = useState<LinkRow[]>([])
  const [buyers, setBuyers] = useState<Options['buyers']>([])
  const [error, setError] = useState<LoadFailure | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
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
  const making = useRef(false)

  const load = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([
        apiFetch<{ needsReview: Item[]; confirmed: Item[]; photos: PendingPhoto[]; approvedPhotos: VisiblePhoto[]; notes: PendingNote[]; reasons: Reason[] }>('/api/review'),
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

  async function decide(item: Item, action: 'confirm' | 'dismiss', heading: React.RefObject<HTMLHeadingElement | null>) {
    setBusy(item.id); setActionError(null)
    try {
      const text = edits[item.id]
      // Say what was on screen, so a warning a refresh has changed since is not confirmed unseen.
      const body = action === 'confirm' ? { ...(text !== undefined ? { text } : {}), seenStatus: item.status, seenText: item.buyerText } : {}
      await apiFetch(`/api/warnings/${item.id}/${action}`, { method: 'POST', body: JSON.stringify(body) })
      setAnnounce(action === 'confirm' ? `Confirmed. ${item.po} ${item.stage} is now visible to ${item.buyerName}.` : `Dismissed. ${item.buyerName} will not see it.`)
      await load()
      heading.current?.focus()      // the card that had focus is gone: back to the heading of its own section
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'That did not work. Please try again.')
      if (e instanceof ApiError && e.code === 'changed') await load()      // show the new colour and wording
    }
    setBusy(null)
  }

  async function reviewNote(n: PendingNote, heading: React.RefObject<HTMLHeadingElement | null>) {
    setBusy(n.id); setActionError(null)
    try {
      await apiFetch(`/api/notes/${n.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ ...(n.language === 'ta' && meaning[n.id]?.trim() ? { textEn: meaning[n.id] } : {}), ...(noteReason[n.id] ? { category: noteReason[n.id] } : {}) }),
      })
      setAnnounce(`Reviewed the note on ${n.po}.`)
      await load(); heading.current?.focus()
    } catch (e) { setActionError(e instanceof ApiError ? e.message : 'That did not work. Please try again.') }
    setBusy(null)
  }

  async function decidePhoto(p: PendingPhoto | VisiblePhoto, action: 'approve' | 'reject', heading: React.RefObject<HTMLHeadingElement | null>) {
    setBusy(p.id); setActionError(null)
    try {
      await apiFetch(`/api/photos/${p.id}/${action}`, { method: 'POST', body: '{}' })
      setAnnounce(action === 'approve' ? `Approved. The ${p.stage} photo for ${p.po} is now visible to ${p.buyerName}.` : 'Rejected. It will not be shown.')
      await load(); heading.current?.focus()
    } catch (e) { setActionError(e instanceof ApiError ? e.message : 'That did not work. Please try again.') }
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

  const active = activeLinkCount(links)
  // A section with nothing in it keeps its heading and shrinks to one calm line.
  const sec = (count: number) => (count === 0 ? 'rvsec rvsec--empty' : 'rvsec')

  return (
    <>
      <AppBar title="Review" />
      <main className="page page--form">
        <p className="visually-hidden" role="status" aria-live="polite">{announce}</p>
        {!data && !error && <Loading label="Loading" />}
        {error && <LoadFailed unreachable={error.unreachable} message={error.message} onRetry={() => void load()} />}
        {actionError && <p className="banner" role="alert">{actionError}</p>}

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
              {data.needsReview.length === 0 ? <p className="sub">{emptyLine('warnings')}</p> : (
                <>
                  <p className="sub">Nothing here is visible to a buyer until you confirm it. You can change the wording first. The figures below the wording are for you only.</p>
                  <ul className="plain stagelist">
                    {data.needsReview.map((w) => (
                      <li key={w.id} className="stagecard">
                        <div className="stagecard__top"><b className="mono">{w.po}</b><span className="sub">{w.buyerName} · {cap(w.stage)}</span><StatusBadge status={w.status} /></div>
                        <p className="sub internal">Only you see this: {w.maths}</p>
                        <label className="field"><span>What {w.buyerName} would read</span>
                          <textarea className="input textarea" rows={2} maxLength={300} value={edits[w.id] ?? w.buyerText}
                            onChange={(e) => setEdits({ ...edits, [w.id]: e.target.value })} /></label>
                        <div className="actions">
                          <button className="btn btn--primary" disabled={busy === w.id || !(edits[w.id] ?? w.buyerText).trim()} onClick={() => void decide(w, 'confirm', pendingHeading)}>Confirm for buyer</button>
                          <button className="btn" disabled={busy === w.id} onClick={() => void decide(w, 'dismiss', pendingHeading)}>Don't show</button>
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
                  <p className="sub">What supervisors wrote about why a stage is slow. These are only for you: buyers never see notes. Add the English meaning of a Tamil note and check the reason.</p>
                  <ul className="plain stagelist">
                    {data.notes.map((n) => {
                      const chosen = noteReason[n.id] ?? n.category ?? ''
                      return (
                        <li key={n.id} className="stagecard">
                          <div className="stagecard__top"><b className="mono">{n.po}</b><span className="sub">{n.buyerName} · {cap(n.stage)} · {n.takenOn}</span></div>
                          {n.original ? <p className="orig" lang={n.language === 'ta' ? 'ta' : 'en'}><span className="lang-tag">{n.language === 'ta' ? 'Tamil' : 'English'}</span> {n.original}</p> : <p className="sub">No words, only a reason.</p>}
                          {n.language === 'ta' && (
                            <label className="field"><span>What it means, in English</span>
                              <textarea className="input textarea" rows={2} maxLength={500} value={meaning[n.id] ?? ''} onChange={(e) => setMeaning({ ...meaning, [n.id]: e.target.value })} /></label>
                          )}
                          <label className="field"><span>Reason{n.category && !noteReason[n.id] ? ' (chosen by the supervisor)' : ''}</span>
                            <select className="input" value={chosen} onChange={(e) => setNoteReason({ ...noteReason, [n.id]: e.target.value })}>
                              {offersNoReason(n.category) && <option value="">No reason chosen</option>}
                              {data.reasons.map((r) => <option key={r.id} value={r.id}>{r.en}</option>)}
                              {n.category && !data.reasons.some((r) => r.id === n.category) && <option value={n.category}>{reasonById(data.reasons, n.category)?.en}</option>}
                            </select></label>
                          <div className="actions"><button className="btn btn--primary" disabled={busy === n.id} onClick={() => void reviewNote(n, notesHeading)}>Mark as reviewed</button></div>
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
                      <p className="sub"><b className="mono">{p.po}</b> · {p.buyerName} · {cap(p.stage)} · {p.takenOn}</p>
                      <div className="actions">
                        <button className="btn btn--primary btn--small" disabled={busy === p.id} onClick={() => void decidePhoto(p, 'approve', photosHeading)}>Approve for buyer</button>
                        <button className="btn btn--small" disabled={busy === p.id} onClick={() => void decidePhoto(p, 'reject', photosHeading)}>Reject</button>
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
                      <p className="sub"><b className="mono">{p.po}</b> · {p.buyerName} · {cap(p.stage)} · {p.takenOn}</p>
                      <div className="actions"><button className="btn btn--small" disabled={busy === p.id} onClick={() => void decidePhoto(p, 'reject', approvedHeading)}>Withdraw from buyer</button></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={sec(data.confirmed.length)} aria-labelledby={sectionAnchor('confirmed')}>
              <h2 id={sectionAnchor('confirmed')} tabIndex={-1} ref={confirmedHeading}>{sectionTitle('Visible to buyers now', data.confirmed.length)}</h2>
              {data.confirmed.length === 0 ? <p className="sub">{emptyLine('confirmed')}</p> : (
                <ul className="plain stagelist">
                  {data.confirmed.map((w) => (
                    <li key={w.id} className="stagecard">
                      <div className="stagecard__top"><b className="mono">{w.po}</b><span className="sub">{w.buyerName} · {cap(w.stage)}</span><StatusBadge status={w.status} /></div>
                      <p className="why">{w.buyerText}</p>
                      <div className="actions"><button className="btn btn--small" disabled={busy === w.id} onClick={() => void decide(w, 'dismiss', confirmedHeading)}>Hide from buyer</button></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rvsec" aria-labelledby={sectionAnchor('links')}>
              <h2 id={sectionAnchor('links')} tabIndex={-1} ref={linksHeading}>{sectionTitle('Buyer links', active, 'working')}</h2>
              <form className="card change" onSubmit={makeLink} noValidate>
                <p className="sub">A link lets one buyer contact see only that buyer's orders, read-only. Share it by email or message. Anyone who has it can open it, so cancel it if it goes to the wrong person.</p>
                <div className="grid2">
                  <label className="field"><span>Buyer</span>
                    <select className="input" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                      <option value="">Choose a buyer</option>{buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select></label>
                  <label className="field"><span>Works for (days)</span>
                    <input className="input mono" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
                </div>
                <label className="field"><span>Who it is for (optional)</span>
                  <input className="input" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></label>
                {linkError && <p className="error" role="alert">{linkError}</p>}
                <button className="btn btn--primary" disabled={busy === 'link'}>Make link</button>
              </form>

              {made && (
                <div className="notice-box" role="status">
                  <b>Copy this link now. For safety it is shown only once.</b>
                  <input id="link-url" className="input mono" readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} aria-label="Buyer link" />
                  <button className="btn btn--small" onClick={() => void copy()}>{made.copied ? 'Copied' : 'Copy link'}</button>
                </div>
              )}

              {exportError && <p className="error" role="alert">{exportError}</p>}
              {links.length === 0 ? <p className="sub">{emptyLine('links')}</p> : (
                <table className="plan links">
                  <thead><tr><th scope="col">Buyer</th><th scope="col">For</th><th scope="col">State</th><th scope="col"><span className="visually-hidden">Action</span></th></tr></thead>
                  <tbody>{links.map((l) => {
                    const s = linkStatus(l)
                    return (
                      <tr key={l.id}>
                        <td data-label="Buyer">{l.buyerName}</td><td data-label="For">{l.label ?? '-'}</td><td data-label="State">{s.text}</td>
                        <td className="links__actions">
                          <button className="btn btn--small" disabled={busy === `export:${l.id}`} onClick={() => void exportBuyer(l)}>Download (Excel)</button>
                          {s.active && <button className="btn btn--small" onClick={() => void revoke(l.id)}>Cancel link</button>}
                        </td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              )}
            </section>
          </>
        )}
      </main>
    </>
  )
}
