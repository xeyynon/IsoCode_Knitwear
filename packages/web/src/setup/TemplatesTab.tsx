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
import { moveRow, templateProblem, type StageRow } from './setupLogic'

interface Unit { id: string; name: string }
interface Template { id: string; name: string; stages: { stage: string; workingDaysBefore: number; unitId: string; unitName: string }[] }

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'That did not work. Please try again.')
let next = 1000
const blank = (unitId: string): StageRow => ({ id: ++next, stage: '', days: '', unitId })

export function TemplatesTab() {
  const { t: tr } = useLang()   // `t` is the template in this file
  const { confirm, dialog } = useConfirm()
  const [units, setUnits] = useState<Unit[]>([])
  const [list, setList] = useState<Template[] | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<StageRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadFail, setLoadFail] = useState<LoadFailure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [u, t] = await Promise.all([apiFetch<{ units: Unit[] }>('/api/units'), apiFetch<{ templates: Template[] }>('/api/templates')])
      setUnits(u.units); setList(t.templates); setError(null); setLoadFail(null)
    } catch (e) { setLoadFail(describeFailure(e, 'Could not load the templates.')) }
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
    if (!(await confirm({ title: tr('confirm.deleteTemplateTitle', { name: t.name }), body: tr('confirm.deleteTemplateBody'), confirmLabel: tr('confirm.deleteTemplateYes'), cancelLabel: tr('confirm.cancel'), destructive: true }))) return
    try { await apiFetch(`/api/templates/${t.id}/delete`, { method: 'POST', body: '{}' }); setNotice(`Deleted "${t.name}".`); await load() } catch (err) { setError(msg(err)) }
  }

  return (
    <>
      {dialog}
      <h2>TNA templates</h2>
      <p className="sub">A template lists the stages of a product in the order they happen. For each stage, say how many working days before ex-factory it must finish, and which unit does it. Order setup works the dates out backwards from the ex-factory date.</p>
      {error && <Banner>{error}</Banner>}
      {notice && <p className="notice-box" role="status">{notice}</p>}
      {loadFail && <LoadFailed unreachable={loadFail.unreachable} message={loadFail.message} onRetry={() => void load()} />}

      {!editing && (
        <>
          <Button variant="primary" onClick={() => open(null)} disabled={!units.length}>New template</Button>
          {!units.length && <p className="sub">Add a unit first (People, then Add a unit).</p>}
          <ul className="plain stagelist" style={{ marginTop: 12 }}>
            {list?.map((t) => (
              <li key={t.id} className="stagecard">
                <div className="stagecard__top"><b>{t.name}</b><span className="sub">{t.stages.length} stage{t.stages.length === 1 ? '' : 's'}</span></div>
                <p className="sub">{t.stages.map((s) => `${s.stage} (${s.workingDaysBefore}, ${s.unitName})`).join('  →  ')}</p>
                <div className="actions"><Button size="small" onClick={() => open(t)}>Edit</Button><Button size="small" onClick={() => void remove(t)}>Delete</Button></div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <Card as="form" className="change" onSubmit={save} noValidate>
          <Field label="Template name"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
          <p className="sub">Stages, in the order they happen. Use the biggest number first: a stage listed later is due later.</p>
          <div className="tplrows">
            {rows.map((r, i) => (
              <div className="tplrow" key={r.id}>
                <Input aria-label={`Stage ${i + 1} name`} placeholder="Stage (e.g. sewing)" value={r.stage} maxLength={40} onChange={(e) => upd(r.id, { stage: e.target.value })} />
                <Input mono aria-label={`Stage ${i + 1} working days before ex-factory`} placeholder="Days before" inputMode="numeric" value={r.days} onChange={(e) => upd(r.id, { days: e.target.value })} />
                <Select aria-label={`Stage ${i + 1} unit`} value={r.unitId} onChange={(e) => upd(r.id, { unitId: e.target.value })}>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
                <span className="tplrow__btns">
                  <Button type="button" size="small" aria-label={`Move stage ${i + 1} up`} disabled={i === 0} onClick={() => setRows(moveRow(rows, i, -1))}>↑</Button>
                  <Button type="button" size="small" aria-label={`Move stage ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => setRows(moveRow(rows, i, 1))}>↓</Button>
                  <Button type="button" size="small" aria-label={`Remove stage ${i + 1}`} onClick={() => setRows(rows.filter((x) => x.id !== r.id))}>Remove</Button>
                </span>
              </div>
            ))}
          </div>
          <Button type="button" size="small" onClick={() => setRows([...rows, blank(firstUnit)])}>Add a stage</Button>
          {problem && <ErrorText role="status">{problem}</ErrorText>}
          <div className="actions">
            <Button variant="primary" disabled={busy || !!problem}>{busy ? 'Saving…' : 'Save template'}</Button>
            <Button type="button" onClick={() => { setEditing(null); setError(null) }}>Cancel</Button>
          </div>
        </Card>
      )}
    </>
  )
}
