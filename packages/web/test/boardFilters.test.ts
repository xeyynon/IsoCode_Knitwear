import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { appliedFilters, filtersButtonText, panelFilterCount, type PanelFilters } from '../src/board/filterPanel'

// UI/UX plan, slice 3.2. On a phone the board spent three quarters of its first screen on controls: seven stacked rows before the
// first order. The status chips and the search stay in view; buyer, sort, unit and ship week sit behind one Filters button that says
// how many are on, and each one that is on shows as a chip that removes it (Baymard: an applied-filters summary, so nobody has to
// open the panel to see or clear what is narrowing the list).
const none: PanelFilters = { buyer: null, unit: null, week: null, sort: 'status' }
const names = { buyers: [{ id: 'b1', name: 'Buyer B' }], units: [{ id: 'u1', name: 'Unit 1' }], week: (w: string) => (w === 'this' ? 'This week (2 to 8 Nov)' : w), sort: (s: string) => (s === 'po' ? 'PO number' : s) }

describe('how many panel filters are on', () => {
  it('is 0 for the plain view (worst status first is the default, not a filter)', () => {
    expect(panelFilterCount(none)).toBe(0)
  })
  it('counts each of buyer, unit, ship week and a sort other than the default', () => {
    expect(panelFilterCount({ ...none, buyer: 'b1' })).toBe(1)
    expect(panelFilterCount({ buyer: 'b1', unit: 'u1', week: 'this', sort: 'po' })).toBe(4)
    expect(panelFilterCount({ ...none, sort: 'exfactory' })).toBe(1)
  })
  it('puts the count on the button, and nothing when there is none', () => {
    expect(filtersButtonText(0)).toBe('Filters')
    expect(filtersButtonText(3)).toBe('Filters (3)')
  })
})

describe('the applied filters, as chips that remove themselves', () => {
  it('lists nothing for the plain view', () => {
    expect(appliedFilters(none, names)).toEqual([])
  })
  it('names each one that is on, in a stable order, with its key so the right one is removed', () => {
    expect(appliedFilters({ buyer: 'b1', unit: 'u1', week: 'this', sort: 'po' }, names)).toEqual([
      { key: 'buyer', text: 'Buyer: Buyer B' },
      { key: 'unit', text: 'Unit: Unit 1' },
      { key: 'week', text: 'Ship: This week (2 to 8 Nov)' },
      { key: 'sort', text: 'Sort: PO number' },
    ])
  })
  it('says "unknown" for a shared link that names a buyer or unit that is gone, rather than hiding the filter', () => {
    const out = appliedFilters({ ...none, buyer: 'gone', unit: 'gone' }, names)
    expect(out.map((a) => a.text)).toEqual(['Buyer: Unknown buyer', 'Unit: Unknown unit'])
  })
})

// What a unit test cannot show: the board uses these on a narrow screen, and the phone card is a denser grid.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const board = read('../src/pages/Board.tsx')
const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')

describe('Board.tsx on a phone', () => {
  it('opens the buyer, sort, unit and week selects from one Filters button, closed to begin with', () => {
    expect(board).toContain('useNarrow()')
    expect(board).toContain('filtersButtonText(')
    expect(board).toMatch(/aria-expanded=\{filtersOpen\}/)
    expect(board).toMatch(/aria-controls="board-filters"/)
    expect(board).toMatch(/useState\(false\)[^\n]*\n[^\n]*|const \[filtersOpen, setFiltersOpen\] = useState\(false\)/)
  })
  it('shows each applied filter as a button that removes it, named for a screen reader', () => {
    expect(board).toContain('appliedFilters(')
    expect(board).toMatch(/aria-label=\{`Remove filter: \$\{a\.text\}`\}/)
  })
  it('keeps the filters in the address (they are still read from and written to the URL params)', () => {
    expect(board).toContain('withFilter(params')
    expect(board).toContain('withSort(params')
  })
})

describe('the phone order card', () => {
  const phone = /@media \(max-width: 720px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
  it('is a three-column grid: status and the PO take the full width, buyer, ship and gap share one row', () => {
    expect(phone).toMatch(/\.board tr\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,\s*1fr\)/)
    expect(phone).toMatch(/data-label='Status'\][^{]*\{[^}]*grid-column:\s*1\s*\/\s*-1/)
    expect(phone).toMatch(/data-label='PO'\][^{]*\{[^}]*grid-column:\s*1\s*\/\s*-1/)
  })
})
