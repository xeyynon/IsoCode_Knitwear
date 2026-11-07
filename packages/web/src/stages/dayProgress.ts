// How the supervisor's day is going, from the real counts (UI/UX plan, slices 1.9 and 1.10). Pure, so the rules are tested without a browser.
//
// The product's biggest risk is supervisors stopping their daily updates. Today says how many of the day's stages have an update, and
// after a send the next stage with none is one tap away. Nothing here is invented: "an update" is pieces the server already holds for
// today, or pieces saved on this phone and not yet sent (the caller supplies those as `extraOf`).
import type { Stage } from './useStages'

/** Pieces entered today that the server's total does not include yet: waiting to send, or sent after the list was fetched. */
export type ExtraOf = (s: Stage) => number

/** The stages still being worked: a finished stage is not waiting for an update. */
export const openStages = (stages: readonly Stage[]): Stage[] => stages.filter((s) => !s.complete)

export const updatedToday = (s: Stage, extra: number): boolean => s.todayQty + extra > 0

/** How many open stages have an update today, out of all the open ones. Null when there is nothing to update (never "0 of 0"). */
export function dayProgress(stages: readonly Stage[], extraOf: ExtraOf): { updated: number; total: number } | null {
  const open = openStages(stages)
  if (open.length === 0) return null
  return { updated: open.filter((s) => updatedToday(s, extraOf(s))).length, total: open.length }
}

/**
 * The next stage to update after a send: an open stage with no update today, other than the one just sent, taking the list in its own
 * order (soonest due first) from the one after this, then round to the ones before. Null when every other stage is done for today.
 */
export function nextStage(stages: readonly Stage[], current: { orderId: string; stage: string }, extraOf: ExtraOf): Stage | null {
  const at = stages.findIndex((s) => s.orderId === current.orderId && s.stage === current.stage)
  const order = at < 0 ? [...stages] : [...stages.slice(at + 1), ...stages.slice(0, at)]
  return order.find((s) => !s.complete && !updatedToday(s, extraOf(s))) ?? null
}
