import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// The board polls every minute. A live region that holds the "Updated hh:mm:ss" time is read out
// on every poll; only a failed refresh should be announced (Status.tsx keeps to the same rule).
const src = readFileSync(new URL('../src/pages/Board.tsx', import.meta.url), 'utf8')
// The JSX of every element marked role="status" or aria-live, from its opening tag to its matching close.
const liveRegions = [...src.matchAll(/<(\w+)\b[^>]*(?:role="status"|aria-live=)[^>]*>/g)].map((m) => {
  const tag = m[1]!
  const open = new RegExp(`<${tag}\\b[^>]*[^/]>|</${tag}>`, 'g')
  open.lastIndex = m.index! + m[0].length
  let depth = 1, end = src.length
  for (let t = open.exec(src); t; t = open.exec(src)) {
    depth += t[0].startsWith('</') ? -1 : 1
    if (!depth) { end = t.index + t[0].length; break }
  }
  return src.slice(m.index!, end)
})

describe('board live region', () => {
  it('announces a failed refresh', () => {
    expect(liveRegions.some((r) => r.includes('Could not refresh'))).toBe(true)
  })
  it('does not announce the time of every poll', () => {
    for (const r of liveRegions) expect(r).not.toContain('Updated ')
  })
  it('keeps the Try again button out of the live region', () => {
    for (const r of liveRegions) expect(r).not.toContain('<button')
  })
})
