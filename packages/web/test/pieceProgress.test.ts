import { describe, expect, it } from 'vitest'
import { barFraction, percentText, ringFraction } from '../src/stages/pieceProgress'

// UI/UX plan, phase 8A (supervisor phone): the ring and the bar are drawn from real counts only.
describe('barFraction', () => {
  it('is pieces done over pieces planned', () => {
    expect(barFraction(1750, 4550)).toBeCloseTo(0.3846, 3)
    expect(barFraction(0, 3000)).toBe(0)
  })
  it('stops at full when more was made than planned (the numbers beside it still show the real count)', () => {
    expect(barFraction(5200, 4550)).toBe(1)
  })
  it('is empty, never NaN, for nothing planned or a bad number', () => {
    expect(barFraction(10, 0)).toBe(0)
    expect(barFraction(Number.NaN, 100)).toBe(0)
    expect(barFraction(-5, 100)).toBe(0)
  })
})

describe('percentText', () => {
  it('rounds down, so a stage is never shown as 100% before it is', () => {
    expect(percentText(1750, 4550)).toBe('38%')
    expect(percentText(4549, 4550)).toBe('99%')
    expect(percentText(4550, 4550)).toBe('100%')
    expect(percentText(6000, 4550)).toBe('100%')
  })
  it('says nothing when nothing is planned', () => {
    expect(percentText(0, 0)).toBe('')
  })
})

describe('ringFraction', () => {
  it('is stages updated over open stages', () => {
    expect(ringFraction(1, 3)).toBeCloseTo(1 / 3, 5)
    expect(ringFraction(3, 3)).toBe(1)
  })
  it('is empty for no stages (the page never draws "0 of 0")', () => {
    expect(ringFraction(0, 0)).toBe(0)
    expect(ringFraction(4, 3)).toBe(1)
  })
})
