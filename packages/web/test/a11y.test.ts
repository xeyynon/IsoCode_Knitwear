import { describe, expect, it } from 'vitest'
import { toggleReason } from '../src/notes/reasons'

// The reason picker is a real radio group. A radio that is already on does not fire "change" when it is
// tapped again, so the tap handler decides: the same reason clears it, another reason replaces it.
describe('the reason picker toggles in one tap', () => {
  it('picks a reason when none is chosen', () => expect(toggleReason(null, 'power')).toBe('power'))
  it('clears the reason when the same one is tapped again', () => expect(toggleReason('power', 'power')).toBeNull())
  it('replaces the reason when another is tapped', () => expect(toggleReason('power', 'labour')).toBe('labour'))
})
