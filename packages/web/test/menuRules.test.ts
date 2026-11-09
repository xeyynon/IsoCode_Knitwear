import { describe, expect, it } from 'vitest'
import { nextMenuIndex } from '../src/ui/menuRules'

// The top bar (ORCA guide, section 7): where focus goes after a key in a menu, wrapping at both ends. Pure, so it is a table.
describe('nextMenuIndex', () => {
  it.each([
    // current, count, key, expected
    [-1, 4, 'ArrowDown', 0],
    [0, 4, 'ArrowDown', 1],
    [3, 4, 'ArrowDown', 0], // wraps to the top
    [-1, 4, 'ArrowUp', 3], // from nowhere, up goes to the last
    [2, 4, 'ArrowUp', 1],
    [0, 4, 'ArrowUp', 3], // wraps to the bottom
    [2, 4, 'Home', 0],
    [1, 4, 'End', 3],
    [1, 1, 'ArrowDown', 0], // one item: it stays
    [0, 1, 'ArrowUp', 0],
  ])('from %i of %i, %s goes to %i', (current, count, key, expected) => {
    expect(nextMenuIndex(current, count, key)).toBe(expected)
  })
  it('says nothing for a key a menu does not use, and for an empty menu', () => {
    expect(nextMenuIndex(0, 4, 'a')).toBeNull()
    expect(nextMenuIndex(0, 4, 'Enter')).toBeNull()
    expect(nextMenuIndex(0, 0, 'ArrowDown')).toBeNull()
  })
})
