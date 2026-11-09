import { describe, expect, it } from 'vitest'
import { composeReasonNote } from '@isocode/engine'
import { aiLine, defaultMeaning, disagreement, waitingForAi, type NoteForAi, type NoteSuggestion } from '../src/review/noteAiLogic'
import { GENERATED_CAPTION, generatedMeaning, hasSeveral, isGenerated, reasonFieldLabel, reasonsOf, reasonsShown, showsReasonList } from '../src/review/noteReasons'

// The form review: a supervisor can tap several reasons, and the note is written from them. These are the rules for how the Review queue treats such a note.
const REASONS = [
  { id: 'labour', en: 'Not enough workers', ta: 'x' }, { id: 'absence', en: 'Workers on leave', ta: 'x' }, { id: 'machine', en: 'Machine problem', ta: 'x' },
  { id: 'material', en: 'Material is late', ta: 'x' }, { id: 'power', en: 'No power', ta: 'x' }, { id: 'quality', en: 'Fixing quality', ta: 'x' }, { id: 'other', en: 'Something else', ta: 'x' },
]
const ai = (over: Partial<NoteSuggestion> = {}): NoteSuggestion => ({ status: 'unsure', textEn: 'draft', category: 'labour', confidence: 0.4, why: null, model: 'm', error: null, attempts: 1, at: null, ...over })
const note = (over: Partial<NoteForAi & { textEn: string | null }> = {}): NoteForAi & { textEn?: string | null } => ({ language: 'ta', original: 'தமிழ்', category: null, categoryBy: null, ai: null, ...over })

describe('REV-01: which reasons a note has', () => {
  it('a new note carries them in the order they were tapped; the first is the main one', () => {
    const n = note({ category: 'machine', categories: ['machine', 'labour', 'material'] })
    expect(reasonsOf(n)).toEqual(['machine', 'labour', 'material'])
    expect(hasSeveral(n)).toBe(true)
    expect(showsReasonList(n)).toBe(true)
  })
  it('an old note without the field has its single category, and shows no list (it renders as it always did)', () => {
    const old = note({ category: 'power' })
    expect(reasonsOf(old)).toEqual(['power'])
    expect(showsReasonList(old)).toBe(false)
    expect(hasSeveral(old)).toBe(false)
    expect(reasonsOf(note())).toEqual([])
  })
  it('an empty list falls back to the single category', () => {
    expect(reasonsOf(note({ category: 'power', categories: [] }))).toEqual(['power'])
    expect(showsReasonList(note({ category: 'power', categories: [] }))).toBe(false)
  })
})

describe('REV-02: changing the main reason never loses the others', () => {
  const n = note({ category: 'machine', categories: ['machine', 'labour', 'material'] })
  it('with nothing picked, the order is the supervisors', () => expect(reasonsShown(n, undefined)).toEqual(['machine', 'labour', 'material']))
  it('a picked reason from the list moves to the front; the rest keep their order', () => expect(reasonsShown(n, 'material')).toEqual(['material', 'machine', 'labour']))
  it('a picked reason that was not among them is added in front', () => expect(reasonsShown(n, 'power')).toEqual(['power', 'machine', 'labour', 'material']))
  it('picking the same main reason changes nothing', () => expect(reasonsShown(n, 'machine')).toEqual(['machine', 'labour', 'material']))
  it('says "Main reason" in the label only when there are several', () => {
    expect(reasonFieldLabel(n)).toBe('Main reason')
    expect(reasonFieldLabel(note({ category: 'machine' }))).toBe('Reason')
    expect(reasonFieldLabel(note({ category: 'machine', categories: ['machine'] }))).toBe('Reason')
  })
})

describe('REV-03: a note written from the supervisors choices needs no AI', () => {
  const gen = note({ category: 'machine', categories: ['machine', 'labour'], generated: true, original: composeReasonNote('ta', ['machine', 'labour']) })
  it('is generated only when the server says so and there is a reason', () => {
    expect(isGenerated(gen)).toBe(true)
    expect(isGenerated(note({ generated: true }))).toBe(false)
    expect(isGenerated(note({ category: 'machine', categories: ['machine'] }))).toBe(false)
  })
  it('is never asked about, and shows no AI line (no "Asking AI", no "not sure")', () => {
    expect(waitingForAi(gen)).toBe(false)
    expect(aiLine(gen, REASONS, true)).toBeNull()
    expect(aiLine(gen, REASONS, false)).toBeNull()
  })
  it('an edited or typed note keeps todays flow: it is asked about, and "not sure" shows', () => {
    const edited = note({ category: 'machine', categories: ['machine'], generated: false, ai: ai() })
    expect(waitingForAi(note({ categories: ['machine'], generated: false }))).toBe(true)
    expect(aiLine(edited, REASONS, true)?.text).toContain('AI is not sure (40%)')
  })
  it('the English meaning starts as the composed English sentence (not an AI draft)', () => {
    expect(defaultMeaning(gen, undefined)).toBe(composeReasonNote('en', ['machine', 'labour']))
    expect(defaultMeaning(gen, undefined)).toBe('Production was slower due to machine-related issues and limited workforce availability.')
    expect(generatedMeaning(gen)).toBe(composeReasonNote('en', ['machine', 'labour']))
    expect(defaultMeaning(gen, 'typed')).toBe('typed')
  })
  it('uses the servers English when it sends one', () => expect(generatedMeaning({ ...gen, textEn: 'From the server.' })).toBe('From the server.'))
  it('says quietly where the text came from', () => expect(GENERATED_CAPTION).toBe("Written from the supervisor's choices"))
})

describe('REV-04: the AI and the supervisor only "disagree" when the AIs reason is none of theirs', () => {
  const edited = (aiCat: string) => note({ category: 'machine', categoryBy: 'supervisor', categories: ['machine', 'labour'], ai: ai({ status: 'suggested', category: aiCat, confidence: 0.9 }) })
  it('the AI picks a reason the supervisor also tapped: no clash', () => expect(disagreement(edited('labour'), REASONS)).toBeNull())
  it('the AI picks one they did not tap: a person should look', () => expect(disagreement(edited('power'), REASONS)).toContain('"No power"'))
})
