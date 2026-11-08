import { istDate, isIsoDate } from './today.js'

/**
 * For a hosted demo: every real day reads as `demoToday` in India, and the time of day runs as normal. The seeded figures (the
 * brief's "qty done" as at a given day) then stay meaningful for as long as the demo is up, while everything that measures time
 * within a day still works: a 15-minute sign-in lock ends, a 12-hour token expires. At midnight the clock moves back a day, which only
 * makes a token or a buyer link last a little longer. Unset: the real clock. Never for a real deployment.
 */
export function demoClock(demoToday: string | undefined, now: () => Date = () => new Date()): (() => Date) | undefined {
  const day = demoToday?.trim()
  if (!day) return undefined
  if (!isIsoDate(day)) throw new Error('DEMO_TODAY must be a real date (YYYY-MM-DD)')
  const demoMidnight = Date.parse(`${day}T00:00:00Z`)
  return () => {
    const t = now()
    const shift = Date.parse(`${istDate(t)}T00:00:00Z`) - demoMidnight
    return new Date(t.getTime() - shift)
  }
}
