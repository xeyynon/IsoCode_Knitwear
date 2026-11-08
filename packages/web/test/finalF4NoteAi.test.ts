import { describe, expect, it } from 'vitest'
import { aiLine, type NoteForAi } from '../src/review/noteAiLogic'
import { DEFAULT_REASONS } from '../src/notes/reasons'

const note = (over: Partial<NoteForAi> = {}): NoteForAi => ({ language: 'ta', original: 'இரண்டு மெஷின் பழுது', category: null, categoryBy: null, ai: null, ...over })

describe('W-3: the AI line never waits for ever', () => {
  it('W-3: still says it is asking while the page is still trying', () => {
    expect(aiLine(note(), DEFAULT_REASONS, true)).toMatchObject({ kind: 'waiting' })
    expect(aiLine(note(), DEFAULT_REASONS, true, { gaveUp: false })).toMatchObject({ kind: 'waiting' })
  })
  it('W-3: once the page has given up it says so in plain words and offers to ask again', () => {
    expect(aiLine(note(), DEFAULT_REASONS, true, { gaveUp: true })).toEqual({
      kind: 'failed', detail: null,
      text: 'No suggestion: the AI service could not be reached. Choose the reason yourself, or ask again.',
    })
  })
  it('W-3: the server\'s own plain message is shown as it is', () => {
    const msg = 'The AI has been used as much as it can be today. Please write the English yourself, or try again tomorrow.'
    expect(aiLine(note(), DEFAULT_REASONS, true, { gaveUp: true, message: msg })).toEqual({ kind: 'failed', text: msg, detail: null })
  })
  it('W-3: AI switched off is still the off line, given up or not', () => {
    expect(aiLine(note(), DEFAULT_REASONS, false, { gaveUp: true })).toMatchObject({ kind: 'off' })
  })
})
