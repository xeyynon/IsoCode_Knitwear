// Deterministic, clearly fake data for the speed-up tests (OPT-A). Same seed, same data, on every machine.
// Dates are produced with the plain Date maths below, not with the code under test.
import type { Order, Settings, Stage, UnitCalendar, UpdateEvent } from '../src/index.js'

/** A small seeded random number generator (mulberry32): no dependency on Math.random. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY = 86_400_000
export const isoOfDay = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10)
export const dayOfIso = (d: string): number => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY)

export interface EngineCase {
  order: Order
  stages: Stage[]
  events: UpdateEvent[]
  calendars: Record<string, UnitCalendar>
  settings: Settings
  today: string
}

const STAGES = ['cutting', 'sewing', 'finishing', 'packing', 'ironing']

/** A calendar with some worked Sundays and some closed weekdays; sometimes empty, sometimes dense. */
export function randomCalendar(next: () => number, centre: string, spanDays: number, maxEntries: number): UnitCalendar {
  const days: Record<string, boolean> = {}
  const entries = Math.floor(next() * maxEntries)
  const c = dayOfIso(centre)
  for (let i = 0; i < entries; i++) days[isoOfDay(c - spanDays + Math.floor(next() * spanDays * 2))] = next() < 0.5
  return { days }
}

/**
 * `count` orders, each with 0 to 5 stages over 3 units (one with a dense calendar, one empty, one with no calendar at all),
 * 0 to 30 update events (some on closed days, on Sundays, in the future, repeated, with odd quantities), and a settings
 * object that varies. `today` varies too, including Sundays.
 */
export function engineCases(count: number, seed: number): EngineCase[] {
  const next = rng(seed)
  const pick = (n: number) => Math.floor(next() * n)
  const centre = '2026-11-04'
  const cals: Record<string, UnitCalendar> = {
    u1: randomCalendar(next, centre, 120, 60),
    u2: {},
    // u3 has no calendar at all
  }
  const out: EngineCase[] = []
  for (let i = 0; i < count; i++) {
    const today = isoOfDay(dayOfIso(centre) + pick(60) - 20)
    const exFactory = isoOfDay(dayOfIso(today) + pick(90) - 10)
    const nStages = pick(6)
    const seqs = [0, 1, 2, 3, 4].sort(() => next() - 0.5).slice(0, nStages)
    const stages: Stage[] = seqs.map((sequence) => ({
      stage: STAGES[sequence]!, unitId: ['u1', 'u2', 'u3'][pick(3)]!, qty: 500 + pick(60) * 100,
      milestone: isoOfDay(dayOfIso(exFactory) - pick(30) + 5), sequence,
      ...(next() < 0.25 ? { plannedRate: 50 + pick(400) } : {}),
    }))
    const events: UpdateEvent[] = []
    const nEvents = pick(31)
    for (let e = 0; e < nEvents; e++) {
      const clientUuid = next() < 0.05 && events.length ? events[pick(events.length)]!.clientUuid : `e${i}-${e}`
      events.push({
        clientUuid, stage: STAGES[pick(5)]!, date: isoOfDay(dayOfIso(today) + pick(25) - 22),
        qty: next() < 0.03 ? -5 : next() < 0.03 ? Number.NaN : pick(700),
      })
    }
    const settings: Settings = i % 5 === 0
      ? { windowDays: 1 + pick(8), minDataDays: 1 + pick(5), rampUpDays: pick(5), redBelow: 0.8 + pick(2) * 0.1, bufferDays: pick(4), warnWithinDays: 7 + pick(30) }
      : { windowDays: 5, minDataDays: 3, rampUpDays: 3, redBelow: 0.9, bufferDays: 2, warnWithinDays: 14 }
    out.push({ order: { id: `order-${i}`, exFactory }, stages, events, calendars: cals, settings, today })
  }
  return out
}
