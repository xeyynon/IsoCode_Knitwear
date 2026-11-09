// A note can carry SEVERAL reasons now (the form review): the supervisor taps all that apply, and the note is written from them. Pure rules for how the
// Review queue treats such a note, tested without a page. The first reason tapped is the main one (the existing single `category`).
import { composeReasonNote } from '@isocode/engine'

export interface NoteWithReasons {
  category: string | null
  /** The reasons in the order they were tapped. Absent on an old note or from an older server. */
  categories?: string[]
  /** True when the note's text is exactly the sentence composed from those reasons: no AI was needed. */
  generated?: boolean
  /** The English meaning the server holds, if any (for a generated note, the composed English sentence). */
  textEn?: string | null
}

/** Said quietly on a note that was written from the choices, so nobody wonders why there is no AI line. */
export const GENERATED_CAPTION = "Written from the supervisor's choices"

/** All the reasons: the list when there is one, otherwise the single category, otherwise none. */
export function reasonsOf(n: NoteWithReasons): string[] {
  if (n.categories && n.categories.length > 0) return n.categories
  return n.category ? [n.category] : []
}

/** Whether the list of reasons is drawn: only when the server sent one. An old note renders exactly as it always did. */
export const showsReasonList = (n: NoteWithReasons): boolean => !!n.categories && n.categories.length > 0

export const hasSeveral = (n: NoteWithReasons): boolean => !!n.categories && n.categories.length > 1

/** A note written from the choices: the server says so, and there is at least one reason to write it from. */
export const isGenerated = (n: NoteWithReasons): boolean => n.generated === true && reasonsOf(n).length > 0

/**
 * The reasons as shown, main first. A reason the merchandiser picked becomes the main one and moves to the front; the others keep their order and are never
 * dropped, so changing the main reason never loses what the supervisor chose.
 */
export function reasonsShown(n: NoteWithReasons, picked: string | undefined): string[] {
  const all = reasonsOf(n)
  if (!picked) return all
  return [picked, ...all.filter((id) => id !== picked)]
}

/** The control that changes the reason changes only the main one; with several reasons it says so. */
export const reasonFieldLabel = (n: NoteWithReasons): 'Reason' | 'Main reason' => (hasSeveral(n) ? 'Main reason' : 'Reason')

/** The English meaning of a generated note: the server's own, or the sentence composed from the reasons. */
export function generatedMeaning(n: NoteWithReasons): string {
  return n.textEn && n.textEn.trim() ? n.textEn : composeReasonNote('en', reasonsOf(n))
}
