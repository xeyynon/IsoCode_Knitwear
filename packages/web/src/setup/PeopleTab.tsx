import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiFetch } from '../api/session'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import { useLang } from '../i18n'
import { useConfirm } from '../ui/ConfirmDialog'
import { Banner } from '../ui/atoms/Banner'
import { Button } from '../ui/atoms/Button'
import { Card } from '../ui/atoms/Card'
import { ErrorText } from '../ui/atoms/ErrorText'
import { Input, Select } from '../ui/atoms/Input'
import { Field } from '../ui/molecules/Field'
import { LoadFailed } from '../ui/LoadFailed'
import { AccountActivity } from '../ui/organisms/AccountActivity'
import { AddPersonForm } from '../ui/organisms/AddPersonForm'
import type { AuditEntry } from './activityLogic'
import { personNotice, personRequest, type PersonFields, type PersonRole } from './addPerson'
import { accountState, weakPin } from './setupLogic'
import { notifySetupChanged } from './useSetupChecklist'

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

  const [unit, setUnit] = useState({ name: '', type: 'own' as 'own' | 'subcontractor' })
  const [audit, setAudit] = useState<AuditEntry[] | null>(null)
  const [auditFail, setAuditFail] = useState<LoadFailure | null>(null)

  const load = useCallback(async () => {
    try {
      const [a, u] = await Promise.all([apiFetch<{ accounts: Account[] }>('/api/accounts'), apiFetch<{ units: Unit[] }>('/api/units')])
      setAccounts(a.accounts); setUnits(u.units); setError(null); setLoadFail(null)
    } catch (e) { setLoadFail(describeFailure(e, 'Could not load the people list.')) }
    // The activity list is its own section: if it cannot load, the people above still show.
    try { setAudit((await apiFetch<{ entries: AuditEntry[] }>('/api/accounts/audit')).entries); setAuditFail(null) } catch (e) { setAuditFail(describeFailure(e, 'Could not load the activity.')) }
  }, [])
  useEffect(() => { void load() }, [load])

  // A failure shows in the banner unless the caller has a place beside its own field.
  async function act(label: string, fn: () => Promise<unknown>, showError: (m: string) => void = setError) {
    setNotice(null); setError(null)
    try { await fn(); setNotice(label); notifySetupChanged(); await load() } catch (e) { showError(msg(e)) }
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

  /** Sends the person the form describes. True when it was saved; a refusal from the server shows in the banner above. */
  async function addPerson(role: PersonRole, f: PersonFields): Promise<boolean> {
    let saved = false
    await act(personNotice(role, f), async () => {
      const r = personRequest(role, f)
      await apiFetch(r.path, { method: 'POST', body: JSON.stringify(r.body) })
      saved = true
    })
    return saved
  }
  async function addUnit(e: React.FormEvent) {
    e.preventDefault()
    await act(`Added the unit ${unit.name.trim()}.`, async () => { await apiFetch('/api/units', { method: 'POST', body: JSON.stringify(unit) }); setUnit({ name: '', type: 'own' }) })
  }

  return (
    <>
      {dialog}
      {error && <Banner>{error}</Banner>}
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
                  {a.role === 'supervisor' && <Button id={`reset-${a.id}`} size="small" onClick={() => { setPinFor(pinFor === a.id ? null : a.id); setNewPin(''); setPinError(null) }}>Reset PIN</Button>}
                  <Button size="small" onClick={() => void signOutEverywhere(a)}>Sign out everywhere</Button>
                  {!self && <Button size="small" onClick={() => void toggleDisabled(a)}>{a.disabled ? 'Allow again' : 'Stop account'}</Button>}
                  {pinFor === a.id && (
                    <form className="inline" onSubmit={(e) => { e.preventDefault(); setPinError(null); const w = weakPin(newPin); if (w) return setPinError(w); void act('PIN changed. They are signed out everywhere and any lock is cleared.', async () => { await apiFetch(`/api/accounts/${a.id}/pin`, { method: 'POST', body: JSON.stringify({ pin: newPin }) }); setPinFor(null); setNewPin(''); document.getElementById(`reset-${a.id}`)?.focus() }, setPinError) }}>
                      <label className="visually-hidden" htmlFor={`pin-${a.id}`}>New 4-digit PIN</label>
                      <Input id={`pin-${a.id}`} mono inputMode="numeric" maxLength={4} placeholder="New PIN" value={newPin} aria-invalid={pinError ? true : undefined} aria-describedby={pinError ? `pin-err-${a.id}` : undefined} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
                      <Button size="small">Save PIN</Button>
                      {pinError && <ErrorText id={`pin-err-${a.id}`}>{pinError}</ErrorText>}
                    </form>
                  )}
                </div></td>
              </tr>
            )
          })}</tbody>
        </table>
      )}

      <AddPersonForm units={units} onAdd={addPerson} />

      <h2 id="add-unit" tabIndex={-1}>Add a unit</h2>
      <Card as="form" className="change" onSubmit={addUnit} noValidate>
        <p className="sub">Units are the places work happens: your own floors, and subcontractors for printing or washing. Units: {units.map((u) => u.name).join(', ') || 'none yet'}.</p>
        <div className="grid2">
          <Field label="Name"><Input value={unit.name} maxLength={80} onChange={(e) => setUnit({ ...unit, name: e.target.value })} /></Field>
          <Field label="Kind">
            <Select value={unit.type} onChange={(e) => setUnit({ ...unit, type: e.target.value as 'own' | 'subcontractor' })}>
              <option value="own">Our own unit</option><option value="subcontractor">A subcontractor</option>
            </Select></Field>
        </div>
        <Button>Add unit</Button>
      </Card>

      <h2>Activity</h2>
      <p className="sub">Who added, stopped, allowed or reset an account, and when. The latest 100 changes, newest first. A PIN or password is never shown here.</p>
      <AccountActivity entries={audit} failed={auditFail !== null} unreachable={auditFail?.unreachable} onRetry={() => void load()} />
    </>
  )
}
