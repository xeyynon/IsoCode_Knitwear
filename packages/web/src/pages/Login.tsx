import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Navigate } from 'react-router-dom'
import { getClaims, signIn, snapshot, subscribe } from '../api/session'
import { homeFor, signInMessage, type SignInFailure } from '../api/sessionRules'
import { setLang, useLang } from '../i18n'
import { autofocusFirstField, initialLoginMode, readLastRole, rememberRole, type LoginMode } from '../loginRules'

type Mode = LoginMode

// Storage can be missing or throw (a private window): the rules read and write through try/catch.
const browserStore = (): Storage | null => { try { return window.localStorage } catch { return null } }

export default function Login() {
  useSyncExternalStore(subscribe, snapshot)
  const { t, lang } = useLang()
  const claims = getClaims()
  // Opens on the role last signed in on this phone (a Tamil phone with none remembered: the supervisor form), and holds the
  // cursor back on a touch screen until the role is known, so the keyboard does not open over the role switch (loginRules.ts).
  const lastRole = useRef(readLastRole(browserStore()))
  const coarse = useRef(typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches)
  const [mode, setMode] = useState<Mode>(() => initialLoginMode(lastRole.current, lang))
  const [a, setA] = useState('')   // email or phone
  const [b, setB] = useState('')   // password or PIN
  const [busy, setBusy] = useState(false)
  // The kind, so the message follows the language switch; the English text as the server worded it.
  const [error, setError] = useState<{ kind: SignInFailure; message: string } | null>(null)
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
    if (!r.ok) { setError({ kind: r.kind, message: r.message }); setB(''); failed.current = true }
    if (r.ok) rememberRole(browserStore(), mode)   // only a sign-in that worked: a wrong PIN must not change what the next person sees
    setBusy(false)
  }

  return (
    <main className="login">
      <form className="card login__card" onSubmit={submit} noValidate>
        <h1>{t('login.title')}</h1>
        <div className="seg" role="group" aria-label={t('login.who')}>
          {(['merchandiser', 'supervisor'] as const).map((m) => (
            <button key={m} type="button" className="seg__btn" aria-pressed={mode === m}
              onClick={() => { setMode(m); setA(''); setB(''); setError(null); first.current?.focus() }}>
              {t(m === 'merchandiser' ? 'login.merchandiser' : 'login.supervisor')}
            </button>
          ))}
        </div>

        <label className="field">
          <span>{supervisor ? t('login.phone') : 'Email'}</span>
          <input ref={first} className={`input${supervisor ? ' input--tall' : ''}`} autoFocus={!a && autofocusFirstField({ coarsePointer: coarse.current, roleKnown: lastRole.current !== null })} value={a} disabled={busy}
            type={supervisor ? 'tel' : 'email'} inputMode={supervisor ? 'numeric' : 'email'}
            autoComplete={supervisor ? 'tel' : 'username'} onChange={(e) => setA(e.target.value)} />
        </label>
        <label className="field">
          <span>{supervisor ? t('login.pin') : 'Password'}</span>
          <input ref={second} className={`input${supervisor ? ' input--tall' : ''}`} value={b} disabled={busy}
            type="password" inputMode={supervisor ? 'numeric' : 'text'} maxLength={supervisor ? 4 : undefined}
            autoComplete={supervisor ? 'one-time-code' : 'current-password'} onChange={(e) => setB(e.target.value)} />
        </label>

        {error && <p className="error" role="alert">{lang === 'en' ? error.message : signInMessage(error.kind, error.message, lang)}</p>}
        <button className="btn btn--primary btn--block" disabled={busy || !a.trim() || !b}>
          {busy ? t('login.signingIn') : t('login.title')}
        </button>
        {/* Before sign-in there is no menu: a supervisor chooses the language here. Both are shown at once, each in its own script
            (the names are the same in both languages), so nobody has to find a small link first. */}
        <div className="seg seg--lang" role="group" aria-label="தமிழ் / English">
          <button type="button" className="seg__btn" lang="ta" aria-pressed={lang === 'ta'} onClick={() => setLang('ta')}>{t('nav.toTamil')}</button>
          <button type="button" className="seg__btn" lang="en" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>{t('nav.toEnglish')}</button>
        </div>
      </form>
    </main>
  )
}
