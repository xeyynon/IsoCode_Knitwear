import { ApiError } from '../api/session'

/**
 * Undo for "Don't show" (UI/UX plan, slice 4.1). The rules, with no React so they can be tested:
 *  - Only a warning that was still WAITING for review when it was hidden can be undone. One that had been CONFIRMED may already have been
 *    seen by a buyer, so hiding it has no undo: showing it again needs a fresh confirmation (rule 18). The server enforces the same
 *    (409 needs_confirmation); the page simply never offers what the server would refuse.
 *  - The line stays while the page stays (no timer, no toast); a reload of the page ends it.
 */
export interface HiddenItem { id: string; po: string; stage: string; buyerName: string }

/** Which list the warning was hidden from. */
export type HiddenFrom = 'waiting' | 'confirmed'

export const offersUndo = (from: HiddenFrom): boolean => from === 'waiting'

/** The newest hidden item first, each item once. */
export const afterHide = (list: HiddenItem[], item: HiddenItem): HiddenItem[] => [item, ...list.filter((h) => h.id !== item.id)]

export const afterUndo = (list: HiddenItem[], id: string): HiddenItem[] => list.filter((h) => h.id !== id)

/**
 * What a failed undo says, and what to do next.
 *  - final: trying again cannot help, so the button goes and only the words stay.
 *  - back: the warning is already in the waiting list (the server says it is not hidden), so the page reloads and drops the line.
 */
export function undoOutcome(e: unknown): { text: string; final: boolean; back: boolean } {
  if (e instanceof ApiError) {
    if (e.code === 'needs_confirmation') return { text: 'This warning had been confirmed, so it cannot be brought back with undo. Confirm it again to show it to the buyer.', final: true, back: false }
    if (e.code === 'not_dismissed') return { text: 'It is already back in the list.', final: false, back: true }
    if (e.code === 'not_open') return { text: 'This warning no longer applies, so there is nothing to bring back.', final: true, back: false }
  }
  return { text: 'Could not undo. Try again.', final: false, back: false }
}
