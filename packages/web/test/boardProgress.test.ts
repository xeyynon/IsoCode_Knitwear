import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { piecesProgress } from '../src/board/progressText'
import type { BoardRow } from '../src/board/boardLogic'

// UI/UX plan slice 3.4 (audit 02 finding 4) and the board findings of AUDIT-03 (6, 7, 11, and the PO link size).
// The server now sends the current stage's pieces on each board row (md/api.md, DEC-028); the bar and its words are made from those, and
// nothing here estimates a number that was not reported.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const board = read('../src/pages/Board.tsx')
const boardCss = read('../src/pages/Board.css').replace(/\/\*[\s\S]*?\*\//g, '')
const styles = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  orderId: 'o1', po: 'B-PO-88240', buyerId: 'b', buyerName: 'Buyer B', style: 'tee', colour: 'navy', exFactory: '2026-11-20', status: 'red',
  worstStage: 'sewing', maths: null, shortBy: 700, reasons: [], noRecentUpdate: false, hasWarning: false,
  stagesDone: 0, stagesTotal: 1, currentStage: 'sewing', currentStageQty: 4550, currentStageProduced: 1750, currentStageMadeIsEstimate: false,
  ...over,
})

describe('piecesProgress: the bar and words from the current stage\'s pieces', () => {
  it('says the real pieces, grouped, with the stage name', () => {
    const p = piecesProgress(row())!
    expect(p.text).toBe('Sewing · 1,750 of 4,550 pieces')
    expect(p.fraction).toBeCloseTo(1750 / 4550, 5)
    expect(p.label).toBe('Sewing: 1,750 of 4,550 pieces made, 38%')
    expect(p.estimate).toBe(false)
    expect(p.stagesNote).toBeNull()
  })

  it('uses words, not "0 / 4,550", when nothing has been reported', () => {
    const p = piecesProgress(row({ currentStageProduced: 0 }))!
    expect(p.text).toBe('Sewing · no pieces reported yet (4,550 planned)')
    expect(p.text).not.toMatch(/\b0 (\/|of)\b/)
    expect(p.fraction).toBe(0)
    expect(p.label).toBe('Sewing: no pieces reported yet, 4,550 planned')
  })

  it('labels an estimate: the rate rests on fewer than 3 days of updates', () => {
    const p = piecesProgress(row({ currentStageQty: 500, currentStageProduced: 40, currentStageMadeIsEstimate: true }))!
    expect(p.estimate).toBe(true)
    expect(p.label).toContain('estimate')
    expect(p.label).toContain('fewer than 3 days')
  })

  it('does not call it an estimate when there is nothing reported to estimate from', () => {
    expect(piecesProgress(row({ currentStageProduced: 0, currentStageMadeIsEstimate: true }))!.estimate).toBe(false)
  })

  it('shows the real number over the plan and stops only the bar at full', () => {
    const p = piecesProgress(row({ currentStageQty: 500, currentStageProduced: 640 }))!
    expect(p.text).toBe('Sewing · 640 of 500 pieces')
    expect(p.fraction).toBe(1)
    expect(p.label).toContain('more than planned')
  })

  it('keeps "stages done" as a second line only when there is more than one stage', () => {
    expect(piecesProgress(row({ stagesTotal: 4, stagesDone: 1 }))!.stagesNote).toBe('1 of 4 stages done')
    expect(piecesProgress(row({ stagesTotal: 1, stagesDone: 0 }))!.stagesNote).toBeNull()
    expect(piecesProgress(row({ stagesTotal: 4, stagesDone: 9 }))!.stagesNote).toBe('4 of 4 stages done')
  })

  it('draws nothing it cannot back: no current stage, no quantity, a server without the fields, a bad number', () => {
    expect(piecesProgress(row({ currentStage: null, currentStageQty: null, currentStageProduced: null, currentStageMadeIsEstimate: null }))).toBeNull()
    expect(piecesProgress(row({ currentStageQty: 0 }))).toBeNull()
    expect(piecesProgress(row({ currentStageQty: undefined, currentStageProduced: undefined, currentStageMadeIsEstimate: undefined }))).toBeNull()
    expect(piecesProgress(row({ currentStageProduced: Number.NaN }))).toBeNull()
    expect(piecesProgress(row({ currentStageProduced: -5 }))).toBeNull()
  })
})

describe('the board uses it, and the bar is neutral', () => {
  it('the Progress cell prefers the pieces and falls back to the stage count (older server, or every stage done)', () => {
    expect(board).toMatch(/piecesProgress\(row\)/)
    expect(board).toMatch(/progressOf\(row\)/)
  })
  it('the fill is the action colour, never a status colour', () => {
    const fill = /\.prog__fill\s*\{[^}]*\}/.exec(styles)?.[0] ?? ''
    expect(fill).toContain('background: var(--accent)')
    expect(fill).not.toMatch(/status/)
  })
})

describe('AUDIT-03 board findings', () => {
  it('PO links on the wide board are at least 24 px tall (a mouse target)', () => {
    expect(boardCss).toMatch(/\.board--wide \.po-link\s*\{[^}]*min-height:\s*24px/)
  })

  // `npm run ux` found this on the first version: at 768 px with touch the board is still the wide layout, and the two-class 24 px rule beat the
  // one-class touch rule (min-height var(--tap-min)), leaving the links 26 px tall. A touch screen gets the touch size back, by specificity.
  it('on a touch screen the wide board\'s PO links keep the touch size (the 24 px rule must not win there)', () => {
    expect(boardCss).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.board--wide \.po-link\s*\{[^}]*min-height:\s*var\(--tap-min\)/)
  })

  it('one toolbar of filters: the buyer choice sits with search, sort, unit and ship week', () => {
    expect(board).toMatch(/\{buyerSelect\}\{searchBox\}\{sortSelect\}\{unitSelect\}\{weekSelect\}/)
    expect(board).toMatch(/<div className="strip boardhead">\{tools\}<\/div>/)
  })

  it('a long buyer name is clamped to two lines with the full name in a tooltip', () => {
    expect(board).toMatch(/<span className="board__buyer" title=\{r\.buyerName\}>/)
    expect(styles).toMatch(/\.board__buyer\s*\{[^}]*-webkit-line-clamp:\s*2/)
    expect(styles).toMatch(/\.board__buyer\s*\{[^}]*overflow:\s*hidden/)
  })

  // The first version called this class "buyer", which the buyer page's own shell already uses (PublicShell className="buyer"): the clamp hit the
  // whole buyer page. `npm run diff` showed the buyer page pictures changing; the class is board-only now and nothing else may be called "buyer" here.
  it('the clamp class is the board\'s own and cannot reach the buyer page', () => {
    expect(styles).not.toMatch(/(^|\n)\.buyer\s*\{/)
    expect(read('../src/pages/Buyer.tsx')).not.toContain('board__buyer')
  })

  it('the buyer select does not widen with the longest name', () => {
    expect(styles).toMatch(/\.strip__buyer\s*\{[^}]*max-width:/)
  })

  it('on the phone card the Status and PO rows carry no label column (the PO row was indented)', () => {
    expect(styles).toMatch(/\.board td\[data-label='Status'\]::before,\s*\.board td\[data-label='PO'\]::before\s*\{\s*display:\s*none/)
  })
})
