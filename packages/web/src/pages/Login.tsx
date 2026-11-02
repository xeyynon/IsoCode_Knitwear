import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Navigate } from 'react-router-dom'
import { getClaims, signIn, snapshot, subscribe } from '../api/session'
import { homeFor } from '../api/sessionRules'

type Mode = 'merchandiser' | 'supervisor'

export default function Login() {
  useSyncExternalStore(subscribe, snapshot)
  const claims = getClaims()
  const [mode, setMode] = useState<Mode>('merchandiser')
  const [a, setA] = useState('')   // email or phone
  const [b, setB] = useState('')   // password or PIN
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const second = useRef<HTMLInputElement>(null)
  const failed = useRef(false)

  // After a failed attempt the secret is cleared and re-focused, once the field is enabled again.
  useEffect(() => {
    if (failed.current && !busy) { failed.current = false; second.current?.focus() }
  }, [busy])

  if (claims) return <Navigate to={homeFor(claims.role)} replace />

  const supervisor = mode === 'supervisor'
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const r = await signIn(supervisor ? { phone: a, pin: b } : { email: a, password: b })
    if (!r.ok) { setError(r.message); setB(''); failed.current = true }
    setBusy(false)
  }

  return (
    <main className="login">
      <form className="card login__card" onSubmit={submit} noValidate>
        <h1>Sign in</h1>
        <div className="seg" role="group" aria-label="Who is signing in">
          {(['merchandiser', 'supervisor'] as const).map((m) => (
            <button key={m} type="button" className="seg__btn" aria-pressed={mode === m}
              onClick={() => { setMode(m); setA(''); setB(''); setError(null); first.current?.focus() }}>
              {m === 'merchandiser' ? 'Merchandiser' : 'Supervisor'}
            </button>
          ))}
        </div>

        <label className="field">
          <span>{supervisor ? 'Phone number' : 'Email'}</span>
          <input ref={first} className="input" autoFocus={!a} value={a} disabled={busy}
            type={supervisor ? 'tel' : 'email'} inputMode={supervisor ? 'numeric' : 'email'}
            autoComplete={supervisor ? 'tel' : 'username'} onChange={(e) => setA(e.target.value)} />
        </label>
        <label className="field">
          <span>{supervisor ? '4-digit PIN' : 'Password'}</span>
          <input ref={second} className="input" value={b} disabled={busy}
            type="password" inputMode={supervisor ? 'numeric' : 'text'} maxLength={supervisor ? 4 : undefined}
            autoComplete={supervisor ? 'one-time-code' : 'current-password'} onChange={(e) => setB(e.target.value)} />
        </label>

        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" disabled={busy || !a.trim() || !b}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
