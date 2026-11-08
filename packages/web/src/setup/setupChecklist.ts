// What is already set up for the pilot, worked out from what the Setup screens load (UI/UX plan, slice 5.1). No React, so it can be tested.
// A source that could not be loaded is `null`: that item is "unknown", never guessed as done or to do.

export interface ChecklistData {
  units: { id: string; name: string }[] | null
  accounts: { role: 'merchandiser' | 'supervisor'; disabled: boolean }[] | null
  templates: { name: string; stages: { stage: string }[] }[] | null
  /** The calendar entries a merchandiser has made (every unit). Sundays are closed without an entry. */
  days: { working: boolean }[] | null
}

export type ItemId = 'units' | 'days' | 'templates' | 'people'
export type ItemState = 'done' | 'todo' | 'unknown'
export type SetupTab = 'people' | 'days' | 'templates'
export type Overall = 'nothing' | 'partly' | 'done' | 'failed'

export interface ChecklistItem {
  id: ItemId
  label: string
  state: ItemState
  /** One plain sentence about what exists, or what is missing and why it matters. */
  detail: string
  /** The Setup section that fixes it, and the words on the link that goes there when it is still to do. */
  tab: SetupTab
  anchor?: string
  action: string
}

export interface Checklist {
  items: ChecklistItem[]
  doneCount: number
  total: number
  overall: Overall
  /** The labels still to do, in order. */
  left: string[]
  /** The one line that says where things stand. */
  line: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const MAX_NAMES = 3
const MAX_STAGES = 6

/** "A, B, C and 2 more": the first few names, then how many are not shown. */
function names(list: string[]): string {
  if (list.length <= MAX_NAMES) return list.join(', ')
  return `${list.slice(0, MAX_NAMES).join(', ')} and ${list.length - MAX_NAMES} more`
}

/** A template in words: "Basic tee: Cutting, then Sewing, then Packing". */
export function templateSummary(t: { name: string; stages: { stage: string }[] }): string {
  if (t.stages.length === 0) return `${t.name}: no stages`
  const shown = t.stages.slice(0, MAX_STAGES).map((s) => s.stage).join(', then ')
  return `${t.name}: ${shown}${t.stages.length > MAX_STAGES ? ', then …' : ''}`
}

const unknown = { state: 'unknown' as const, detail: 'Could not check this.' }

export function checklist(d: ChecklistData): Checklist {
  const units: ChecklistItem = {
    id: 'units', label: 'Units', tab: 'people', anchor: 'add-unit', action: 'Add a unit',
    ...(d.units === null ? unknown
      : d.units.length > 0 ? { state: 'done' as const, detail: `${plural(d.units.length, 'unit')}: ${names(d.units.map((u) => u.name))}` }
      : { state: 'todo' as const, detail: 'No unit yet. Supervisors and templates need one.' }),
  }
  const days: ChecklistItem = {
    id: 'days', label: 'Closed days', tab: 'days', action: 'Add closed days',
    ...(d.days === null ? unknown
      : d.days.length > 0 ? (() => {
        const worked = d.days!.filter((x) => x.working).length
        const closed = d.days!.length - worked
        const parts = [closed > 0 ? `${closed} closed` : '', worked > 0 ? `${worked} worked` : ''].filter(Boolean)
        return { state: 'done' as const, detail: `${plural(d.days!.length, 'day')} set: ${parts.join(', ')}` }
      })()
      : { state: 'todo' as const, detail: 'Only Sundays are closed so far. Add the holidays you know of.' }),
  }
  const templates: ChecklistItem = {
    id: 'templates', label: 'Templates', tab: 'templates', action: 'Add a template',
    ...(d.templates === null ? unknown
      : d.templates.length > 0 ? {
        state: 'done' as const,
        detail: d.templates.length === 1 ? templateSummary(d.templates[0]!) : `${templateSummary(d.templates[0]!)}, and ${d.templates.length - 1} more template${d.templates.length === 2 ? '' : 's'}`,
      }
      : { state: 'todo' as const, detail: 'No template yet. An order needs one to work out its stage dates.' }),
  }
  const people: ChecklistItem = {
    id: 'people', label: 'People', tab: 'people', action: 'Add a person',
    ...(d.accounts === null ? unknown : (() => {
      const active = d.accounts!.filter((a) => !a.disabled)
      const supervisors = active.filter((a) => a.role === 'supervisor').length
      const merchandisers = active.filter((a) => a.role === 'merchandiser').length
      if (supervisors > 0) {
        return { state: 'done' as const, detail: `${plural(supervisors, 'supervisor')}${merchandisers > 0 ? ` and ${plural(merchandisers, 'merchandiser')}` : ''} can sign in` }
      }
      return { state: 'todo' as const, detail: merchandisers > 0 ? `${plural(merchandisers, 'merchandiser')}, no supervisor can sign in yet` : 'No supervisor can sign in yet.' }
    })()),
  }
  const items = [units, days, templates, people]
  const doneCount = items.filter((i) => i.state === 'done').length
  const todo = items.filter((i) => i.state === 'todo')
  const unknownItems = items.filter((i) => i.state === 'unknown')
  const total = items.length

  let overall: Overall
  if (unknownItems.length === total) overall = 'failed'
  else if (doneCount === total) overall = 'done'
  else if (doneCount === 0 && unknownItems.length === 0) overall = 'nothing'
  else overall = 'partly'

  const left = todo.map((i) => i.label)
  let line: string
  if (overall === 'failed') line = 'Could not check what is set up.'
  else if (overall === 'done') line = 'Everything is set up for the pilot.'
  else if (overall === 'nothing') line = 'Nothing is set up yet. Start with the units.'
  else line = `${doneCount} of ${total} done.${left.length > 0 ? ` Left: ${left.join(', ')}.` : ''}${unknownItems.length > 0 ? ` Could not check: ${unknownItems.map((i) => i.label).join(', ')}.` : ''}`
  return { items, doneCount, total, overall, left, line }
}
