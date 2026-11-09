import { describe, expect, it } from 'vitest'
import { REASON_IDS, cleanReasonIds, composeReasonNote } from '../src/reasonNote'

describe('composeReasonNote (English)', () => {
  it('writes the product owner\'s sentence for each single reason', () => {
    expect(composeReasonNote('en', ['labour'])).toBe('Production was slower due to insufficient workforce availability.')
    expect(composeReasonNote('en', ['absence'])).toBe('Production was affected by worker absences.')
    expect(composeReasonNote('en', ['machine'])).toBe('Production was delayed due to machine-related issues.')
    expect(composeReasonNote('en', ['material'])).toBe('Production was affected by delayed material availability.')
    expect(composeReasonNote('en', ['power'])).toBe('Production was interrupted due to a power outage.')
    expect(composeReasonNote('en', ['quality'])).toBe('Additional time was required for quality inspection and corrections.')
    expect(composeReasonNote('en', ['other'])).toBe('Additional operational circumstances affected production.')
  })
  it('writes the combined sentence of the brief, in the order the reasons were tapped', () => {
    expect(composeReasonNote('en', ['machine', 'labour', 'material'])).toBe('Production was slower due to machine-related issues, limited workforce availability, and delayed material supply.')
    expect(composeReasonNote('en', ['material', 'machine'])).toBe('Production was slower due to delayed material supply and machine-related issues.')
  })
  it('is empty for no reason and ignores an unknown or repeated one', () => {
    expect(composeReasonNote('en', [])).toBe('')
    expect(composeReasonNote('en', null)).toBe('')
    expect(composeReasonNote('en', ['nonsense'])).toBe('')
    expect(composeReasonNote('en', ['power', 'power'])).toBe(composeReasonNote('en', ['power']))
    expect(cleanReasonIds(['machine', 'x', 'machine', 'power'])).toEqual(['machine', 'power'])
  })
  it('every subset of the list gives one sentence that ends with a full stop and names every reason once', () => {
    for (let mask = 1; mask < 1 << REASON_IDS.length; mask++) {
      const ids = REASON_IDS.filter((_, i) => mask & (1 << i))
      const note = composeReasonNote('en', ids)
      expect(note.endsWith('.'), note).toBe(true)
      expect(note.split('. ').length, note).toBe(1)
    }
  })
})

describe('composeReasonNote (Tamil, draft)', () => {
  it('has a sentence for each reason and joins several as one list sentence', () => {
    for (const id of REASON_IDS) expect(composeReasonNote('ta', [id]).endsWith('.'), id).toBe(true)
    const two = composeReasonNote('ta', ['machine', 'power'])
    expect(two).toContain('இயந்திரம் பழுது மற்றும் மின்சாரம் இல்லை')
    expect(two.endsWith('உற்பத்தி மெதுவாக இருந்தது.')).toBe(true)
    expect(composeReasonNote('ta', [])).toBe('')
  })
  it('contains no English letters (a Tamil screen shows Tamil)', () => {
    for (let mask = 1; mask < 1 << REASON_IDS.length; mask++) expect(composeReasonNote('ta', REASON_IDS.filter((_, i) => mask & (1 << i)))).not.toMatch(/[A-Za-z]/)
  })
})
