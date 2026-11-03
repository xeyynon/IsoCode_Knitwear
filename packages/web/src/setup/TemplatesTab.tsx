import { useCallback, useEffect, useState } from 'react'
import { ApiError, apiFetch } from '../api/session'
import { moveRow, templateProblem, type StageRow } from './setupLogic'

interface Unit { id: string; name: string }
interface Template { id: string; name: string; stages: { stage: string; workingDaysBefore: number; unitId: string; unitName: string }[] }

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'That did not work. Please try again.')
let next = 1000
const blank = (unitId: string): StageRow => ({ id: ++next, stage: '', days: '', unitId })

export function TemplatesTab() {
  const [units, setUnits] = useState<Unit[]>([])
  const [list, setList] = useState<Template[] | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<StageRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [u, t] = await Promise.all([apiFetch<{ units: Unit[] }>('/api/units'), apiFetch<{ templates: Template[] }>('/api/templates')])
      setUnits(u.units); setList(t.templates); setError(null)
    } catch (e) { setError(msg(e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  const firstUnit = units[0]?.id ?? ''
  function open(t: Template | null) {
    setNotice(null); setError(null)
    if (t) { setEditing(t.id); setName(t.name); setRows(t.stages.map((s) => ({ id: ++next, stage: s.stage, days: String(s.workingDaysBefore), unitId: s.unitId }))) }
    else { setEditing('new'); setName(''); setRows([blank(firstUnit)]) }
  }
  const problem = editing ? templateProblem(name, rows) : null
  const upd = (id: number, patch: Partial<StageRow>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (problem) return setError(problem)
    setBusy(true); setError(null)
    try {
      await apiFetch('/api/templates', { method: 'POST', body: JSON.stringify({ ...(editing !== 'new' ? { id: editing } : {}), name, stages: rows.map((r) => ({ stage: r.stage, workingDaysBefore: Number(r.days), unitId: r.unitId })) }) })
      setNotice(`Saved "${name.trim()}". Orders made from now on use it; orders already made keep the dates they were given.`)
      setEditing(null); await load()
    } catch (err) { setError(msg(err)) }
    setBusy(false)
  }
  async function remove(t: Template) {
    if (!window.confirm(`Delete the template "${t.name}"? Orders already made from it are not affected.`)) return
    try { await apiFetch(`/api/templates/${t.id}/delete`, { method: 'POST', body: '{}' }); setNotice(`Deleted "${t.name}".`); await load() } catch (err) { setError(msg(err)) }
  }

  return (
    <>
      <h2>TNA templates</h2>
      <p className="sub">A template lists the stages of a product in the order they happen. For each stage, say how many working days before ex-factory it must finish, and which unit does it. Order setup works the dates out backwards from the ex-factory date.</p>
      {error && <p className="banner" role="alert">{error}</p>}
      {notice && <p className="notice-box" role="status">{notice}</p>}

      {!editing && (
        <>
          <button className="btn btn--primary" onClick={() => open(null)} disabled={!units.length}>New template</button>
          {!units.length && <p className="sub">Add a unit first (People, then Add a unit).</p>}
          <ul className="plain stagelist" style={{ marginTop: 12 }}>
            {list?.map((t) => (
              <li key={t.id} className="stagecard">
                <div className="stagecard__top"><b>{t.name}</b><span className="sub">{t.stages.length} stage{t.stages.length === 1 ? '' : 's'}</span></div>
                <p className="sub">{t.stages.map((s) => `${s.stage} (${s.workingDaysBefore}, ${s.unitName})`).join('  →  ')}</p>
                <div className="actions"><button className="btn btn--small" onClick={() => open(t)}>Edit</button><button className="btn btn--small" onClick={() => void remove(t)}>Delete</button></div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <form className="card change" onSubmit={save} noValidate>
          <label className="field"><span>Template name</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
          <p className="sub">Stages, in the order they happen. Use the biggest number first: a stage listed later is due later.</p>
          <div className="tplrows">
            {rows.map((r, i) => (
              <div className="tplrow" key={r.id}>
                <input className="input" aria-label={`Stage ${i + 1} name`} placeholder="Stage (e.g. sewing)" value={r.stage} maxLength={40} onChange={(e) => upd(r.id, { stage: e.target.value })} />
                <input className="input mono" aria-label={`Stage ${i + 1} working days before ex-factory`} placeholder="Days before" inputMode="numeric" value={r.days} onChange={(e) => upd(r.id, { days: e.target.value })} />
                <select className="input" aria-label={`Stage ${i + 1} unit`} value={r.unitId} onChange={(e) => upd(r.id, { unitId: e.target.value })}>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                <span className="tplrow__btns">
                  <button type="button" className="btn btn--small" aria-label={`Move stage ${i + 1} up`} disabled={i === 0} onClick={() => setRows(moveRow(rows, i, -1))}>↑</button>
                  <button type="button" className="btn btn--small" aria-label={`Move stage ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => setRows(moveRow(rows, i, 1))}>↓</button>
                  <button type="button" className="btn btn--small" aria-label={`Remove stage ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.id !== r.id))}>Remove</button>
                </span>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn--small" onClick={() => setRows([...rows, blank(firstUnit)])}>Add a stage</button>
          {problem && <p className="error" role="status">{problem}</p>}
          <div className="actions">
            <button className="btn btn--primary" disabled={busy || !!problem}>{busy ? 'Saving…' : 'Save template'}</button>
            <button type="button" className="btn" onClick={() => { setEditing(null); setError(null) }}>Cancel</button>
          </div>
        </form>
      )}
    </>
  )
}
