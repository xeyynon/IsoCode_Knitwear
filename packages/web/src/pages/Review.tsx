import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, apiFetch } from '../api/session'
import { buyerLinkUrl, linkStatus, parseDays } from '../review/reviewLogic'
import { AppBar } from '../ui/AppBar'
import { Loading } from '../ui/Loading'
import { reasonById, type Reason } from '../notes/reasons'
import { AuthImage } from '../ui/AuthImage'
import { StatusBadge } from '../ui/StatusBadge'

interface Item { id: string; orderId: string; po: string; buyerName: string; stage: string; status: 'amber' | 'red'; buyerText: string; maths: string; state: string }
interface PendingNote { id: string; po: string; buyerName: string; stage: string; takenOn: string; language: 'ta' | 'en' | null; original: string | null; textEn: string | null; category: string | null; categoryBy: string | null }
interface PendingPhoto { id: string; po: string; buyerName: string; stage: string; takenOn: string; bytes: number }
interface LinkRow { id: string; buyerId: string; buyerName: string; label: string | null; expiresAt: string; revoked: boolean; expired: boolean }
interface Options { buyers: { id: string; name: string }[] }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function Review() {
  const [data, setData] = useState<{ needsReview: Item[]; confirmed: Item[]; photos: PendingPhoto[]; notes: PendingNote[]; reasons: Reason[] } | null>(null)
  const [meaning, setMeaning] = useState<Record<string, string>>({})
  const [noteReason, setNoteReason] = useState<Record<string, string>>({})
  const [links, setLinks] = useState<LinkRow[]>([])
  const [buyers, setBuyers] = useState<Options['buyers']>([])
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [announce, setAnnounce] = useState('')
  const pendingHeading = useRef<HTMLHeadingElement>(null)

