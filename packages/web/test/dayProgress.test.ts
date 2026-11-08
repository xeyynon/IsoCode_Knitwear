import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dayProgress, nextStage, openStages, updatedToday } from '../src/stages/dayProgress'
import { translate } from '../src/i18n'
import type { Stage } from '../src/stages/useStages'

// UI/UX plan, slices 1.8 to 1.10 (supervisor). The product's biggest risk is supervisors stopping, so Today says how many of the day's
// stages have an update (from the real counts: the server's total for today plus anything saved on the phone and not yet sent), and
// after a send the next stage with no update is one tap away (Calley: the next action is the closest one). Nothing is invented.
const stage = (o: string, st: string, extra: Partial<Stage> = {}): Stage => ({
  orderId: o, po: `PO-${o}`, style: 'tee', colour: 'navy', stage: st, sequence: 1, qty: 1000, plannedEnd: '2026-11-11', produced: 0, todayQty: 0, complete: false, ...extra,
})
const none = () => 0

describe('which stages count', () => {
  it('only the open ones: a finished stage is not waiting for an update', () => {
    const list = [stage('a', 'sewing'), stage('b', 'sewing', { complete: true })]
    expect(openStages(list).map((s) => s.orderId)).toEqual(['a'])
  })
  it('a stage is updated today when the server has pieces for today, or some are saved on the phone and not yet sent', () => {
    expect(updatedToday(stage('a', 'sewing'), 0)).toBe(false)
    expect(updatedToday(stage('a', 'sewing', { todayQty: 120 }), 0)).toBe(true)
    expect(updatedToday(stage('a', 'sewing'), 120)).toBe(true)
  })
})

describe('how many are updated today', () => {
  it('counts the open stages that have an update, out of all the open ones', () => {
    const list = [stage('a', 'sewing', { todayQty: 50 }), stage('b', 'sewing'), stage('c', 'sewing'), stage('d', 'sewing', { complete: true, todayQty: 9 })]
    expect(dayProgress(list, none)).toEqual({ updated: 1, total: 3 })
  })
  it('counts a stage whose update is still waiting on the phone', () => {
    const list = [stage('a', 'sewing'), stage('b', 'sewing')]
    expect(dayProgress(list, (s) => (s.orderId === 'b' ? 200 : 0))).toEqual({ updated: 1, total: 2 })
  })
  it('says nothing when there is nothing to update (never "0 of 0")', () => {
    expect(dayProgress([], none)).toBeNull()
    expect(dayProgress([stage('a', 'sewing', { complete: true })], none)).toBeNull()
  })
})

describe('the next stage after a send', () => {
  const list = [stage('a', 'sewing'), stage('b', 'sewing'), stage('c', 'sewing')]
  it('is the next open stage in the list with no update today', () => {
    expect(nextStage(list, { orderId: 'a', stage: 'sewing' }, none)?.orderId).toBe('b')
    expect(nextStage(list, { orderId: 'b', stage: 'sewing' }, none)?.orderId).toBe('c')
  })
  it('skips stages that already have an update, and a finished one', () => {
    const l = [stage('a', 'sewing'), stage('b', 'sewing', { todayQty: 40 }), stage('c', 'sewing', { complete: true }), stage('d', 'sewing')]
    expect(nextStage(l, { orderId: 'a', stage: 'sewing' }, none)?.orderId).toBe('d')
  })
  it('wraps round to the stages before this one', () => {
    expect(nextStage(list, { orderId: 'c', stage: 'sewing' }, none)?.orderId).toBe('a')
  })
  it('is never the stage just sent, and is nothing when every other stage is done for today', () => {
    expect(nextStage([stage('a', 'sewing')], { orderId: 'a', stage: 'sewing' }, none)).toBeNull()
    const l = [stage('a', 'sewing'), stage('b', 'sewing', { todayQty: 1 })]
    expect(nextStage(l, { orderId: 'a', stage: 'sewing' }, none)).toBeNull()
  })
  it('tells two stages of one order apart', () => {
    const l = [stage('a', 'cutting'), stage('a', 'sewing')]
    expect(nextStage(l, { orderId: 'a', stage: 'cutting' }, none)?.stage).toBe('sewing')
  })
})

describe('the words (draft Tamil, unreviewed: see audit/TAMIL-REVIEW.md)', () => {
  it('each new key has English and Tamil, with the same placeholders', () => {
    for (const [key, vars] of [['today.progress', { n: 2, m: 3 }], ['today.countsFor', { date: '4 Nov' }], ['update.next', { po: 'B-PO-1', stage: 'Sewing' }]] as const) {
      const en = translate('en', key, vars), ta = translate('ta', key, vars)
      expect(en, key).not.toContain('{')
      expect(ta, key).not.toContain('{')
      for (const v of Object.values(vars)) { expect(en, key).toContain(String(v)); expect(ta, key).toContain(String(v)) }
      expect(ta, key).not.toBe(en)   // Tamil is written, not an English fallback
    }
  })
})

describe('the screens use them', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const today = read('../src/pages/Today.tsx')
  const update = read('../src/pages/Update.tsx')
  it("Today shows the day's progress and the date the counts go to", () => {
    expect(today).toContain('dayProgress(')
    expect(today).toContain("t('today.progress'")
    expect(today).toContain("t('today.countsFor'")
  })
  it('Update offers the next stage once something has been saved, as a link inside the bottom bar', () => {
    expect(update).toContain('nextStage(')
    const bar = update.slice(update.indexOf('<ActionBar>'), update.indexOf('</ActionBar>'))
    expect(bar).toContain("t('update.next'")
    expect(bar).toMatch(/<ButtonLink block to=/)   // a link drawn as a full-width button (atoms.test.tsx: `btn btn--block`)
  })
  it('Update is keyed by the stage it shows, so moving to the next stage starts a fresh form and never carries the old "Saved" line', () => {
    expect(update).toMatch(/key=\{`\$\{orderId\}\/\$\{stage\}`\}/)
  })
})
