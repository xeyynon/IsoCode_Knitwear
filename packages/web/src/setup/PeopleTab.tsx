import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiFetch } from '../api/session'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import { useLang } from '../i18n'
import { useConfirm } from '../ui/ConfirmDialog'
import { LoadFailed } from '../ui/LoadFailed'
import { accountState, tenDigits, weakPin } from './setupLogic'

interface Account { id: string; role: 'merchandiser' | 'supervisor'; label: string | null; email: string | null; phoneEnd: string | null; unitName: string | null; disabled: boolean; locked: boolean }
interface Unit { id: string; name: string; type: 'own' | 'subcontractor' }

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'That did not work. Please try again.')

export function PeopleTab({ meId }: { meId: string | undefined }) {
  const { t } = useLang()
  const { confirm, dialog } = useConfirm()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadFail, setLoadFail] = useState<LoadFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pinFor, setPinFor] = useState<string | null>(null)
  const [newPin, setNewPin] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)

  const [sup, setSup] = useState({ label: '', phone: '', pin: '', unitId: '' })
  const [mer, setMer] = useState({ label: '', email: '', password: '' })
  const [unit, setUnit] = useState({ name: '', type: 'own' as 'own' | 'subcontractor' })
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [a, u] = await Promise.all([apiFetch<{ accounts: Account[] }>('/api/accounts'), apiFetch<{ units: Unit[] }>('/api/units')])
      setAccounts(a.accounts); setUnits(u.units); setError(null); setLoadFail(null)
    } catch (e) { setLoadFail(describeFailure(e, 'Could not load the people list.')) }
  }, [])
  useEffect(() => { void load() }, [load])

  // A failure shows in the banner unless the caller has a place beside its own field.
  async function act(label: string, fn: () => Promise<unknown>, showError: (m: string) => void = setError) {
    setNotice(null); setError(null)
    try { await fn(); setNotice(label); await load() } catch (e) { showError(msg(e)) }
  }

  async function signOutEverywhere(a: Account) {
    const ok = await confirm({ title: t('confirm.signOutTitle', { name: a.label ?? 'this person' }), body: t('confirm.signOutBody'), confirmLabel: t('confirm.signOutYes'), cancelLabel: t('confirm.cancel'), destructive: true })
    if (ok) await act('Signed out on every phone. They can sign in again.', () => apiFetch(`/api/accounts/${a.id}/sign-out`, { method: 'POST', body: '{}' }))
  }
  async function toggleDisabled(a: Account) {
    // Allowing someone again needs no question; stopping them does.
    if (!a.disabled && !(await confirm({ title: t('confirm.stopTitle', { name: a.label ?? 'this account' }), body: t('confirm.stopBody'), confirmLabel: t('confirm.stopYes'), cancelLabel: t('confirm.cancel'), destructive: true }))) return
    await act(a.disabled ? 'Allowed again.' : 'Stopped. They are signed out.', () => apiFetch(`/api/accounts/${a.id}/disabled`, { method: 'POST', body: JSON.stringify({ disabled: !a.disabled }) }))
  }

  async function addSupervisor(e: React.FormEvent) {
    e.preventDefault(); setFormError(null)
    if (!sup.label.trim()) return setFormError('Enter the supervisor\'s name.')
    if (!tenDigits(sup.phone)) return setFormError('Enter a 10-digit phone number.')
    const weak = weakPin(sup.pin); if (weak) return setFormError(weak)
    if (!sup.unitId) return setFormError('Choose the unit this supervisor works in.')
    await act(`Added ${sup.label.trim()}. Give them the phone number and PIN; they can sign in straight away.`, async () => {
      await apiFetch('/api/accounts/supervisors', { method: 'POST', body: JSON.stringify(sup) })
      setSup({ label: '', phone: '', pin: '', unitId: sup.unitId })
    })
  }
  async function addMerchandiser(e: React.FormEvent) {
    e.preventDefault(); setFormError(null)
    await act(`Added ${mer.label.trim() || 'the merchandiser'}.`, async () => {
      await apiFetch('/api/accounts/merchandisers', { method: 'POST', body: JSON.stringify(mer) })
      setMer({ label: '', email: '', password: '' })
    }).catch(() => undefined)
  }
  async function addUnit(e: React.FormEvent) {
    e.preventDefault()
    await act(`Added the unit ${unit.name.trim()}.`, async () => { await apiFetch('/api/units', { method: 'POST', body: JSON.stringify(unit) }); setUnit({ name: '', type: 'own' }) })
  }

  return (
    <>
      {dialog}
      {error && <p className="banner" role="alert">{error}</p>}
      {notice && <p className="notice-box" role="status">{notice}</p>}
      {loadFail && <LoadFailed unreachable={loadFail.unreachable} message={loadFail.message} onRetry={() => void load()} />}

      <h2>People who can sign in</h2>
      {!accounts && !error && !loadFail && <p className="sub">Loading…</p>}
      {accounts && (
        <table className="plan people">
          <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Sign-in</th><th scope="col">Unit</th><th scope="col">State</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>{accounts.map((a) => {
            const st = accountState(a)
            const self = a.id === meId
            return (
              <tr key={a.id}>
                <td data-label="Name">{a.label || '(no name)'}{self ? ' (you)' : ''}</td>
                <td data-label="Role" className="people__nowrap">{a.role === 'supervisor' ? 'Supervisor' : 'Merchandiser'}</td>
                <td data-label="Sign-in" className="mono">{a.email ?? `phone ending ${a.phoneEnd}`}</td>
                <td data-label="Unit" className="people__nowrap">{a.unitName ?? '-'}</td>
                <td data-label="State" className="people__nowrap">{st.text}</td>
                <td><div className="people__actions">
                  {a.role === 'supervisor' && <button id={`reset-${a.id}`} className="btn btn--small" onClick={() => { setPinFor(pinFor === a.id ? null : a.id); setNewPin(''); setPinError(null) }}>Reset PIN</button>}
                  <button className="btn btn--small" onClick={() => void signOutEverywhere(a)}>Sign out everywhere</button>
                  {!self && <button className="btn btn--small" onClick={() => void toggleDisabled(a)}>{a.disabled ? 'Allow again' : 'Stop account'}</button>}
                  {pinFor === a.id && (
                    <form className="inline" onSubmit={(e) => { e.preventDefault(); setPinError(null); const w = weakPin(newPin); if (w) return setPinError(w); void act('PIN changed. They are signed out everywhere and any lock is cleared.', async () => { await apiFetch(`/api/accounts/${a.id}/pin`, { method: 'POST', body: JSON.stringify({ pin: newPin }) }); setPinFor(null); setNewPin(''); document.getElementById(`reset-${a.id}`)?.focus() }, setPinError) }}>
                      <label className="visually-hidden" htmlFor={`pin-${a.id}`}>New 4-digit PIN</label>
                      <input id={`pin-${a.id}`} className="input mono" inputMode="numeric" maxLength={4} placeholder="New PIN" value={newPin} aria-invalid={pinError ? true : undefined} aria-describedby={pinError ? `pin-err-${a.id}` : undefined} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
                      <button className="btn btn--primary btn--small">Save PIN</button>
                      {pinError && <p className="error" id={`pin-err-${a.id}`} role="alert">{pinError}</p>}
                    </form>
                  )}
                </div></td>
              </tr>
            )
          })}</tbody>
        </table>
      )}

      <h2>Add a supervisor</h2>
      <form className="card change" onSubmit={addSupervisor} noValidate>
        <div className="grid2">
          <label className="field"><span>Name</span><input className="input" value={sup.label} maxLength={80} onChange={(e) => setSup({ ...sup, label: e.target.value })} /></label>
          <label className="field"><span>Phone number</span><input className="input mono" inputMode="tel" value={sup.phone} onChange={(e) => setSup({ ...sup, phone: e.target.value })} /></label>
          <label className="field"><span>4-digit PIN</span><input className="input mono" inputMode="numeric" maxLength={4} value={sup.pin} onChange={(e) => setSup({ ...sup, pin: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="field"><span>Unit</span>
            <select className="input" value={sup.unitId} onChange={(e) => setSup({ ...sup, unitId: e.target.value })}>
              <option value="">Choose a unit</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></label>
        </div>
        {formError && <p className="error" role="alert">{formError}</p>}
        <p className="sub">Avoid easy PINs such as 1234 or 1111: they are refused. A PIN is locked for 15 minutes after 5 wrong tries.</p>
        <button className="btn btn--primary">Add supervisor</button>
      </form>

      <h2>Add a merchandiser</h2>
      <form className="card change" onSubmit={addMerchandiser} noValidate>
        <div className="grid2">
          <label className="field"><span>Name</span><input className="input" value={mer.label} maxLength={80} onChange={(e) => setMer({ ...mer, label: e.target.value })} /></label>
          <label className="field"><span>Email</span><input className="input" type="email" value={mer.email} onChange={(e) => setMer({ ...mer, email: e.target.value })} /></label>
        </div>
        <label className="field"><span>Password (at least 10 characters)</span><input className="input" type="password" autoComplete="new-password" value={mer.password} onChange={(e) => setMer({ ...mer, password: e.target.value })} /></label>
        <button className="btn btn--primary">Add merchandiser</button>
      </form>

      <h2>Add a unit</h2>
      <form className="card change" onSubmit={addUnit} noValidate>
        <p className="sub">Units are the places work happens: your own floors, and subcontractors for printing or washing. Units: {units.map((u) => u.name).join(', ') || 'none yet'}.</p>
        <div className="grid2">
          <label className="field"><span>Name</span><input className="input" value={unit.name} maxLength={80} onChange={(e) => setUnit({ ...unit, name: e.target.value })} /></label>
          <label className="field"><span>Kind</span>
            <select className="input" value={unit.type} onChange={(e) => setUnit({ ...unit, type: e.target.value as 'own' | 'subcontractor' })}>
              <option value="own">Our own unit</option><option value="subcontractor">A subcontractor</option>
            </select></label>
        </div>
        <button className="btn btn--primary">Add unit</button>
      </form>
    </>
  )
}