  const [buyerId, setBuyerId] = useState('')
  const [days, setDays] = useState('30')
  const [label, setLabel] = useState('')
  const [made, setMade] = useState<{ url: string; copied: boolean } | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([
        apiFetch<{ needsReview: Item[]; confirmed: Item[]; photos: PendingPhoto[]; notes: PendingNote[]; reasons: Reason[] }>('/api/review'),
        apiFetch<{ links: LinkRow[] }>('/api/buyer-links'),
      ])
      setData(r); setLinks(l.links); setError(null)
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load the review queue.') }
  }, [])
  useEffect(() => {
    void load()
    apiFetch<Options>('/api/orders/options').then((o) => setBuyers(o.buyers)).catch(() => undefined)
  }, [load])

  async function decide(item: Item, action: 'confirm' | 'dismiss') {
    setBusy(item.id); setActionError(null)
    try {
      const text = edits[item.id]
      await apiFetch(`/api/warnings/${item.id}/${action}`, { method: 'POST', body: JSON.stringify(action === 'confirm' && text !== undefined ? { text } : {}) })
      setAnnounce(action === 'confirm' ? `Confirmed. ${item.po} ${item.stage} is now visible to ${item.buyerName}.` : `Dismissed. ${item.buyerName} will not see it.`)
      await load()
      pendingHeading.current?.focus()      // the card that had focus is gone: put focus somewhere sensible
    } catch (e) { setActionError(e instanceof ApiError ? e.message : 'That did not work. Please try again.') }
    setBusy(null)
  }

  async function reviewNote(n: PendingNote) {
    setBusy(n.id); setActionError(null)
    try {
      await apiFetch(`/api/notes/${n.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ ...(n.language === 'ta' && meaning[n.id]?.trim() ? { textEn: meaning[n.id] } : {}), ...(noteReason[n.id] ? { category: noteReason[n.id] } : {}) }),
      })
      setAnnounce(`Reviewed the note on ${n.po}.`)
      await load(); pendingHeading.current?.focus()
    } catch (e) { setActionError(e instanceof ApiError ? e.message : 'That did not work. Please try again.') }
    setBusy(null)
  }

  async function decidePhoto(p: PendingPhoto, action: 'approve' | 'reject') {
    setBusy(p.id); setActionError(null)
    try {
      await apiFetch(`/api/photos/${p.id}/${action}`, { method: 'POST', body: '{}' })
      setAnnounce(action === 'approve' ? `Approved. The ${p.stage} photo for ${p.po} is now visible to ${p.buyerName}.` : 'Rejected. It will not be shown.')
      await load(); pendingHeading.current?.focus()
    } catch (e) { setActionError(e instanceof ApiError ? e.message : 'That did not work. Please try again.') }
    setBusy(null)
  }

  async function makeLink(e: React.FormEvent) {
    e.preventDefault()
    setLinkError(null); setMade(null)
    const d = parseDays(days)
    if (!buyerId) return setLinkError('Choose a buyer.')
    if (d === null) return setLinkError('Enter a number of days from 1 to 180.')
    try {
      const r = await apiFetch<{ token: string }>('/api/buyer-links', { method: 'POST', body: JSON.stringify({ buyerId, days: d, label }) })
      setMade({ url: buyerLinkUrl(window.location.origin, r.token), copied: false })
      setLabel(''); await load()
    } catch (err) { setLinkError(err instanceof ApiError ? err.message : 'Could not make the link.') }
  }

  async function copy() {
    if (!made) return
    try { await navigator.clipboard.writeText(made.url); setMade({ ...made, copied: true }) }
    catch { document.getElementById('link-url')?.focus(); (document.getElementById('link-url') as HTMLInputElement | null)?.select() }   // no clipboard access: select it so Ctrl+C works
  }

  async function revoke(id: string) {
    try { await apiFetch(`/api/buyer-links/${id}/revoke`, { method: 'POST', body: '{}' }); await load() }
    catch (e) { setLinkError(e instanceof ApiError ? e.message : 'Could not cancel the link.') }
  }

  return (
    <>
      <AppBar title="Review" />
      <main className="page page--form">
        <Link className="link back" to="/board">← Order board</Link>
        <p className="visually-hidden" role="status" aria-live="polite">{announce}</p>
        {!data && !error && <Loading label="Loading" />}
        {error && <div className="card" role="alert"><p>{error}</p><button className="btn" onClick={() => void load()}>Try again</button></div>}
        {actionError && <p className="banner" role="alert">{actionError}</p>}

        {data && (
          <>
            <h2 tabIndex={-1} ref={pendingHeading}>Waiting for your review ({data.needsReview.length})</h2>
            <p className="sub">Nothing here is visible to a buyer until you confirm it. You can change the wording first. The figures below the wording are for you only.</p>
            {data.needsReview.length === 0 && <div className="card"><p>Nothing is waiting. New warnings appear here when a stage is at risk.</p></div>}
            <ul className="plain stagelist">
              {data.needsReview.map((w) => (
                <li key={w.id} className="stagecard">
                  <div className="stagecard__top"><b className="mono">{w.po}</b><span className="sub">{w.buyerName} · {cap(w.stage)}</span><StatusBadge status={w.status} /></div>
                  <p className="sub internal">Only you see this: {w.maths}</p>
                  <label className="field"><span>What {w.buyerName} would read</span>
                    <textarea className="input textarea" rows={2} maxLength={300} value={edits[w.id] ?? w.buyerText}
                      onChange={(e) => setEdits({ ...edits, [w.id]: e.target.value })} /></label>
                  <div className="actions">
                    <button className="btn btn--primary" disabled={busy === w.id || !(edits[w.id] ?? w.buyerText).trim()} onClick={() => void decide(w, 'confirm')}>Confirm for buyer</button>
                    <button className="btn" disabled={busy === w.id} onClick={() => void decide(w, 'dismiss')}>Don't show</button>
                  </div>
                </li>
              ))}
            </ul>

            <h2>Notes from the floor ({data.notes.length})</h2>
            <p className="sub">What supervisors wrote about why a stage is slow. These are only for you: buyers never see notes. Add the English meaning of a Tamil note and check the reason.</p>
            {data.notes.length === 0 ? <p className="sub">No notes are waiting.</p> : (
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
                          <option value="">No reason chosen</option>
                          {data.reasons.map((r) => <option key={r.id} value={r.id}>{r.en}</option>)}
                          {n.category && !data.reasons.some((r) => r.id === n.category) && <option value={n.category}>{reasonById(data.reasons, n.category)?.en}</option>}
                        </select></label>
                      <div className="actions"><button className="btn btn--primary" disabled={busy === n.id} onClick={() => void reviewNote(n)}>Mark as reviewed</button></div>
                    </li>
                  )
                })}
              </ul>
            )}

            <h2>Photos waiting for approval ({data.photos.length})</h2>
            {data.photos.length === 0 ? <p className="sub">No photos are waiting. A photo a supervisor sends with an update appears here first; a buyer cannot see it until you approve it.</p> : (
              <ul className="plain photogrid">
                {data.photos.map((p) => (
                  <li key={p.id} className="stagecard">
                    <AuthImage path={`/api/photos/${p.id}/file`} alt={`${cap(p.stage)} photo for ${p.po}`} />
                    <p className="sub"><b className="mono">{p.po}</b> · {p.buyerName} · {cap(p.stage)} · {p.takenOn}</p>
                    <div className="actions">
                      <button className="btn btn--primary btn--small" disabled={busy === p.id} onClick={() => void decidePhoto(p, 'approve')}>Approve for buyer</button>
                      <button className="btn btn--small" disabled={busy === p.id} onClick={() => void decidePhoto(p, 'reject')}>Reject</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h2>Visible to buyers now ({data.confirmed.length})</h2>
            {data.confirmed.length === 0 ? <p className="sub">No warning is currently visible to any buyer.</p> : (
              <ul className="plain stagelist">
                {data.confirmed.map((w) => (
                  <li key={w.id} className="stagecard">
                    <div className="stagecard__top"><b className="mono">{w.po}</b><span className="sub">{w.buyerName} · {cap(w.stage)}</span><StatusBadge status={w.status} /></div>
                    <p className="why">{w.buyerText}</p>
                    <div className="actions"><button className="btn btn--small" disabled={busy === w.id} onClick={() => void decide(w, 'dismiss')}>Hide from buyer</button></div>
                  </li>
                ))}
              </ul>
            )}

            <h2>Buyer links</h2>
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
              <button className="btn btn--primary">Make link</button>
            </form>

            {made && (
              <div className="notice-box" role="status">
                <b>Copy this link now. For safety it is shown only once.</b>
                <input id="link-url" className="input mono" readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} aria-label="Buyer link" />
                <button className="btn btn--small" onClick={() => void copy()}>{made.copied ? 'Copied' : 'Copy link'}</button>
              </div>
            )}

            {links.length > 0 && (
              <table className="plan links">
                <thead><tr><th scope="col">Buyer</th><th scope="col">For</th><th scope="col">State</th><th scope="col"><span className="visually-hidden">Action</span></th></tr></thead>
                <tbody>{links.map((l) => {
                  const s = linkStatus(l)
                  return (
                    <tr key={l.id}>
                      <td data-label="Buyer">{l.buyerName}</td><td data-label="For">{l.label ?? '-'}</td><td data-label="State">{s.text}</td>
                      <td>{s.active && <button className="btn btn--small" onClick={() => void revoke(l.id)}>Cancel link</button>}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            )}
          </>
        )}
      </main>
    </>
  )
}
