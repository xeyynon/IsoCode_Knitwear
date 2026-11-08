import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { strings, translate } from '../src/i18n'

// UI/UX plan, slice 4.3: an empty screen says what will appear and how.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const today = read('../src/pages/Today.tsx')
const board = read('../src/pages/Board.tsx')
const review = read('../../../audit/TAMIL-REVIEW.md')

describe('Today with nothing to update', () => {
  it('says what will appear and who makes it appear, in both languages', () => {
    expect(strings.en['today.nothingNext']).toMatch(/new orders appear here/i)
    expect(strings.en['today.nothingNext']).toMatch(/merchandiser/i)
    expect(strings.ta['today.nothingNext']).toBeTruthy()
    expect(translate('ta', 'today.nothingNext')).toContain('மெர்ச்சண்டைசர்')   // the word the sign-in screen already uses
  })
  it('keeps the first sentence and adds the second under it', () => {
    expect(today).toContain("t('today.nothing')")
    expect(today).toContain("t('today.nothingNext')")
  })
  it('lists the new Tamil as a draft for supervisors to review', () => {
    expect(review).toContain('`today.nothingNext`')
  })
})

describe('Board with no orders', () => {
  it('offers the way to make the first one, not only a sentence', () => {
    expect(board).toMatch(/No orders yet\.[\s\S]{0,200}<(Button)?Link[^>]*to="\/orders\/new"/)
  })
})
