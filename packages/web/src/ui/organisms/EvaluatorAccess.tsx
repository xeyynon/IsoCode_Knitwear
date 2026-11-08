import { useState } from 'react'
import type { LoginMode } from '../../loginRules'
import { DEMO_ACCESS, DEMO_BUYER_LINKS, masked, type DemoLogin } from '../../demo/demoAccess'
import './EvaluatorAccess.css'

/**
 * Evaluator access (hosted review demo only): the demo login for the role chosen above, each part with Copy, the secret hidden until
 * asked, and "Use these" to fill both fields at once. Then the read-only buyer pages. English only: it is for the reviewer, not the floor.
 */
export function EvaluatorAccess({ mode, onUse }: { mode: LoginMode; onUse: (id: string, secret: string) => void }) {
  const [pick, setPick] = useState(0)
  const [shown, setShown] = useState(false)
  const [said, setSaid] = useState('')
  const list = DEMO_ACCESS[mode]
  const login: DemoLogin = list[Math.min(pick, list.length - 1)]!

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setSaid(`${what} copied.`) } catch { setSaid(`Could not copy. Select the ${what.toLowerCase()} and copy it by hand.`) }
  }

  return (
    <section className="evaluator" aria-labelledby="evaluator-title" lang="en">
      <h2 id="evaluator-title" className="evaluator__title">Evaluator access</h2>
      <p className="evaluator__sub">For evaluation only. Demo accounts with invented data.</p>
      {list.length > 1 && (
        <div className="evaluator__who" role="group" aria-label="Which supervisor">
          {list.map((l, i) => (
            <button key={l.id} type="button" className="evaluator__chip" aria-pressed={i === pick} onClick={() => { setPick(i); setShown(false) }}>Unit {i + 1}</button>
          ))}
        </div>
      )}
      <p className="evaluator__note">{login.who}</p>
      <div className="evaluator__box">
        <div className="evaluator__row">
          <span className="evaluator__label">{login.idLabel}</span>
          <code className="evaluator__value">{login.id}</code>
          <button type="button" className="evaluator__icon" aria-label={`Copy the ${login.idLabel.toLowerCase()}`} onClick={() => void copy(login.id, login.idLabel)}><CopyIcon /></button>
        </div>
        <button type="button" className="evaluator__use" onClick={() => { onUse(login.id, login.secret); setSaid('Filled in. Press Sign in.') }}>Use these</button>
        <div className="evaluator__row">
          <span className="evaluator__label">{login.secretLabel}</span>
          <code className="evaluator__value">{shown ? login.secret : <span aria-label={`${login.secretLabel} hidden`}>{masked(login.secret)}</span>}</code>
          <button type="button" className="evaluator__icon" aria-pressed={shown} aria-label={`Show the ${login.secretLabel.toLowerCase()}`} onClick={() => setShown(!shown)}><EyeIcon off={shown} /></button>
          <button type="button" className="evaluator__icon" aria-label={`Copy the ${login.secretLabel.toLowerCase()}`} onClick={() => void copy(login.secret, login.secretLabel)}><CopyIcon /></button>
        </div>
      </div>
      <p className="evaluator__buyers">Buyer view, read-only:{' '}
        {DEMO_BUYER_LINKS.map((b, i) => (
          <span key={b.token}><a href={`/buyer#${b.token}`}>{b.name}</a></span>
        ))}
      </p>
      <p className="evaluator__said" role="status" aria-live="polite">{said}</p>
    </section>
  )
}

export default EvaluatorAccess

const icon = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
function CopyIcon() { return <svg {...icon}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg> }
function EyeIcon({ off }: { off: boolean }) {
  return <svg {...icon}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{off && <path d="M4 4l16 16" />}</svg>
}
