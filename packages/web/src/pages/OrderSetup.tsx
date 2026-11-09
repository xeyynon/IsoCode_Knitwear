import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, apiFetch } from '../api/session'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import { shortDate } from '../board/boardLogic'
import { istDate } from '../dates'
import { pieces } from '../numberFormat'
import { Banner } from '../ui/atoms/Banner'
import { Button } from '../ui/atoms/Button'
import { Card } from '../ui/atoms/Card'
import { DateWords } from '../ui/atoms/DateWords'
import { ErrorText } from '../ui/atoms/ErrorText'
import { Input, Select } from '../ui/atoms/Input'
import { BackLink } from '../ui/molecules/BackLink'
import { Field } from '../ui/molecules/Field'
import { exFactoryRule, isRealDate, MAX_SIZE_ROWS, parseSizes, SIZE_PRESETS, validateOrder, type FormErrors, type OrderForm } from '../orders/orderForm'
import { MerchandiserShell } from '../ui/templates/MerchandiserShell'
import { LoadFailed } from '../ui/LoadFailed'
import { Loading } from '../ui/Loading'

interface Options {
  buyers: { id: string; name: string; country: string | null }[]
  templates: { id: string; name: string; stages: { stage: string; workingDaysBefore: number }[] }[]
}
interface Preview {
  milestones: { stage: string; unitName: string; plannedEnd: string }[]
  problems: string[]
  alreadyDue: string[]
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
let nextRow = 100

export default function OrderSetup() {
  const nav = useNavigate()
  const [opts, setOpts] = useState<Options | null>(null)
  const [loadError, setLoadError] = useState<LoadFailure | null>(null)
  const [form, setForm] = useState<OrderForm>({
    buyerId: '', po: '', style: '', colour: '', exFactory: '', templateId: '',
    rows: SIZE_PRESETS.map((size, i) => ({ id: i + 1, size, qty: '' })),
  })
  const [showErrors, setShowErrors] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const errorsRef = useRef<HTMLDivElement>(null)
  const [failedTries, setFailedTries] = useState(0)

  // The banner only exists after the first failed Create, so move focus once it has rendered.
  useEffect(() => {
    if (failedTries > 0) errorsRef.current?.focus()
  }, [failedTries])

  const loadOptions = useCallback(() => {
    setLoadError(null)
    apiFetch<Options>('/api/orders/options').then(setOpts).catch((e) => setLoadError(describeFailure(e, 'Could not load the form.')))
  }, [])
  useEffect(loadOptions, [loadOptions])

  // Show the dates the order would get as soon as there is a template and a real date, BEFORE creating it.
  useEffect(() => {
    setPreview(null); setPreviewError(null)
    if (!form.templateId || !isRealDate(form.exFactory)) return
    const ctl = new AbortController()
    const t = window.setTimeout(() => {
      apiFetch<Preview>('/api/orders/preview', { method: 'POST', body: JSON.stringify({ templateId: form.templateId, exFactory: form.exFactory }), signal: ctl.signal })
        .then(setPreview)
        .catch((e) => { if ((e as Error).name !== 'AbortError') setPreviewError(e instanceof ApiError ? e.message : 'Could not work out the dates.') })
    }, 300)
    return () => { window.clearTimeout(t); ctl.abort() }
  }, [form.templateId, form.exFactory])

  const set = <K extends keyof OrderForm>(k: K, v: OrderForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const errors: FormErrors = validateOrder(form, istDate())
  const sizes = parseSizes(form.rows)
  const blocked = (preview?.problems.length ?? 0) > 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (Object.keys(errors).length || blocked) { setShowErrors(true); setFailedTries((n) => n + 1); return }
    setBusy(true)
    try {
      const r = await apiFetch<{ orderId: string }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ buyerId: form.buyerId, po: form.po, style: form.style, colour: form.colour, sizes: sizes.sizes, exFactory: form.exFactory, templateId: form.templateId }),
      })
      nav(`/orders/${r.orderId}`, { state: { created: true } })
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Could not create the order.')
      setBusy(false)
      setFailedTries((n) => n + 1)   // the effect above moves focus to the message, which sits above the Create button
    }
  }

  const err = (k: keyof FormErrors) => (showErrors && errors[k] ? <span className="field__error" role="alert">{errors[k]}</span> : null)
  const problemList = Object.values(errors)

  return (
    <MerchandiserShell title="New order" plainTitle form>
        <BackLink to="/board">Order board</BackLink>
        <h1>New order</h1>
        {!opts && !loadError && <Loading label="Loading" />}
        {loadError && <LoadFailed unreachable={loadError.unreachable} message={loadError.message} onRetry={loadOptions} />}

        {opts && (
          <form className="form" onSubmit={submit} noValidate>
            {showErrors && problemList.length > 0 && (
              <div className="banner" role="alert" tabIndex={-1} ref={errorsRef}>
                <b>Fix these to create the order:</b>
                <ul>{problemList.map((m) => <li key={m}>{m}</li>)}</ul>
              </div>
            )}
            {serverError && <Banner tabIndex={-1} ref={showErrors && problemList.length > 0 ? undefined : errorsRef}>{serverError}</Banner>}

            <Card>
              <h2>Order</h2>
              <Field label="Buyer" below={err('buyerId')}>
                <Select value={form.buyerId} onChange={(e) => set('buyerId', e.target.value)} aria-invalid={showErrors && !!errors.buyerId}>
                  <option value="">Choose a buyer</option>
                  {opts.buyers.map((b) => <option key={b.id} value={b.id}>{b.name}{b.country ? ` (${b.country})` : ''}</option>)}
                </Select>
              </Field>
              <div className="grid3">
                <Field label="PO number" below={err('po')}>
                  <Input mono maxLength={200} value={form.po} onChange={(e) => set('po', e.target.value)} aria-invalid={showErrors && !!errors.po} /></Field>
                <Field label="Style" below={err('style')}>
                  <Input maxLength={200} value={form.style} onChange={(e) => set('style', e.target.value)} aria-invalid={showErrors && !!errors.style} /></Field>
                <Field label="Colour" below={err('colour')}>
                  <Input maxLength={200} value={form.colour} onChange={(e) => set('colour', e.target.value)} aria-invalid={showErrors && !!errors.colour} /></Field>
              </div>
            </Card>

            <Card>
              <h2>Quantity by size</h2>
              <div className="sizes">
                {form.rows.map((r) => (
                  <div className="sizes__row" key={r.id}>
                    <Input aria-label="Size" placeholder="Size" value={r.size}
                      onChange={(e) => set('rows', form.rows.map((x) => (x.id === r.id ? { ...x, size: e.target.value } : x)))} />
                    <Input mono aria-label={`Quantity for size ${r.size || 'row'}`} placeholder="Pieces" inputMode="numeric" value={r.qty}
                      onChange={(e) => set('rows', form.rows.map((x) => (x.id === r.id ? { ...x, qty: e.target.value } : x)))} />
                    <Button type="button" size="small" aria-label={`Remove size ${r.size || 'row'}`}
                      onClick={() => set('rows', form.rows.filter((x) => x.id !== r.id))}>Remove</Button>
                  </div>
                ))}
              </div>
              <div className="sizes__foot">
                <Button type="button" size="small" disabled={form.rows.length >= MAX_SIZE_ROWS} onClick={() => set('rows', [...form.rows, { id: ++nextRow, size: '', qty: '' }])}>{form.rows.length >= MAX_SIZE_ROWS ? `At most ${MAX_SIZE_ROWS} sizes` : 'Add a size'}</Button>
                <span className="mono" aria-live="polite">Total <b>{sizes.total > 0 ? pieces(sizes.total) : '–'}</b>{sizes.total > 0 ? ' pieces' : ''}</span>
              </div>
              {err('sizes')}
            </Card>

            <Card>
              <h2>Dates</h2>
              <div className="grid2">
                <Field label="Ex-factory date" below={err('exFactory')}>
                  <Input type="date" value={form.exFactory} onChange={(e) => set('exFactory', e.target.value)} aria-invalid={showErrors && !!errors.exFactory} /><DateWords iso={form.exFactory} />{exFactoryRule(form.exFactory, istDate())?.kind === 'confirm' && <small className="sub" role="status">{exFactoryRule(form.exFactory, istDate())!.text}</small>}</Field>
                <Field label="TNA template" below={err('templateId')}>
                  <Select value={form.templateId} onChange={(e) => set('templateId', e.target.value)} aria-invalid={showErrors && !!errors.templateId}>
                    <option value="">Choose a template</option>
                    {opts.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select></Field>
              </div>

              {previewError && <ErrorText>{previewError}</ErrorText>}
              {form.templateId && isRealDate(form.exFactory) && !preview && !previewError && <p className="sub" role="status">Working out the dates…</p>}
              {preview && (
                <div aria-live="polite">
                  <table className="plan">
                    <caption>Each stage must finish by:</caption>
                    <thead><tr><th scope="col">Stage</th><th scope="col">Unit</th><th scope="col">Finish by</th></tr></thead>
                    <tbody>{preview.milestones.map((m) => (
                      <tr key={m.stage}><td>{cap(m.stage)}</td><td>{m.unitName}</td><td className="mono">{shortDate(m.plannedEnd)}</td></tr>
                    ))}</tbody>
                  </table>
                  {preview.problems.length > 0 && <Banner>This template cannot be used: {preview.problems.join('; ')}.</Banner>}
                  {preview.alreadyDue.length > 0 && (
                    <p className="notice-box" role="status">
                      {preview.alreadyDue.map(cap).join(', ')} {preview.alreadyDue.length === 1 ? 'is' : 'are'} already due. You can still create the order; it will show as late on the board.
                    </p>
                  )}
                </div>
              )}
            </Card>

            <Button variant="primary" size="big" disabled={busy || blocked}>{busy ? 'Creating…' : 'Create order'}</Button>
          </form>
        )}
    </MerchandiserShell>
  )
}
