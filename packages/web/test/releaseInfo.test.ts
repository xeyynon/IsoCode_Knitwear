import { describe, expect, it } from 'vitest'
import { buildLabel, formatBuildDate, recentBuilds, type BuildInfo } from '../src/release/releaseInfo'
import { publicBuilds, KEEP_BUILDS } from '../../../scripts/buildInfo.mjs'
import shipped from '../../../build-info.json'

const entry = (n: number, over: Partial<BuildInfo['builds'][number]> = {}) => ({ n, date: '2026-11-03', title: `Title ${n}`, summary: `Summary ${n}`, ...over })

describe('formatBuildDate', () => {
  it('writes day, short month and year without a leading zero, whatever the time zone of the phone', () => {
    expect(formatBuildDate('2026-11-03')).toBe('3 Nov 2026')
    expect(formatBuildDate('2027-01-31')).toBe('31 Jan 2027')
    expect(formatBuildDate('2026-12-09')).toBe('9 Dec 2026')
  })
  it('gives an empty string, never "Invalid Date", for anything that is not a real calendar day', () => {
    for (const bad of ['', 'soon', '2026-13-01', '2026-02-30', '2026-11-3', '03/11/2026']) expect(formatBuildDate(bad), bad).toBe('')
  })
})

describe('buildLabel', () => {
  it('is the latest build and its date', () => {
    expect(buildLabel({ latest: 1006, builds: [entry(1006), entry(1005, { date: '2026-10-01' })] })).toBe('Build 1006 - 3 Nov 2026')
  })
  it('finds the latest by number, not by position', () => {
    expect(buildLabel({ latest: 1005, builds: [entry(1006), entry(1005, { date: '2026-10-01' })] })).toBe('Build 1005 - 1 Oct 2026')
  })
  it('drops the date when the entry has none or is missing, and shows nothing when there is no build', () => {
    expect(buildLabel({ latest: 1006, builds: [entry(1006, { date: '' })] })).toBe('Build 1006')
    expect(buildLabel({ latest: 1006, builds: [] })).toBe('Build 1006')
    expect(buildLabel({ latest: null, builds: [] })).toBeNull()
  })
})

describe('recentBuilds', () => {
  it('lists the newest three, newest first, however the file is ordered', () => {
    const info = { latest: 1004, builds: [entry(1001), entry(1004), entry(1002), entry(1003)] }
    expect(recentBuilds(info).map((b) => b.n)).toEqual([1004, 1003, 1002])
    expect(recentBuilds(info, 2).map((b) => b.n)).toEqual([1004, 1003])
  })
  it('skips an entry with no title and an empty list is fine', () => {
    expect(recentBuilds({ latest: 2, builds: [entry(2, { title: ' ' }), entry(1)] }).map((b) => b.n)).toEqual([1])
    expect(recentBuilds({ latest: null, builds: [] })).toEqual([])
  })
})

describe('the shipped build-info.json', () => {
  it('has a label and something to show in "What is new"', () => {
    const info = shipped as BuildInfo
    expect(buildLabel(info)).toMatch(/^Build \d+( - \d{1,2} [A-Z][a-z]{2} \d{4})?$/)
    expect(recentBuilds(info).length).toBeGreaterThan(0)
    expect(info.builds.length).toBeLessThanOrEqual(KEEP_BUILDS)
  })
})

describe('publicBuilds (what scripts/changelog.mjs writes to build-info.json)', () => {
  const report = (n: number, summary: string) => ({ n, date: '2026-11-03', title: `T${n}`, summary, why: 'private reasons' })

  it('keeps the whole "What changed" paragraph, not a cut of it', () => {
    const long = 'A sentence that goes on. '.repeat(40).trim()
    expect(long.length).toBeGreaterThan(240)
    expect(publicBuilds([report(1001, long)])[0]?.summary).toBe(long)
  })
  it('keeps only the last ten builds, newest first, and only the public fields', () => {
    const reports = Array.from({ length: 14 }, (_, i) => report(1000 + i, 'x'))
    const out = publicBuilds(reports)
    expect(out).toHaveLength(10)
    expect(out.map((b) => b.n)).toEqual([1013, 1012, 1011, 1010, 1009, 1008, 1007, 1006, 1005, 1004])
    expect(Object.keys(out[0]!).sort()).toEqual(['date', 'n', 'summary', 'title'])
  })
})
