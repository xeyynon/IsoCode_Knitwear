import { describe, expect, it } from 'vitest'
import { aiLine, defaultMeaning, defaultReason, disagreement, reasonSource, waitingForAi, type NoteForAi, type NoteSuggestion } from '../src/review/noteAiLogic'
import { DEFAULT_REASONS } from '../src/notes/reasons'

const ai = (over: Partial<NoteSuggestion> = {}): NoteSuggestion => ({ status: 'suggested', textEn: 'Two ironing machines are broken.', category: 'machine', confidence: 0.92, why: 'Mentions machines.', model: 'claude-opus-5-5', error: null, attempts: 1, at: '2026-11-06T05:00:00Z', ...over })
const note = (over: Partial<NoteForAi> = {}): NoteForAi => ({ language: 'ta', original: 'இரண்டு அயர்னிங் மெஷின் பழுது', category: null, categoryBy: null, ai: null, ...over })

describe('the AI suggestion on a note in the review queue', () => {
  it('asks only about notes with words and no answer yet, or a failure that may be tried again', () => {
    expect(waitingForAi(note())).toBe(true)
    expect(waitingForAi(note({ original: null }))).toBe(false)
    expect(waitingForAi(note({ ai: ai() }))).toBe(false)
    expect(waitingForAi(note({ ai: ai({ status: 'failed', attempts: 1 }) }))).toBe(true)
    expect(waitingForAi(note({ ai: ai({ status: 'failed', attempts: 3 }) }))).toBe(false)
  })

  it('says plainly what state it is in, with the confidence as a percentage', () => {
    expect(aiLine(note({ ai: ai() }), DEFAULT_REASONS, true)).toMatchObject({ kind: 'suggested', text: 'AI suggests "Machine problem" (92% sure).' })
    expect(aiLine(note({ ai: ai({ status: 'unsure', confidence: 0.3, category: 'other' }) }), DEFAULT_REASONS, true)!.text).toMatch(/not sure \(30%\).*"Something else"/)
    expect(aiLine(note({ ai: ai({ status: 'unsure', category: null }) }), DEFAULT_REASONS, true)!.text).toMatch(/could not match/)
    expect(aiLine(note({ ai: ai({ status: 'failed', error: 'timeout' }) }), DEFAULT_REASONS, true)!.text).toMatch(/took too long.*ask again/)
    expect(aiLine(note(), DEFAULT_REASONS, true)).toMatchObject({ kind: 'waiting' })
    expect(aiLine(note(), DEFAULT_REASONS, false)).toMatchObject({ kind: 'off' })
    expect(aiLine(note({ original: null }), DEFAULT_REASONS, true)).toBeNull()
  })

  it('pre-selects the reason in this order: the merchandiser, the supervisor, a SURE suggestion; never an unsure or failed one', () => {
    expect(defaultReason(note({ ai: ai() }), undefined)).toBe('machine')
    expect(defaultReason(note({ ai: ai({ status: 'unsure' }) }), undefined)).toBe('')
    expect(defaultReason(note({ ai: ai({ status: 'failed' }) }), undefined)).toBe('')
    expect(defaultReason(note({ category: 'power', categoryBy: 'supervisor', ai: ai() }), undefined)).toBe('power')
    expect(defaultReason(note({ category: 'power', categoryBy: 'supervisor', ai: ai() }), 'labour')).toBe('labour')
  })

  it('says where the pre-selected reason came from', () => {
    expect(reasonSource(note({ ai: ai() }), undefined)).toMatch(/suggested by AI/)
    expect(reasonSource(note({ category: 'power', categoryBy: 'supervisor' }), undefined)).toMatch(/supervisor/)
    expect(reasonSource(note({ ai: ai() }), 'labour')).toBe('')
  })

  it('starts the English box with the AI draft for a Tamil note, and keeps what the person typed', () => {
    expect(defaultMeaning(note({ ai: ai() }), undefined)).toBe('Two ironing machines are broken.')
    expect(defaultMeaning(note({ ai: ai({ status: 'unsure' }) }), undefined)).toBe('Two ironing machines are broken.')
    expect(defaultMeaning(note({ ai: ai({ status: 'failed' }) }), undefined)).toBe('')
    expect(defaultMeaning(note({ ai: ai() }), '')).toBe('')
    expect(defaultMeaning(note({ language: 'en', ai: ai() }), undefined)).toBe('')
  })

  it('flags a supervisor tap that the AI reads differently, so a person looks', () => {
    expect(disagreement(note({ category: 'power', categoryBy: 'supervisor', ai: ai() }), DEFAULT_REASONS)).toBe('The supervisor chose "No power", but the AI reads the note as "Machine problem".')
    expect(disagreement(note({ category: 'machine', categoryBy: 'supervisor', ai: ai() }), DEFAULT_REASONS)).toBeNull()
    expect(disagreement(note({ ai: ai() }), DEFAULT_REASONS)).toBeNull()
  })
})
