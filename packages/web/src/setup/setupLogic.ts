// The small decisions behind the Setup screens, without React so they can be tested. The server checks
// everything again; these exist so a merchandiser hears what is wrong before pressing a button.

/** The obvious PINs, refused: they are what a guesser tries first. Mirrors the server's rule. */
export function weakPin(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return 'The PIN must be exactly 4 digits'
  const d = pin.split('').map(Number)
  if (d.every((x) => x === d[0])) return 'That PIN is too easy to guess (the same digit four times)'
  const step = d[1]! - d[0]!
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1]! === step)) return 'That PIN is too easy to guess (a run of digits)'
  if (d[0] === d[2] && d[1] === d[3]) return 'That PIN is too easy to guess (a repeated pair)'
  if (['2580', '1004', '2000', '2001', '1122', '6969', '0852', '1990', '1980'].includes(pin)) return 'That PIN is too easy to guess'
  return null
}

export interface StageRow { id: number; stage: string; days: string; unitId: string }

/** Plain-words problems with a template as written, or null when it is ready to save. */
export function templateProblem(name: string, rows: StageRow[]): string | null {
  if (!name.trim()) return 'Give the template a name.'
  if (rows.length === 0) return 'Add at least one stage.'
  if (rows.length > 20) return 'A template can have at most 20 stages.'
  const seen = new Set<string>()
  let prev: { stage: string; days: number } | null = null
  for (const [i, r] of rows.entries()) {
    const stage = r.stage.trim()
    if (!stage) return `Stage ${i + 1} has no name.`
    if (seen.has(stage.toLowerCase())) return `"${stage}" is listed twice.`
    seen.add(stage.toLowerCase())
    if (!/^\d{1,3}$/.test(r.days.trim()) || Number(r.days) > 365) return `"${stage}": enter the working days before ex-factory as a whole number from 0 to 365.`
    if (!r.unitId) return `"${stage}": choose the unit that does it.`
    const days = Number(r.days)
    // A stage listed later is due later, so it has FEWER working days before ex-factory (or the same).
    if (prev && days > prev.days) return `"${stage}" would finish before "${prev.stage}" (${days} days before ex-factory is earlier than ${prev.days}). Put the stages in the order they happen, with the biggest number first.`
    prev = { stage, days }
  }
  return null
}

/** Move a row up (-1) or down (+1); at an end, nothing changes. Never mutates its input. */
export function moveRow<T>(rows: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta
  if (to < 0 || to >= rows.length) return rows
  const next = [...rows]
  const [item] = next.splice(index, 1)
  next.splice(to, 0, item!)
  return next
}

export function accountState(a: { disabled: boolean; locked: boolean }): { text: string; tone: 'ok' | 'stopped' | 'locked' } {
  if (a.disabled) return { text: 'Stopped', tone: 'stopped' }
  if (a.locked) return { text: 'Locked after wrong PINs', tone: 'locked' }
  return { text: 'Active', tone: 'ok' }
}

export const dayKind = (working: boolean): string => (working ? 'Worked (extra day)' : 'Closed')

/** What "Back to normal" sends: the row's own unit, never the unit selected now (the list may be another unit's). */
export const clearDayBody = (d: { unitId: string; date: string }): { unitId: string; date: string } => ({ unitId: d.unitId, date: d.date })

/** Each start() returns a check that stays true only until the next start(): a late answer to an older request is dropped. */
export function latestRequest(): { start(): () => boolean } {
  let seq = 0
  return { start() { const mine = ++seq; return () => mine === seq } }
}

/** Days for clearing rejected photos, 0 to 3650, or null. Digits only: an empty field is refused, never read as 0 (which clears them all). */
export function purgeDays(raw: string): number | null {
  if (!/^\d{1,4}$/.test(raw.trim())) return null
  const n = Number(raw)
  return n <= 3650 ? n : null
}

/** A 10-digit number as typed (spaces, +91, dashes allowed), or null. */
export function tenDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  return /^\d{10}$/.test(ten) ? ten : null
}
