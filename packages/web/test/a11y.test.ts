import { describe, expect, it } from 'vitest'
import { toggleReasons } from '../src/notes/reasons'

// The reason picker takes one reason or several (the form review, 10 Nov 2026). Each chip is a checkbox: a tap switches only that reason,
// and the reasons are kept in the order they were tapped. (More cases: reasonsMulti.test.ts and reasonChips.test.tsx.)
describe('the reason picker toggles in one tap', () => {
  it('picks a reason when none is chosen', () => expect(toggleReasons([], 'power')).toEqual(['power']))
  it('clears the reason when the same one is tapped again', () => expect(toggleReasons(['power'], 'power')).toEqual([]))
  it('adds another reason beside the first instead of replacing it', () => expect(toggleReasons(['power'], 'labour')).toEqual(['power', 'labour']))
})
