import { describe, expect, it } from 'vitest'
import { composeReasonNote } from '@isocode/engine/reasonNote'
import { canRewrite, initialDraft, isGenerated, needsDetail, onEdit, onSelect, rewrite } from '../src/notes/noteDraft'

// The form review (10 Nov 2026): the note writes itself from the reasons, stays editable, and is never overwritten after a person has typed in it.
const en = (ids: string[]) => composeReasonNote('en', ids)

describe('the note follows the selection until a person edits it', () => {
  it('starts empty', () => expect(initialDraft()).toEqual({ text: '', edited: false }))
  it('fills in when a reason is tapped, and changes when the selection changes', () => {
    let d = onSelect(initialDraft(), ['machine'], 'en')
    expect(d).toEqual({ text: en(['machine']), edited: false })
    d = onSelect(d, ['machine', 'labour'], 'en')
    expect(d.text).toBe(en(['machine', 'labour']))
    expect(d.edited).toBe(false)
  })
  it('goes back to empty when the last reason is untapped', () => {
    const d = onSelect(onSelect(initialDraft(), ['power'], 'en'), [], 'en')
    expect(d).toEqual({ text: '', edited: false })
  })
  it('uses the language it is given (Tamil for a Tamil phone)', () => {
    expect(onSelect(initialDraft(), ['power'], 'ta').text).toBe(composeReasonNote('ta', ['power']))
    expect(onSelect(initialDraft(), ['power'], 'ta').text).not.toBe(en(['power']))
  })
})

describe('a person\'s own words are never overwritten', () => {
  const typed = onEdit(onSelect(initialDraft(), ['machine'], 'en'), `${en(['machine'])} The needle bar broke at 11.`, ['machine'], 'en')
  it('the first edit marks the note as edited', () => expect(typed.edited).toBe(true))
  it('a later selection change keeps the edited text exactly', () => {
    expect(onSelect(typed, ['machine', 'power'], 'en')).toEqual(typed)
    expect(onSelect(typed, [], 'en')).toEqual(typed)
  })
  it('text typed with no reason selected is the person\'s own', () => {
    const d = onEdit(initialDraft(), 'late fabric', [], 'en')
    expect(d).toEqual({ text: 'late fabric', edited: true })
    expect(onSelect(d, ['material'], 'en')).toEqual(d)
  })
  it('putting the generated sentence back by hand makes it generated again', () => {
    const d = onEdit(typed, en(['machine']), ['machine'], 'en')
    expect(d.edited).toBe(false)
    expect(isGenerated(d, ['machine'], 'en')).toBe(true)
  })
  it('clearing the box leaves it empty (never refilled while typing) and follows the selection again from the next tap', () => {
    const cleared = onEdit(typed, '', ['machine'], 'en')
    expect(cleared).toEqual({ text: '', edited: false })
    expect(onSelect(cleared, ['machine', 'labour'], 'en').text).toBe(en(['machine', 'labour']))
  })
})

describe('"Rewrite from my choices" works on request only', () => {
  const typed = onEdit(onSelect(initialDraft(), ['machine'], 'en'), 'My own words', ['machine'], 'en')
  it('is offered when the text differs from what the choices would write', () => {
    expect(canRewrite(typed, ['machine'], 'en')).toBe(true)
    expect(canRewrite(typed, [], 'en')).toBe(false)               // nothing to write from
    expect(canRewrite(onSelect(initialDraft(), ['machine'], 'en'), ['machine'], 'en')).toBe(false)   // already what they write
  })
  it('replaces the text with the choices, and the note follows the selection again', () => {
    const d = rewrite(typed, ['machine', 'power'], 'en')
    expect(d).toEqual({ text: en(['machine', 'power']), edited: false })
  })
  it('does nothing without a reason (the person\'s words stay)', () => expect(rewrite(typed, [], 'en')).toEqual(typed))
})

describe('"Something else" asks for a few words, without blocking', () => {
  it('is wanted while "Something else" is chosen and the note is still only the generated sentence', () => {
    const d = onSelect(initialDraft(), ['other'], 'en')
    expect(needsDetail(['other'], d, 'en')).toBe(true)
    expect(needsDetail(['machine', 'other'], onSelect(initialDraft(), ['machine', 'other'], 'en'), 'en')).toBe(true)
  })
  it('stops once the person wrote anything of their own, and is not wanted for other reasons', () => {
    const d = onEdit(onSelect(initialDraft(), ['other'], 'en'), 'A visitor stopped the line', ['other'], 'en')
    expect(needsDetail(['other'], d, 'en')).toBe(false)
    expect(needsDetail(['machine'], onSelect(initialDraft(), ['machine'], 'en'), 'en')).toBe(false)
    expect(needsDetail([], initialDraft(), 'en')).toBe(false)
  })
})
