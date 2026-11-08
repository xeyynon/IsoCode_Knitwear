import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { acknowledgeSessionEnded, getClaims, sessionEndedNotice, signIn, snapshot, subscribe } from '../api/session'
import { returnTarget, signInMessage, type SignInFailure } from '../api/sessionRules'
import { setLang, useLang } from '../i18n'
import { autofocusFirstField, initialLoginMode, readLastRole, rememberRole, type LoginMode } from '../loginRules'
import { Banner } from '../ui/atoms/Banner'
import { Button } from '../ui/atoms/Button'
import { AuthShell } from '../ui/templates/AuthShell'
import { Card } from '../ui/atoms/Card'
import { ErrorText } from '../ui/atoms/ErrorText'
import { Input } from '../ui/atoms/Input'
import { Field } from '../ui/molecules/Field'
import { useQueue } from '../queue/instance'

// The demo logins are shown only in a build made for the hosted review demo; a real deployment never shows a password.
// The flag is compared literally so the build can fold it away, and the panel (with the demo logins and buyer-link tokens)
// is imported only inside that branch: a build without the flag has no file that contains them (a test builds one and checks).
const EvaluatorAccess = import.meta.env.VITE_DEMO_ACCESS === '1' ? lazy(() => import('../ui/organisms/EvaluatorAccess')) : null

type Mode = LoginMode

// Storage can be missing or throw (a private window): the rules read and write through try/catch.
const browserStore = (): Storage | null => { try { return window.localStorage } catch { return null } }

export default function Login() {
  useSyncExternalStore(subscribe, snapshot)
  const { t, lang } = useLang()
  const claims = getClaims()
  const from = (useLocation().state as { from?: unknown } | null)?.from
  // Opens on the role last signed in on this phone (a Tamil phone with none remembered: the supervisor form), and holds the
  // cursor back on a touch screen until the role is known, so the keyboard does not open over the role switch (loginRules.ts).
  const lastRole = useRef(readLastRole(browserStore()))
  const coarse = useRef(typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches)
  const [mode, setMode] = useState<Mode>(() => initialLoginMode(lastRole.current, lang))
  const [a, setA] = useState('')   // email or phone
  const [b, setB] = useState('')   // password or PIN
  const [busy, setBusy] = useState(false)
  // Sent here because the session ended (the token ran out or was refused): say so once, then forget it.
  const [sessionEnded] = useState(sessionEndedNotice)
  useEffect(() => { acknowledgeSessionEnded() }, [])
  // The kind, so the message follows the language switch; the English text as the server worded it.
  const [error, setError] = useState<{ kind: SignInFailure; message: string } | null>(null)
  const first = useRef<HTMLInputElement>(null)
  // Updates left on this phone (a sign-out or an expired sign-in): they send after the next sign-in, and the screen says so (FE-S-07).
  const { state: queueState } = useQueue()
  const pending = queueState?.pending ?? 0
  const second = useRef<HTMLInputElement>(null)
  const failed = useRef(false)

  // After a failed attempt the secret is cleared and re-focused, once the field is enabled again.
  useEffect(() => {
    if (failed.current && !busy) { failed.current = false; second.current?.focus() }
  }, [busy])

  if (claims) return <Navigate to={returnTarget(from, claims.role)} replace />

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
    <AuthShell title={t('login.title')}>
      <Card as="form" className="login__card" onSubmit={submit} noValidate>
        <h1>{t('login.title')}</h1>
        {sessionEnded && <Banner role="status">{t('login.sessionEnded')}</Banner>}
        <div className="seg" role="group" aria-label={t('login.who')}>
          {(['merchandiser', 'supervisor'] as const).map((m) => (
            <button key={m} type="button" className="seg__btn" aria-pressed={mode === m}
              onClick={() => { setMode(m); setA(''); setB(''); setError(null); first.current?.focus() }}>
              {t(m === 'merchandiser' ? 'login.merchandiser' : 'login.supervisor')}
            </button>
          ))}
        </div>

        <Field label={supervisor ? t('login.phone') : 'Email'}>
          <Input ref={first} tall={supervisor} autoFocus={!a && autofocusFirstField({ coarsePointer: coarse.current, roleKnown: lastRole.current !== null })} value={a} disabled={busy}
            type={supervisor ? 'tel' : 'email'} inputMode={supervisor ? 'numeric' : 'email'}
            autoComplete={supervisor ? 'tel' : 'username'} onChange={(e) => setA(e.target.value)} />
        </Field>
        <Field label={supervisor ? t('login.pin') : 'Password'}>
          <Input ref={second} tall={supervisor} value={b} disabled={busy}
            type="password" inputMode={supervisor ? 'numeric' : 'text'} maxLength={supervisor ? 4 : undefined}
            autoComplete={supervisor ? 'one-time-code' : 'current-password'} onChange={(e) => setB(e.target.value)} />
        </Field>

        {error && <ErrorText>{lang === 'en' ? error.message : signInMessage(error.kind, error.message, lang)}</ErrorText>}
        {pending > 0 && <p className="sub" role="status">{t('login.waiting', { n: pending })}</p>}
        <Button variant="primary" block disabled={busy || !a.trim() || !b}>
          {busy ? t('login.signingIn') : t('login.title')}
        </Button>
        {/* Before sign-in there is no menu: a supervisor chooses the language here. Both are shown at once, each in its own script
            (the names are the same in both languages), so nobody has to find a small link first. */}
        <div className="seg seg--lang" role="group" aria-label="தமிழ் / English">
          <button type="button" className="seg__btn" lang="ta" aria-pressed={lang === 'ta'} onClick={() => setLang('ta')}>{t('nav.toTamil')}</button>
          <button type="button" className="seg__btn" lang="en" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>{t('nav.toEnglish')}</button>
        </div>
        {EvaluatorAccess && <Suspense fallback={null}><EvaluatorAccess mode={mode} onUse={(id, secret) => { setA(id); setB(secret); setError(null) }} /></Suspense>}
      </Card>
    </AuthShell>
  )
}
