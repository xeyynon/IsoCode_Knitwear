import { compareDates, type IsoDate, type UpdateEvent } from '@isocode/engine'

/**
 * Which stages rest on figures a merchandiser entered on a visit, not a count sent from the floor.
 * The rate comes from the newest `windowDays` days that have an update, so a stage is low confidence
 * when any of those days holds an update entered on behalf. Older entries no longer feed the rate and
 * do not flag it; neither does a day in the future, which the engine ignores too.
 * The engine is not told: it keeps using the pieces. This only says how far to trust them.
 */
export function lowConfidenceStages(events: UpdateEvent[], onBehalf: ReadonlySet<string>, today: IsoDate, windowDays: number): Set<string> {
  const datesBy = new Map<string, Set<IsoDate>>()
  const flagged = new Map<string, Set<IsoDate>>()
  for (const e of events) {
    if (compareDates(e.date, today) > 0) continue
    ;(datesBy.get(e.stage) ?? datesBy.set(e.stage, new Set()).get(e.stage)!).add(e.date)
    if (onBehalf.has(e.clientUuid)) (flagged.get(e.stage) ?? flagged.set(e.stage, new Set()).get(e.stage)!).add(e.date)
  }
  const out = new Set<string>()
  for (const [stage, dates] of datesBy) {
    const recent = new Set([...dates].sort((a, b) => compareDates(b, a)).slice(0, Math.max(1, windowDays)))
    if ([...(flagged.get(stage) ?? [])].some((d) => recent.has(d))) out.add(stage)
  }
  return out
}
