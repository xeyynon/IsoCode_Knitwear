import {
  cleanEvents, DEFAULT_SETTINGS, rateDates,
  type IsoDate, type Settings, type Stage, type UnitCalendar, type UpdateEvent,
} from '@isocode/engine'

/** The calendar of each stage's unit, by stage name, for `lowConfidenceStages`. */
export function calendarOfStages(stages: readonly Stage[], calendars: Record<string, UnitCalendar>): (stage: string) => UnitCalendar | undefined {
  const unitOf = new Map(stages.map((s) => [s.stage, s.unitId]))
  return (stage) => {
    const unit = unitOf.get(stage)
    return unit === undefined ? undefined : calendars[unit]
  }
}

/**
 * Which stages rest on figures a merchandiser entered on a visit, not a count sent from the floor.
 * A stage is low confidence when any of the days its rate is made from holds an update entered on
 * behalf. Which days those are is the engine's own rule (`rateDates`): completed working days, newest
 * `windowDays` of them, today only when there are too few finished days. So a day the engine drops
 * (today, a closed day, a day in the future, an older day) never flags a stage, and a day it uses
 * always does (BE-004).
 * The engine is not told: it keeps using the pieces. This only says how far to trust them.
 *
 * `settings` is the engine's settings (a bare number is read as `windowDays`); `calendarOf` gives a stage's
 * unit calendar. Without one the weekly Sunday closure is all that is known.
 */
export function lowConfidenceStages(
  events: readonly UpdateEvent[], onBehalf: ReadonlySet<string>, today: IsoDate,
  settings: Settings | number = DEFAULT_SETTINGS,
  calendarOf: (stage: string) => UnitCalendar | undefined = () => undefined,
): Set<string> {
  const s: Settings = typeof settings === 'number' ? { ...DEFAULT_SETTINGS, windowDays: settings } : settings
  const byStage = new Map<string, UpdateEvent[]>()
  for (const e of cleanEvents(events, today)) {
    const list = byStage.get(e.stage)
    if (list) list.push(e); else byStage.set(e.stage, [e])
  }
  const out = new Set<string>()
  for (const [stage, list] of byStage) {
    if (!list.some((e) => onBehalf.has(e.clientUuid))) continue
    const feeding = new Set(rateDates(list, calendarOf(stage), today, s))
    if (list.some((e) => onBehalf.has(e.clientUuid) && feeding.has(e.date))) out.add(stage)
  }
  return out
}
