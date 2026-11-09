import { describe, expect, it } from 'vitest'
import { composeReasonNote, REASON_IDS } from '@isocode/engine/reasonNote'
import { DEFAULT_REASONS, MAX_NOTE, noteToSend, toggleReasons } from '../src/notes/reasons'

describe('toggleReasons: several reasons, in the order tapped', () => {
  it('adds a tapped reason at the end', () => expect(toggleReasons(['machine'], 'labour')).toEqual(['machine', 'labour']))
  it('taps the same one again to remove it, and nothing else changes', () => {
    expect(toggleReasons(['machine', 'labour', 'power'], 'labour')).toEqual(['machine', 'power'])
    expect(toggleReasons(['power'], 'power')).toEqual([])
  })
  it('never resets the others and never holds one twice', () => {
    let s: string[] = []
    for (const id of ['machine', 'labour', 'material']) s = toggleReasons(s, id)
    expect(s).toEqual(['machine', 'labour', 'material'])
  })
  it("keeps the default list and the engine's ids the same seven", () => expect(DEFAULT_REASONS.map((r) => r.id)).toEqual([...REASON_IDS]))
})

describe('noteToSend with several reasons', () => {
  it('sends the first tapped as the main reason, with all of them in order', () => {
    expect(noteToSend('', ['machine', 'labour'])).toEqual({ category: 'machine', categories: ['machine', 'labour'] })
    expect(noteToSend('Needle bar broke', ['machine'])).toEqual({ text: 'Needle bar broke', category: 'machine', categories: ['machine'] })
  })
  it('sends only words when there is no reason, and nothing when there is neither', () => {
    expect(noteToSend('late fabric', [])).toEqual({ text: 'late fabric' })
    expect(noteToSend('  ', [])).toBeUndefined()
  })
})

describe('the note box always fits what the reasons write', () => {
  it('the longest sentence, in either language, is within half the cap, so there is room to add more', () => {
    for (const lang of ['en', 'ta'] as const) {
      let longest = 0
      for (let mask = 1; mask < 1 << REASON_IDS.length; mask++) {
        longest = Math.max(longest, composeReasonNote(lang, REASON_IDS.filter((_, k) => mask & (1 << k))).length)
      }
      expect(longest, lang).toBeLessThanOrEqual(MAX_NOTE / 2)
    }
  })
})
