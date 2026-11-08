import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { notWholeNumber, parsePieces } from '../src/dates'
import { stageLabel, strings } from '../src/i18n'

// Final bug cycle (9 Nov 2026), supervisor hunter findings. Each test name starts with its id.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('FE-S-01: every stage name the seed uses has a Tamil label', () => {
  const seed = read('../../server/src/demoSeed.ts')
  const names = [...new Set([...seed.matchAll(/plain\('([A-Za-z ]+)'/g)].map((m) => m[1]!))]
  it('the seed has the brief\'s stages', () => {
    expect(names).toEqual(expect.arrayContaining(['Cutting', 'Stitching', 'Printing', 'Finishing', 'Packing']))
  })
  it.each(names)('FE-S-01: %s is not shown in English on a Tamil screen', (name) => {
    const ta = stageLabel('ta', name)
    expect(ta).not.toBe(name)
    expect(/[஀-௿]/.test(ta)).toBe(true)
    expect(stageLabel('en', name)).toBe(name)
  })
  it('FE-S-01: the Tamil for the new keys is a marked draft and listed for review', () => {
    expect(strings.ta['stage.printing' as keyof typeof strings.ta]).toBeTruthy()
    expect(read('../src/i18n.ts')).toMatch(/'stage\.printing':[^\n]*DRAFT, unreviewed/)
    expect(read('../../../audit/TAMIL-REVIEW.md')).toContain('`stage.printing`')
  })
})

describe('FE-S-02: a supervisor can report 0 pieces for a day', () => {
  it('FE-S-02: 0 is a count of zero when zero is allowed, and 000 too', () => {
    expect(parsePieces('0', 0)).toBe(0)
    expect(parsePieces('000', 0)).toBe(0)
    expect(notWholeNumber('0', 0)).toBe(false)
  })
  it('FE-S-02: the default (the merchandiser\'s visit entry) still needs at least 1', () => {
    expect(parsePieces('0')).toBeNull()
  })
  it('FE-S-02: decimals, negatives and text are still refused, with zero allowed', () => {
    for (const raw of ['0.5', '-0', '-5', 'abc', '1e3', '٣٥٠']) expect(parsePieces(raw, 0), raw).toBeNull()
  })
  it('FE-S-02: the Update screen asks for zero to be allowed', () => {
    const update = read('../src/pages/Update.tsx')
    expect(update).toMatch(/parsePieces\(raw, 0\)/)
    expect(update).toMatch(/notWholeNumber\(raw, 0\)/)
  })
})

describe('FE-S-10: a comma is a thousands separator or a mistake, never a deleted character', () => {
  it.each([['1,250', 1250], ['12,500', 12500], ['1,25,000', 125000], ['10,00,000', 1000000], ['1,000,000', 1000000], [' 1 200 ', 1200], ['007', 7]])('FE-S-10: accepts %j', (raw, n) => {
    expect(parsePieces(raw as string, 0)).toBe(n)
  })
  it.each([['12,5'], ['1,2,3'], ['12,50'], ['1,2500'], [',500'], ['500,'], ['12 5'], ['1,000,0000']])('FE-S-10: refuses %j instead of reading it as a bigger number', (raw) => {
    expect(parsePieces(raw as string, 0)).toBeNull()
    expect(notWholeNumber(raw as string, 0)).toBe(true)
  })
})
