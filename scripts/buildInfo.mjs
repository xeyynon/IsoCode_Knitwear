// What scripts/changelog.mjs writes to build-info.json, kept apart so a test can run it.
// The app reads this file to show the build label and "What's new" (packages/web/src/release).

/** Builds kept in build-info.json: enough for the "What's new" dialog, small enough to ship in the app. */
export const KEEP_BUILDS = 10

/**
 * Newest first, only the public fields. The summary is the whole "What changed" paragraph of the
 * build report (reports are public wording: no budget, rate or client detail), not a cut of it.
 */
export function publicBuilds(reports, keep = KEEP_BUILDS) {
  return [...reports].sort((a, b) => b.n - a.n).slice(0, keep)
    .map((r) => ({ n: r.n, date: r.date, title: r.title, summary: r.summary }))
}
