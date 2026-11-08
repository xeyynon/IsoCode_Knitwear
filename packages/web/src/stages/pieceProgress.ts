// What the ring and the bar on the supervisor's screens draw (UI/UX plan, phase 8A). Pure, so the rules are tested without a browser.
// Only real counts go in: nothing here estimates, and nothing is shown for a stage with nothing planned.

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)

/** Pieces done over pieces planned, 0 to 1. More than planned stops at full (the numbers beside the bar still show the real count). */
export const barFraction = (done: number, qty: number): number => (qty > 0 ? clamp01(done / qty) : 0)

/** The same share as words for a person: rounded DOWN, so a stage never reads 100% before it is. Empty when nothing is planned. */
export function percentText(done: number, qty: number): string {
  if (!(qty > 0)) return ''
  if (done >= qty) return '100%'
  return `${Math.floor(barFraction(done, qty) * 100)}%`
}

/** Stages updated today over open stages, 0 to 1 (the page never draws "0 of 0", so no stages is simply empty). */
export const ringFraction = (updated: number, total: number): number => (total > 0 ? clamp01(updated / total) : 0)
