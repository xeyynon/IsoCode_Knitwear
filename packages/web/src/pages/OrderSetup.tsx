import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, apiFetch } from '../api/session'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import { shortDate } from '../board/boardLogic'
import { isRealDate, parseSizes, SIZE_PRESETS, validateOrder, type FormErrors, type OrderForm } from '../orders/orderForm'
import { AppBar } from '../ui/AppBar'
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
  const errors: FormErrors = validateOrder(form)
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
    }
  }

  const err = (k: keyof FormErrors) => (showErrors && errors[k] ? <span className="field__error" role="alert">{errors[k]}</span> : null)
  const problemList = Object.values(errors)

  return (
    <>
      <AppBar title="New order" />
      <main className="page page--form">
        <Link className="link back" to="/board">← Order board</Link>
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
            {serverError && <p className="banner" role="alert">{serverError}</p>}

            <section className="card">
              <h2>Order</h2>
              <label className="field"><span>Buyer</span>
                <select className="input" value={form.buyerId} onChange={(e) => set('buyerId', e.target.value)} aria-invalid={showErrors && !!errors.buyerId}>
                  <option value="">Choose a buyer</option>
                  {opts.buyers.map((b) => <option key={b.id} value={b.id}>{b.name}{b.country ? ` (${b.country})` : ''}</option>)}
                </select>{err('buyerId')}
              </label>
              <div className="grid3">
                <label className="field"><span>PO number</span>
                  <input className="input mono" value={form.po} onChange={(e) => set('po', e.target.value)} aria-invalid={showErrors && !!errors.po} />{err('po')}</label>
                <label className="field"><span>Style</span>
                  <input className="input" value={form.style} onChange={(e) => set('style', e.target.value)} aria-invalid={showErrors && !!errors.style} />{err('style')}</label>
                <label className="field"><span>Colour</span>
                  <input className="input" value={form.colour} onChange={(e) => set('colour', e.target.value)} aria-invalid={showErrors && !!errors.colour} />{err('colour')}</label>
              </div>
            </section>

            <section className="card">
              <h2>Quantity by size</h2>
              <div className="sizes">
                {form.rows.map((r) => (
                  <div className="sizes__row" key={r.id}>
                    <input className="input" aria-label="Size" placeholder="Size" value={r.size}
                      onChange={(e) => set('rows', form.rows.map((x) => (x.id === r.id ? { ...x, size: e.target.value } : x)))} />
                    <input className="input mono" aria-label={`Quantity for size ${r.size || 'row'}`} placeholder="Pieces" inputMode="numeric" value={r.qty}
                      onChange={(e) => set('rows', form.rows.map((x) => (x.id === r.id ? { ...x, qty: e.target.value } : x)))} />
                    <button type="button" className="btn btn--small" aria-label={`Remove size ${r.size || 'row'}`}
                      onClick={() => set('rows', form.rows.filter((x) => x.id !== r.id))}>Remove</button>
                  </div>
                ))}
              </div>
              <div className="sizes__foot">
                <button type="button" className="btn btn--small" onClick={() => set('rows', [...form.rows, { id: ++nextRow, size: '', qty: '' }])}>Add a size</button>
                <span className="mono" aria-live="polite">Total <b>{sizes.total > 0 ? sizes.total.toLocaleString('en-IN') : '–'}</b>{sizes.total > 0 ? ' pieces' : ''}</span>
              </div>
              {err('sizes')}
            </section>

            <section className="card">
              <h2>Dates</h2>
              <div className="grid2">
                <label className="field"><span>Ex-factory date</span>
                  <input className="input" type="date" value={form.exFactory} onChange={(e) => set('exFactory', e.target.value)} aria-invalid={showErrors && !!errors.exFactory} />{err('exFactory')}</label>
                <label className="field"><span>TNA template</span>
                  <select className="input" value={form.templateId} onChange={(e) => set('templateId', e.target.value)} aria-invalid={showErrors && !!errors.templateId}>
                    <option value="">Choose a template</option>
                    {opts.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>{err('templateId')}</label>
              </div>

              {previewError && <p className="error" role="alert">{previewError}</p>}
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
                  {preview.problems.length > 0 && <p className="banner" role="alert">This template cannot be used: {preview.problems.join('; ')}.</p>}
                  {preview.alreadyDue.length > 0 && (
                    <p className="notice-box" role="status">
                      {preview.alreadyDue.map(cap).join(', ')} {preview.alreadyDue.length === 1 ? 'is' : 'are'} already due. You can still create the order; it will show as late on the board.
                    </p>
                  )}
                </div>
              )}
            </section>

            <button className="btn btn--primary btn--big" disabled={busy || blocked}>{busy ? 'Creating…' : 'Create order'}</button>
          </form>
        )}
      </main>
    </>
  )
}
