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

/**
 * What a build report holds for a part nobody has written yet. A report that still holds one of these must not be
 * tagged, released or shown to merchandisers (BE-050): changelog.mjs --tag, check_repo.mjs and release.yml refuse it.
 */
export const PLACEHOLDER = {
  summary: '(write one or two plain sentences)',
  why: '(why this was done)',
  verified: '(how it was verified, honestly; say what was not checked)',
  next: '(what to improve next)',
}

/** The placeholder texts found in a report, or [] when every part is written. */
export function placeholdersIn(text) {
  return Object.values(PLACEHOLDER).filter((p) => text.includes(p))
}
