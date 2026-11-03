import { useEffect, useState } from 'react'
import { API_BASE } from '../api/session'
import { shortDate } from '../board/boardLogic'
import { readBuyerToken, severityStatus, type Severity } from '../review/reviewLogic'
import { AuthImage } from '../ui/AuthImage'
import { Loading } from '../ui/Loading'
import { StatusBadge } from '../ui/StatusBadge'

interface View {
  buyer: { name: string }
  orders: {
    po: string; style: string; colour: string; qty: number; exFactory: string
    milestones: { stage: string; plannedEnd: string }[]
    photos: { id: string; stage: string; takenOn: string }[]
    warnings: { stage: string; severity: Severity; text: string; since: string }[]
  }[]
}

const KEY = 'buyer.token'
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Read the token from the address once, keep it for this tab only, and take it out of the address bar. */
function takeToken(): string | null {
  const fromHash = readBuyerToken(window.location.hash)
  if (fromHash) {
    try { window.sessionStorage.setItem(KEY, fromHash) } catch { /* private window: it will live in memory below */ }
    window.history.replaceState(null, '', window.location.pathname)   // no token left to copy, share by accident or bookmark
    return fromHash
  }
  try { return window.sessionStorage.getItem(KEY) } catch { return null }
}

/**
 * What a buyer sees: their own orders, read-only. No sign-in: the link is the key. Only what a
 * merchandiser has confirmed is shown, and nothing about progress, rates or other buyers.
 */
export default function Buyer() {
  const [view, setView] = useState<View | null>(null)
  const [problem, setProblem] = useState<'invalid' | 'unreachable' | null>(null)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const token = takeToken()
    if (!token) { setProblem('invalid'); return }
    setToken(token)
    const ctl = new AbortController()
    fetch(`${API_BASE}/api/buyer/orders`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal })
      .then(async (res) => {
        if (res.status === 401) return setProblem('invalid')
        if (!res.ok) return setProblem('unreachable')
        setView((await res.json()) as View)
      })
      .catch((e) => { if ((e as Error).name !== 'AbortError') setProblem('unreachable') })
    return () => ctl.abort()
  }, [])

  return (
    <main className="page page--form buyer">
      <p className="sub">Order status</p>
      {!view && !problem && <Loading label="Loading your orders" />}
      {problem === 'invalid' && (
        <div className="card" role="alert">
          <h1>This link is not valid</h1>
          <p>It may have expired or been cancelled. Please ask your contact for a new link.</p>
        </div>
      )}
      {problem === 'unreachable' && <div className="card" role="alert"><h1>Cannot load right now</h1><p>Please check your connection and try again in a moment.</p></div>}

      {view && (
        <>
          <h1>{view.buyer.name}</h1>
          {view.orders.length === 0 && <div className="card"><p>There are no orders to show yet.</p></div>}
          <ul className="plain stagelist">
            {view.orders.map((o) => (
              <li key={o.po} className="stagecard">
                <div className="stagecard__top"><b className="mono">{o.po}</b><span className="sub">{o.style} · {o.colour}</span></div>
                <p className="mono sub">{o.qty.toLocaleString('en-IN')} pieces · ships {shortDate(o.exFactory)}</p>

                {o.warnings.length > 0 && (
                  <ul className="plain warns" aria-label="Notices from the factory">
                    {o.warnings.map((w) => (
                      <li key={w.stage}>
                        <StatusBadge status={severityStatus(w.severity)} />
                        <span>{w.text}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {o.photos.length > 0 && token && (
                  <ul className="plain photogrid" aria-label="Photos from the factory">
                    {o.photos.map((p) => (
                      <li key={p.id}>
                        <AuthImage path={`/api/buyer/photos/${p.id}`} token={token} alt={`${cap(p.stage)}, ${shortDate(p.takenOn)}`} />
                        <span className="sub">{cap(p.stage)} · {shortDate(p.takenOn)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {o.milestones.length > 0 && (
                  <table className="plan">
                    <caption>Planned finish dates</caption>
                    <thead><tr><th scope="col">Stage</th><th scope="col">Planned finish</th></tr></thead>
                    <tbody>{o.milestones.map((m) => <tr key={m.stage}><td>{cap(m.stage)}</td><td className="mono">{shortDate(m.plannedEnd)}</td></tr>)}</tbody>
                  </table>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
