// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { StatusTiles, type Tile } from '../src/ui/organisms/StatusTiles'

// UI/UX 2.0 phase 8B. The tiles are the status filter: pressable, the same numbers as before, and a status is always an icon, a word and a colour.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = read('../src/ui/organisms/StatusTiles.css').replace(/\/\*[\s\S]*?\*\//g, '')

const tiles = (onPress = vi.fn()): Tile[] => [
  { key: 'all', label: 'All', count: 6, note: '920 pcs short in total', pressed: true, onPress },
  { key: 'red', label: 'Late risk', count: 1, note: '700 pcs short', pressed: false, onPress },
  { key: 'amber', label: 'At risk', count: 1, note: '220 pcs short', pressed: false, onPress },
  { key: 'grey', label: 'No update', count: 2, pressed: false, onPress },
  { key: 'green', label: 'On track', count: 2, pressed: false, onPress },
]

describe('StatusTiles', () => {
  it('draws one pressable tile for each choice, with its word, its number and its note', () => {
    const { container } = render(<StatusTiles tiles={tiles()} label="Filter by status" />)
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons).toHaveLength(5)
    expect(buttons[1]!.textContent).toContain('Late risk')
    expect(buttons[1]!.textContent).toContain('1')
    expect(buttons[1]!.textContent).toContain('700 pcs short')
    expect(container.querySelector('[role=group]')!.getAttribute('aria-label')).toBe('Filter by status')
  })
  it('says which tile is on with aria-pressed, and presses the one that was clicked', () => {
    const onPress = vi.fn()
    const { container } = render(<StatusTiles tiles={tiles(onPress)} label="x" />)
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(buttons[2]!.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(buttons[2]!)
    expect(onPress).toHaveBeenCalledTimes(1)
  })
  it('a status tile carries the status icon beside the word (never colour alone); the All tile has none', () => {
    const { container } = render(<StatusTiles tiles={tiles()} label="x" />)
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons[0]!.querySelector('svg')).toBeNull()
    for (const b of buttons.slice(1)) expect(b.querySelector('svg'), b.textContent ?? '').not.toBeNull()
  })
  it('draws no note line when there is no real number to put in it', () => {
    const { container } = render(<StatusTiles tiles={tiles()} label="x" />)
    expect(container.querySelectorAll('button')[3]!.querySelector('.statustile__note')).toBeNull()
  })
})

describe('StatusTiles.css', () => {
  it('uses the status tokens for tints and words, and tokens only otherwise', () => {
    expect(css).toMatch(/--status-red-tint/)
    expect(css).toMatch(/--status-amber-tint/)
    expect(css).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/)
  })
  it('marks the pressed tile with more than colour (a heavier ink ring)', () => {
    expect(css).toMatch(/aria-pressed='true'\][^{]*\{[^}]*(outline|border)[^}]*var\(--ink\)/)
  })
  it('keeps grey a grey: the no-update tile never takes the green token', () => {
    const grey = /statustile--grey[^{]*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(grey).not.toMatch(/green/)
  })
  it('is at least the touch size tall', () => {
    expect(css).toMatch(/min-height:\s*max\(var\(--tap-min\)/)
  })
})
