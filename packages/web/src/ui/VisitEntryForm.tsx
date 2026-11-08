import { useEffect, useId, useRef, useState } from 'react'
import { ApiError, apiFetch } from '../api/session'
import { Button } from './atoms/Button'
import { Card } from './atoms/Card'
import { DateWords } from './atoms/DateWords'
import { ErrorText } from './atoms/ErrorText'
import { Input, Select } from './atoms/Input'
import { Field } from './molecules/Field'
import { checkVisitEntry, visitEntryDone, type VisitEntryForm as Fields } from '../orders/visitEntry'
import { MAX_NOTE } from '../notes/reasons'
import { setUnsentInput } from './unsentInput'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * "Add an update" for a merchandiser: a stage nobody on the floor reports for (a subcontractor) is
 * entered here on a visit. The server stores it as entered on behalf, so it shows as low confidence.
 * The entry keeps one id until it is accepted, so pressing the button again after a lost answer
 * cannot count the pieces twice; changing anything makes it a new entry.
 */
export function VisitEntryForm({ orderId, stages, today, onAdded, left, stageQty }: { orderId: string; stages: string[]; today: string; onAdded: () => Promise<void>; left?: Record<string, number>; stageQty?: Record<string, number> }) {
  const uid = useId()
  const [f, setF] = useState<Fields>({ stage: stages[0] ?? '', date: today, pieces: '', note: '' })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ field: 'stage' | 'date' | 'pieces' | 'send'; text: string } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // More than is left on the stage: the first press asks, the second adds it (the same step the supervisor's screen has). Any edit asks again.
  const [confirming, setConfirming] = useState(false)
  const entryId = useRef<string | null>(null)
  const pieces = useRef<HTMLInputElement>(null)
  const stage = useRef<HTMLSelectElement>(null)
  const date = useRef<HTMLInputElement>(null)
  const sending = useRef(false)

  // The new-version bar waits while something is typed but not yet sent.
  const unsent = f.pieces !== '' || f.note !== ''
  useEffect(() => { setUnsentInput('visit-entry', unsent) }, [unsent])
  useEffect(() => () => setUnsentInput('visit-entry', false), [])

  const set = (patch: Partial<Fields>) => { setF((x) => ({ ...x, ...patch })); entryId.current = null; setProblem(null); setConfirming(false) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (sending.current) return
    setDone(null)
    entryId.current ??= crypto.randomUUID()
    const c = checkVisitEntry(f, { today, stages, orderId, clientUuid: entryId.current, left: left?.[f.stage], stageQty: stageQty?.[f.stage], confirmed: confirming })
    if (!c.ok) {
      setConfirming(c.confirm === true)
      setProblem({ field: c.field, text: c.error })
      ;(c.field === 'stage' ? stage : c.field === 'date' ? date : pieces).current?.focus()
      return
    }
    sending.current = true; setBusy(true); setProblem(null)
    try {
      const r = await apiFetch<{ duplicate: boolean }>('/api/events', { method: 'POST', body: JSON.stringify(c.body) })
      entryId.current = null; setConfirming(false)
      setF((x) => ({ ...x, pieces: '', note: '' }))
      setDone(r.duplicate ? 'That entry was already recorded. It was not counted twice.' : visitEntryDone(c.body.stage, c.body.qty, c.body.date))
      await onAdded()
      pieces.current?.focus()
    } catch (err) {
      setProblem({ field: 'send', text: err instanceof ApiError ? err.message : 'Could not send. Try again.' })
    }
    sending.current = false; setBusy(false)
  }

  const bad = (k: 'stage' | 'date' | 'pieces') => problem?.field === k
  return (
    <Card>
      {/* Open once the person opens it, and kept open while they type: it must not fold away when an error clears. */}
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary><b>Add an update</b></summary>
        <form onSubmit={submit} noValidate className="change">
          <p className="sub">For a stage nobody on the floor reports, such as a subcontractor. It is kept as entered by a merchandiser and shown as low confidence.</p>
          <Field label="Stage">
            <Select ref={stage} value={f.stage} aria-invalid={bad('stage')} aria-describedby={bad('stage') ? `${uid}-err` : undefined} onChange={(e) => set({ stage: e.target.value })}>
              {stages.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
            </Select></Field>
          <Field label="Date of the count">
            <Input ref={date} type="date" max={today} value={f.date} aria-invalid={bad('date')} aria-describedby={bad('date') ? `${uid}-err` : undefined} onChange={(e) => set({ date: e.target.value })} /><DateWords iso={f.date} /></Field>
          <Field label="Pieces made that day">
            <Input ref={pieces} mono inputMode="numeric" autoComplete="off" value={f.pieces} aria-invalid={bad('pieces')} aria-describedby={bad('pieces') ? `${uid}-err` : undefined} onChange={(e) => set({ pieces: e.target.value })} /></Field>
          <Field label="Note (optional)">
            <Input value={f.note} maxLength={MAX_NOTE} onChange={(e) => set({ note: e.target.value })} /></Field>
          {problem && <ErrorText id={`${uid}-err`}>{problem.text}</ErrorText>}
          <Button variant="primary" disabled={busy}>{busy ? 'Adding…' : confirming ? 'Add anyway' : 'Add update'}</Button>
        </form>
      </details>
      {done && <p className="notice-box" role="status">{done}</p>}
    </Card>
  )
}
