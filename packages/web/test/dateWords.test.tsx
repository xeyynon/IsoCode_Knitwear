// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dateInWords } from '../src/dateWords'
import { DateWords } from '../src/ui/atoms/DateWords'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('dateInWords', () => {
  it('writes the weekday, day, month and year', () => {
    expect(dateInWords('2026-11-12')).toBe('Thursday, 12 Nov 2026')
    expect(dateInWords('2026-01-01')).toBe('Thursday, 1 Jan 2026')
    expect(dateInWords('2028-02-29')).toBe('Tuesday, 29 Feb 2028')
  })
  it('says nothing for a half-typed or impossible date', () => {
    for (const bad of ['', '2026-11', '2026-13-01', '2026-02-30', '2027-02-29', 'soon']) expect(dateInWords(bad), bad).toBe('')
  })
})

describe('DateWords', () => {
  it('draws the words for a real day, and nothing for an empty one', () => {
    const a = render(<DateWords iso="2026-11-12" />)
    expect(a.container.textContent).toBe('Thursday, 12 Nov 2026')
    a.unmount()
    expect(render(<DateWords iso="" />).container.textContent).toBe('')
  })
  it('stays out of the field label for a screen reader', () => {
    expect(render(<DateWords iso="2026-11-12" />).container.querySelector('small')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('every date field reads its date back', () => {
  it.each([
    ['pages/OrderDetail.tsx', '<DateWords iso={date} />'],
    ['pages/OrderSetup.tsx', '<DateWords iso={form.exFactory} />'],
    ['setup/DaysTab.tsx', '<DateWords iso={date} />'],
    ['ui/VisitEntryForm.tsx', '<DateWords iso={f.date} />'],
  ])('%s', (file, usage) => {
    expect(read(`../src/${file}`)).toContain(usage)
  })
})
