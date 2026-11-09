// The note on the Update form: it writes itself from the reasons a supervisor taps, stays editable, and is never overwritten once a person
// has typed in it. Pure (no React, no browser), so every transition is tested in test/noteDraft.test.ts.
//
// The rules, in one place:
//  - While the note is only what the choices would write, it follows the choices (tap a reason, the sentence changes).
//  - The first time a person changes the text it becomes theirs (`edited`): later taps never touch it. A small link ("Rewrite from my choices")
//    offers to write it again, on request only.
//  - Clearing the box empties it and does not refill it while they type; the next tap on a reason writes from the choices again.
//  - Putting the generated sentence back by hand makes it generated again.
//  - "Something else" writes its own general sentence, and asks for a few words (never required).
import { composeReasonNote, type NoteLang } from '@isocode/engine/reasonNote'

export interface NoteDraft { text: string; edited: boolean }

export const initialDraft = (): NoteDraft => ({ text: '', edited: false })

/** The reasons changed (or the language did): follow them, unless the note is the person's own. */
export function onSelect(draft: NoteDraft, selected: readonly string[], lang: NoteLang): NoteDraft {
  if (draft.edited) return draft
  return { text: composeReasonNote(lang, selected), edited: false }
}

/** The person typed: the text is theirs, unless it is empty (follow the choices from the next tap) or exactly what the choices write. */
export function onEdit(_draft: NoteDraft, text: string, selected: readonly string[], lang: NoteLang): NoteDraft {
  if (text === '') return { text: '', edited: false }
  return { text, edited: text !== composeReasonNote(lang, selected) }
}

/** Is the note exactly what the choices write? (It then carries the "Written from your choices" label.) */
export const isGenerated = (draft: NoteDraft, selected: readonly string[], lang: NoteLang): boolean =>
  selected.length > 0 && !draft.edited && draft.text === composeReasonNote(lang, selected)

/** Is "Rewrite from my choices" useful: there is something to write from, and it differs from what is in the box. */
export const canRewrite = (draft: NoteDraft, selected: readonly string[], lang: NoteLang): boolean =>
  selected.length > 0 && draft.text !== composeReasonNote(lang, selected)

/** Write it again from the choices (on request). With no choice there is nothing to write from and the person's words stay. */
export function rewrite(draft: NoteDraft, selected: readonly string[], lang: NoteLang): NoteDraft {
  if (selected.length === 0) return draft
  return { text: composeReasonNote(lang, selected), edited: false }
}

/** "Something else" is chosen and the person has not yet added their own words: ask for a few, without blocking the send. */
export const needsDetail = (selected: readonly string[], draft: NoteDraft, lang: NoteLang): boolean =>
  selected.includes('other') && isGenerated(draft, selected, lang)
