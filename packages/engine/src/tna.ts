// TNA (time and action) back-scheduling: from the ex-factory date, work backwards to the
// date each stage must finish. Pure: no clock, no database.
import { compareDates, workingDaysBack, type IsoDate, type UnitCalendar } from './dates.js'

export interface TemplateStep {
  stage: string
  sequence: number
  /** Working days (in the stage's unit calendar) before ex-factory that this stage must finish. 0 = the last working day on or before ex-factory. */
  workingDaysBefore: number
  unitId: string
}

export interface ScheduledMilestone {
  stage: string
  sequence: number
  unitId: string
  plannedEnd: IsoDate
}

export interface Schedule {
  milestones: ScheduledMilestone[]
  /** Structural faults in the template. Non-empty means do not create the order. */
  problems: string[]
  /** Stages whose finish date is already today or in the past. The order is real, just late: warn, do not refuse. */
  alreadyDue: string[]
}

export function backSchedule(
  exFactory: IsoDate,
  steps: TemplateStep[],
  calendars: Record<string, UnitCalendar>,
  today: IsoDate,
): Schedule {
  const problems: string[] = []
  const names = new Set<string>()
  for (const s of steps) {
    if (!s.stage.trim()) problems.push('a stage has no name')
    if (names.has(s.stage)) problems.push(`stage "${s.stage}" appears twice`)
    names.add(s.stage)
    if (!Number.isInteger(s.workingDaysBefore) || s.workingDaysBefore < 0) problems.push(`stage "${s.stage}" needs a whole number of working days, 0 or more`)
  }
  if (!steps.length) problems.push('the template has no stages')

  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence)
  const milestones: ScheduledMilestone[] = ordered.map((s) => ({
    stage: s.stage, sequence: s.sequence, unitId: s.unitId,
    plannedEnd: workingDaysBack(calendars[s.unitId], exFactory, Math.max(0, s.workingDaysBefore)),
  }))

  // A later stage cannot be due before an earlier one. Only the offsets can make that a
  // template fault; when closed days in different units cause it, the later stage is held
  // to the earlier stage's date instead.
  for (let i = 1; i < milestones.length; i++) {
    const prev = milestones[i - 1]!
    const cur = milestones[i]!
    if (ordered[i]!.workingDaysBefore > ordered[i - 1]!.workingDaysBefore) {
      problems.push(`"${cur.stage}" would finish (${cur.plannedEnd}) before "${prev.stage}" (${prev.plannedEnd}); check the template offsets`)
    } else if (compareDates(cur.plannedEnd, prev.plannedEnd) < 0) {
      cur.plannedEnd = prev.plannedEnd
    }
  }
  const alreadyDue = milestones.filter((m) => compareDates(m.plannedEnd, today) <= 0).map((m) => m.stage)
  return { milestones, problems, alreadyDue }
}
