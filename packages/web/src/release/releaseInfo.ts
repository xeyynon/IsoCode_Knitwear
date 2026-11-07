/** One build as scripts/changelog.mjs writes it to build-info.json. The summary is public release wording. */
export interface BuildEntry { n: number; date: string; title: string; summary: string }
export interface BuildInfo { latest: number | null; builds: BuildEntry[] }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "2026-11-03" as "3 Nov 2026". Read from the text, not through a Date, so the phone's time zone
 * cannot move the day. Anything that is not a real calendar day gives "" (the caller leaves it out).
 */
export function formatBuildDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const real = new Date(Date.UTC(year, month - 1, day))
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return ''
  return `${day} ${MONTHS[month - 1]} ${year}`
}

/** "Build 1006 - 3 Nov 2026"; just "Build 1006" when the date is missing. */
export function buildWhen(n: number, date: string): string {
  const day = formatBuildDate(date)
  return day ? `Build ${n} - ${day}` : `Build ${n}`
}

/** The label of the latest build; null when no build has been recorded. */
export function buildLabel(info: BuildInfo): string | null {
  if (info.latest === null) return null
  return buildWhen(info.latest, info.builds.find((b) => b.n === info.latest)?.date ?? '')
}

/** The newest builds, newest first whatever the order in the file, for the "What's new" dialog. */
export function recentBuilds(info: BuildInfo, count = 3): BuildEntry[] {
  return info.builds.filter((b) => b.title.trim() !== '').sort((a, b) => b.n - a.n).slice(0, count)
}
