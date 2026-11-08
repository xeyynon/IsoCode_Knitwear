import { useId, useState } from 'react'
import { EMPTY_PERSON, personProblem, type PersonFields, type PersonRole } from '../../setup/addPerson'
import './AddPersonForm.css'

const ROLES: { id: PersonRole; label: string; sub: string }[] = [
  { id: 'supervisor', label: 'Supervisor', sub: 'Updates pieces on a phone. Signs in with a phone number and a PIN.' },
  { id: 'merchandiser', label: 'Merchandiser', sub: 'Runs the board and Setup. Signs in with an email and a password.' },
]

/**
 * One form for adding a person (UI/UX plan, slice 5.2), with a role choice that decides which fields show. It checks what it can before
 * sending (the server checks again), keeps the name when the role is switched, and is the one filled button on the People screen.
 * `onAdd` sends it and resolves true when it was saved (the fields are then cleared, the unit kept for the next supervisor); a refusal
 * from the server is shown by the caller. A unit is not a person: "Add a unit" stays a separate form.
 */
export function AddPersonForm({ units, onAdd }: { units: { id: string; name: string }[]; onAdd: (role: PersonRole, fields: PersonFields) => Promise<boolean> }) {
  const uid = useId()
  const [role, setRole] = useState<PersonRole>('supervisor')
  const [f, setF] = useState<PersonFields>(EMPTY_PERSON)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<PersonFields>) => setF((cur) => ({ ...cur, ...patch }))
  const label = role === 'supervisor' ? 'supervisor' : 'merchandiser'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const p = personProblem(role, f)
    setProblem(p)
    if (p) return
    setBusy(true)
    try {
      if (await onAdd(role, f)) setF({ ...EMPTY_PERSON, unitId: f.unitId })
    } finally { setBusy(false) }
  }

  return (
    <>
      <h2 id="add-person">Add a person</h2>
      <form className="card addperson" onSubmit={submit} noValidate aria-labelledby="add-person">
        <fieldset className="addperson__roles">
          <legend>Who is this?</legend>
          {ROLES.map((r) => (
            <label key={r.id} className={`addperson__choice${role === r.id ? ' addperson__choice--on' : ''}`}>
              <input type="radio" name={`${uid}-role`} value={r.id} checked={role === r.id} onChange={() => { setRole(r.id); setProblem(null) }} />
              <span className="addperson__dot" aria-hidden="true" />
              <span><b>{r.label}</b><small>{r.sub}</small></span>
            </label>
          ))}
        </fieldset>
        <div className="grid2">
          <label className="field"><span>Name</span><input className="input" value={f.label} maxLength={80} autoComplete="off" onChange={(e) => set({ label: e.target.value })} /></label>
          {role === 'supervisor' ? (
            <>
              <label className="field"><span>Phone number</span><input className="input mono" inputMode="tel" autoComplete="off" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
              <label className="field"><span>4-digit PIN</span><input className="input mono" inputMode="numeric" maxLength={4} autoComplete="off" value={f.pin} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '') })} /></label>
              <label className="field"><span>Unit</span>
                <select className="input" value={f.unitId} onChange={(e) => set({ unitId: e.target.value })}>
                  <option value="">Choose a unit</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select></label>
            </>
          ) : (
            <label className="field"><span>Email</span><input className="input" type="email" autoComplete="off" value={f.email} onChange={(e) => set({ email: e.target.value })} /></label>
          )}
        </div>
        {role === 'merchandiser' && (
          <label className="field"><span>Password (at least 10 characters)</span><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => set({ password: e.target.value })} /></label>
        )}
        {problem && <p className="error" role="alert">{problem}</p>}
        {role === 'supervisor' && <p className="sub">Avoid easy PINs such as 1234 or 1111: they are refused. A PIN is locked for 15 minutes after 5 wrong tries.</p>}
        <button className="btn btn--primary" disabled={busy}>{busy ? 'Adding…' : `Add ${label}`}</button>
      </form>
    </>
  )
}
