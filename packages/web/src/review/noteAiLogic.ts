// What the review queue shows about the AI's suggestion for a note, and what it pre-fills. Pure, so it is tested without a page.
// The rule from the brief: the original sits beside the translation, the merchandiser can change the reason, and nothing is
// pre-chosen for them when the AI is unsure, failed or is switched off.
import { reasonById, type Reason } from '../notes/reasons'

export interface NoteSuggestion {
  status: 'suggested' | 'unsure' | 'failed'
  textEn: string | null
  category: string | null
  confidence: number | null
  why: string | null
  model: string | null
  error: string | null
  attempts: number
  at: string | null
}

export interface NoteForAi {
  language: 'ta' | 'en' | null
  original: string | null
  category: string | null
  categoryBy: string | null
  ai: NoteSuggestion | null
}

export const MAX_AI_ATTEMPTS = 3

/** The page asks in rounds, at most this many a visit, and rests this long after a round that asked nothing (the server pauses a busy batch for a minute). */
export const MAX_AI_ROUNDS = 6
export const AI_REST_MS = 60_000

/** Notes the page should still ask the server about: words to read and no answer yet (or a failure that may be tried again). */
export const waitingForAi = (n: NoteForAi): boolean =>
  !!n.original && (n.ai === null || (n.ai.status === 'failed' && n.ai.attempts < MAX_AI_ATTEMPTS))

const pct = (c: number | null): string => `${Math.round((c ?? 0) * 100)}%`

const FAILURES: Record<string, string> = {
  timeout: 'the AI service took too long to answer',
  rate_limited: 'the AI service is busy',
  refused: 'the AI declined to read this note',
  bad_answer: 'the AI gave an answer that could not be read',
  auth: 'the AI service key is not accepted',
  unreachable: 'the AI service could not be reached',
}

export type AiLine =
  | { kind: 'off'; text: string }
  | { kind: 'waiting'; text: string }
  | { kind: 'suggested' | 'unsure' | 'failed'; text: string; detail: string | null }

/**
 * One plain sentence for the suggestion's state, and a second line with the AI's own reason when there is one. `gaveUp` is the page saying it has stopped asking
 * (the call failed or the rounds ran out), so a note with no answer is not shown as "Asking" for ever; `message` is the server's own sentence when it refused (busy, asked enough).
 */
export function aiLine(n: NoteForAi, reasons: Reason[], aiEnabled: boolean, state: { gaveUp?: boolean; message?: string | null } = {}): AiLine | null {
  if (!n.original) return null
  if (!n.ai) {
    if (!aiEnabled) return { kind: 'off', text: 'AI suggestions are off on this server. Read the note and choose the reason yourself.' }
    if (state.message) return { kind: 'failed', text: state.message, detail: null }
    if (state.gaveUp) return { kind: 'failed', text: `No suggestion: ${FAILURES.unreachable}. Choose the reason yourself, or ask again.`, detail: null }
    return { kind: 'waiting', text: 'Asking AI for a suggestion…' }
  }
  const a = n.ai
  const label = a.category ? reasonById(reasons, a.category)?.en ?? a.category : null
  if (a.status === 'failed') {
    const why = FAILURES[a.error ?? ''] ?? 'the AI service had a problem'
    return { kind: 'failed', text: `No suggestion: ${why}. Choose the reason yourself, or ask again.`, detail: null }
  }
  if (a.status === 'unsure') {
    return {
      kind: 'unsure',
      text: label ? `AI is not sure (${pct(a.confidence)}). It might be "${label}". Please check the reason yourself.` : 'AI could not match this note to a reason on the list. Please choose the reason yourself.',
      detail: a.why,
    }
  }
  return { kind: 'suggested', text: `AI suggests "${label}" (${pct(a.confidence)} sure).`, detail: a.why }
}

/** Where the reason in the picker came from, said beside its label. */
export function reasonSource(n: NoteForAi, picked: string | undefined): string {
  if (picked) return ''
  if (n.category) return n.categoryBy === 'supervisor' ? ' (chosen by the supervisor)' : ''
  if (n.ai?.status === 'suggested' && n.ai.category) return ' (suggested by AI, check it)'
  return ''
}

/** The reason pre-selected: the merchandiser's own pick, then the supervisor's tap, then a SURE AI suggestion. Never an unsure one. */
export function defaultReason(n: NoteForAi, picked: string | undefined): string {
  return picked ?? n.category ?? (n.ai?.status === 'suggested' ? n.ai.category ?? '' : '')
}

/** The English meaning box starts with the AI's translation of a Tamil note (sure or unsure: it is a draft the person edits). */
export function defaultMeaning(n: NoteForAi, typed: string | undefined): string {
  if (typed !== undefined) return typed
  return n.language === 'ta' && n.ai && n.ai.status !== 'failed' ? n.ai.textEn ?? '' : ''
}

/** When the supervisor's tap and a sure AI suggestion differ, say so: one of them is wrong and a person should look. */
export function disagreement(n: NoteForAi, reasons: Reason[]): string | null {
  if (!n.category || n.categoryBy !== 'supervisor' || !n.ai?.category || n.ai.status === 'failed' || n.ai.category === n.category) return null
  const s = reasonById(reasons, n.category)?.en ?? n.category
  const a = reasonById(reasons, n.ai.category)?.en ?? n.ai.category
  return `The supervisor chose "${s}", but the AI reads the note as "${a}".`
}
