import { useEffect, useState } from 'react'
import { downloadFile } from '../api/download'
import { API_BASE } from '../api/session'
import { shortDate } from '../board/boardLogic'
import { istDate } from '../dates'
import { pieces } from '../numberFormat'
import { exportFileName } from '../review/exportLogic'
import { readBuyerToken, severityWord, type Severity } from '../review/reviewLogic'
import { AuthImage } from '../ui/AuthImage'
import { Button } from '../ui/atoms/Button'
import { PublicShell } from '../ui/templates/PublicShell'
import { Card } from '../ui/atoms/Card'
import { ErrorText } from '../ui/atoms/ErrorText'
import { LoadFailed } from '../ui/LoadFailed'
import { Loading } from '../ui/Loading'

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

/** The buyer's word for a notice, in neutral ink: never the board's red or amber, its marks or its words. */
export function BuyerNotice({ severity }: { severity: Severity }) {
  return <span className="badge badge--neutral badge--stamp">{severityWord(severity)}</span>
}

/** Orders are unique by PO, style and colour, so the same PO can appear twice: the key needs all three. */
export const orderKey = (o: { po: string; style: string; colour: string }) => `${o.po}|${o.style}|${o.colour}`

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
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  async function saveExcel() {
    if (!token || !view || saving) return
    setSaving(true); setSaveError('')
    try { await downloadFile('/api/buyer/export.csv', exportFileName(view.buyer.name, istDate()), token) }
    catch (e) { setSaveError((e as Error).message) }
    finally { setSaving(false) }
  }

  useEffect(() => {
    const found = takeToken()
    if (found) setToken(found)
    else setProblem('invalid')
  }, [])

  useEffect(() => {
    if (!token) return
    setProblem(null)
    const ctl = new AbortController()
    fetch(`${API_BASE}/api/buyer/orders`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal })
      .then(async (res) => {
        if (res.status === 401) return setProblem('invalid')
        if (!res.ok) return setProblem('unreachable')
        setView((await res.json()) as View)
      })
      .catch((e) => { if ((e as Error).name !== 'AbortError') setProblem('unreachable') })
    return () => ctl.abort()
  }, [token, attempt])

  // The page's one h1, whatever state it is in; the order cards below use h2.
  const heading = <h1>{view ? view.buyer.name : problem === 'invalid' ? 'This link is not valid' : problem === 'unreachable' ? 'Cannot load right now' : 'Order status'}</h1>

  return (
    <PublicShell className="buyer">
      {view && <p className="sub">Order status</p>}
      {!problem && heading}
      {!view && !problem && <Loading label="Loading your orders" />}
      {problem === 'invalid' && (
        <Card as="div" role="alert">
          {heading}
          <p>It may have expired or been cancelled. Please ask your contact for a new link.</p>
        </Card>
      )}
      {problem === 'unreachable' && <>{heading}<LoadFailed unreachable message="" statusLink={false} onRetry={() => setAttempt((n) => n + 1)} /></>}

      {view && (
        <>
          {view.orders.length === 0 && <Card as="div"><p>There are no orders to show yet.</p></Card>}
          {view.orders.length > 0 && (
            <div className="actions buyer__save">
              <Button disabled={saving} onClick={() => void saveExcel()}>{saving ? 'Preparing the file…' : 'Download (Excel)'}</Button>
              <span className="sub">Your orders and planned dates as a spreadsheet.</span>
              {saveError && <ErrorText>{saveError}</ErrorText>}
            </div>
          )}
          <ul className="plain stagelist">
            {view.orders.map((o) => (
              <li key={orderKey(o)} className="stagecard">
                <div className="stagecard__top"><h2 className="mono">{o.po}</h2><span className="sub">{o.style} · {o.colour}</span></div>
                <p className="mono sub">{pieces(o.qty)} pieces · ships {shortDate(o.exFactory)}</p>

                {o.warnings.length > 0 && (
                  <ul className="plain warns" aria-label="Notices from the factory">
                    {o.warnings.map((w) => (
                      <li key={w.stage}>
                        <BuyerNotice severity={w.severity} />
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
    </PublicShell>
  )
}
