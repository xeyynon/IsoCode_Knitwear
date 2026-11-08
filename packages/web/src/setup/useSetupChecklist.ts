import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api/session'
import { describeFailure, type LoadFailure } from '../api/sessionRules'
import { checklist, type Checklist, type ChecklistData } from './setupChecklist'
import { latestRequest } from './setupLogic'

const CHANGED = 'orders:setup-changed'

/** A Setup section calls this after it has changed something (a person, a unit), so the checklist follows at once. */
export const notifySetupChanged = (): void => { window.dispatchEvent(new Event(CHANGED)) }

type Answer<T> = { ok: true; value: T } | { ok: false; error: unknown }
const ask = <T,>(path: string): Promise<Answer<T>> => apiFetch<T>(path).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))

/**
 * What is set up, for the checklist at the top of Setup. Read from the same endpoints the sections use (no new API). Asked when the
 * page opens, when the section changes, and when a section says it changed something. One source failing leaves only its own item
 * "unknown"; all four failing is "failed" with the cause, so the page can say whether the connection is the problem.
 */
export function useSetupChecklist(section: string): { result: Checklist | null; failure: LoadFailure | null; reload: () => void } {
  const [result, setResult] = useState<Checklist | null>(null)
  const [failure, setFailure] = useState<LoadFailure | null>(null)
  const latest = useRef(latestRequest())
  const load = useCallback(async () => {
    const current = latest.current.start()
    const [units, accounts, templates, days] = await Promise.all([
      ask<{ units: { id: string; name: string }[] }>('/api/units'),
      ask<{ accounts: { role: 'merchandiser' | 'supervisor'; disabled: boolean }[] }>('/api/accounts'),
      ask<{ templates: { name: string; stages: { stage: string }[] }[] }>('/api/templates'),
      ask<{ days: { working: boolean }[] }>('/api/calendar'),
    ])
    if (!current()) return
    const data: ChecklistData = {
      units: units.ok ? units.value.units : null,
      accounts: accounts.ok ? accounts.value.accounts : null,
      templates: templates.ok ? templates.value.templates : null,
      days: days.ok ? days.value.days : null,
    }
    const c = checklist(data)
    setResult(c)
    const firstError = [units, accounts, templates, days].find((a): a is { ok: false; error: unknown } => !a.ok)
    setFailure(c.overall === 'failed' && firstError ? describeFailure(firstError.error, 'Could not check what is set up.') : null)
  }, [])
  useEffect(() => { void load() }, [load, section])
  useEffect(() => {
    const on = () => { void load() }
    window.addEventListener(CHANGED, on)
    return () => window.removeEventListener(CHANGED, on)
  }, [load])
  return { result, failure, reload: () => { void load() } }
}
