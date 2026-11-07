import { describe, expect, it } from 'vitest'
import { checklist, templateSummary, type ChecklistData } from '../src/setup/setupChecklist'

// UI/UX plan, slice 5.1: a pilot setup checklist that reads what is already set up from real data, never invents a state.
const unit = (id: string, name: string) => ({ id, name })
const sup = (disabled = false) => ({ role: 'supervisor' as const, disabled })
const mer = (disabled = false) => ({ role: 'merchandiser' as const, disabled })
const tpl = (name: string, stages: string[]) => ({ name, stages: stages.map((stage) => ({ stage })) })
const empty: ChecklistData = { units: [], accounts: [mer()], templates: [], days: [] }
const full: ChecklistData = {
  units: [unit('1', 'Unit 1'), unit('2', 'Unit 2')],
  accounts: [mer(), sup(), sup()],
  templates: [tpl('Basic tee', ['Cutting', 'Sewing', 'Packing'])],
  days: [{ working: false }, { working: false }, { working: true }],
}
const by = (c: ReturnType<typeof checklist>, id: string) => c.items.find((i) => i.id === id)!

describe('the four items, in the order a pilot is set up', () => {
  it('units, closed days, templates, people', () => {
    expect(checklist(full).items.map((i) => i.id)).toEqual(['units', 'days', 'templates', 'people'])
  })
})

describe('nothing set up', () => {
  const c = checklist(empty)
  it('every item is still to do, and the overall state says so', () => {
    expect(c.items.every((i) => i.state === 'todo')).toBe(true)
    expect(c.overall).toBe('nothing')
    expect(c.doneCount).toBe(0)
    expect(c.line).toMatch(/nothing is set up yet/i)
  })
  it('says what each missing item stops, in plain words', () => {
    expect(by(c, 'units').detail).toMatch(/no unit yet/i)
    expect(by(c, 'days').detail).toMatch(/only sundays/i)
    expect(by(c, 'templates').detail).toMatch(/no template yet/i)
    expect(by(c, 'people').detail).toMatch(/no supervisor can sign in yet/i)
  })
  it('each missing item names the action that fixes it', () => {
    expect(c.items.map((i) => i.action)).toEqual(['Add a unit', 'Add closed days', 'Add a template', 'Add a person'])
  })
})

describe('partly set up', () => {
  const c = checklist({ ...full, templates: [], days: [] })
  it('counts what is done and names what is left, in order', () => {
    expect(c.overall).toBe('partly')
    expect(c.doneCount).toBe(2)
    expect(c.left).toEqual(['Closed days', 'Templates'])
    expect(c.line).toBe('2 of 4 done. Left: Closed days, Templates.')
  })
})

describe('all set up', () => {
  const c = checklist(full)
  it('says so once, with nothing left', () => {
    expect(c.overall).toBe('done')
    expect(c.doneCount).toBe(4)
    expect(c.left).toEqual([])
    expect(c.line).toBe('Everything is set up for the pilot.')
  })
  it('describes what exists, in words and numbers from the data', () => {
    expect(by(c, 'units').detail).toBe('2 units: Unit 1, Unit 2')
    expect(by(c, 'days').detail).toBe('3 days set: 2 closed, 1 worked')
    expect(by(c, 'templates').detail).toBe('Basic tee: Cutting, then Sewing, then Packing')
    expect(by(c, 'people').detail).toBe('2 supervisors and 1 merchandiser can sign in')
  })
})

describe('people: only accounts that can sign in count', () => {
  it('a stopped supervisor does not make the item done', () => {
    const c = checklist({ ...full, accounts: [mer(), sup(true)] })
    expect(by(c, 'people').state).toBe('todo')
    expect(by(c, 'people').detail).toMatch(/no supervisor can sign in yet/i)
  })
  it('a merchandiser alone is not enough, and the detail still tells who exists', () => {
    expect(by(checklist({ ...full, accounts: [mer(), mer()] }), 'people').detail).toBe('2 merchandisers, no supervisor can sign in yet')
  })
})

describe('wording of counts and long lists', () => {
  it('one unit is "1 unit"', () => expect(by(checklist({ ...full, units: [unit('1', 'Unit 1')] }), 'units').detail).toBe('1 unit: Unit 1'))
  it('more than three units end in "and N more"', () => {
    const units = ['A', 'B', 'C', 'D', 'E'].map((n, i) => unit(String(i), n))
    expect(by(checklist({ ...full, units }), 'units').detail).toBe('5 units: A, B, C and 2 more')
  })
  it('only worked days, or only closed days, say just that', () => {
    expect(by(checklist({ ...full, days: [{ working: true }] }), 'days').detail).toBe('1 day set: 1 worked')
    expect(by(checklist({ ...full, days: [{ working: false }, { working: false }] }), 'days').detail).toBe('2 days set: 2 closed')
  })
  it('more than one template: the first in words, then "and N more"', () => {
    const c = checklist({ ...full, templates: [tpl('Basic tee', ['Cutting', 'Sewing']), tpl('Polo', ['Cutting']), tpl('Hoodie', ['Cutting'])] })
    expect(by(c, 'templates').detail).toBe('Basic tee: Cutting, then Sewing, and 2 more templates')
  })
})

describe('templateSummary', () => {
  it('lists the stages in order, joined with "then"', () => {
    expect(templateSummary(tpl('Basic tee', ['Cutting', 'Sewing', 'Packing']))).toBe('Basic tee: Cutting, then Sewing, then Packing')
  })
  it('a template with no stage says so, and a long one is cut with an ellipsis', () => {
    expect(templateSummary(tpl('Empty', []))).toBe('Empty: no stages')
    expect(templateSummary(tpl('Long', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']))).toBe('Long: a, then b, then c, then d, then e, then f, then …')
  })
})

describe('what could not be read is never guessed', () => {
  it('a source that failed to load is "unknown", not done and not to do', () => {
    const c = checklist({ ...full, templates: null })
    expect(by(c, 'templates').state).toBe('unknown')
    expect(by(c, 'templates').detail).toBe('Could not check this.')
    expect(c.doneCount).toBe(3)
    expect(c.overall).toBe('partly')
    expect(c.line).toBe('3 of 4 done. Could not check: Templates.')
  })
  it('when nothing could be read the overall state is "failed"', () => {
    const c = checklist({ units: null, accounts: null, templates: null, days: null })
    expect(c.overall).toBe('failed')
    expect(c.line).toBe('Could not check what is set up.')
  })
  it('all four known and done, with one unknown, is never "done"', () => {
    expect(checklist({ ...full, days: null }).overall).toBe('partly')
  })
})
