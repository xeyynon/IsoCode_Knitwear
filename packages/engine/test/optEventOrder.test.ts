// O-10 (OPT-A) proof, engine side: the answer does not depend on the order an order's events arrive in. That is what lets the
// server stop sorting 40,000 events in the database before handing them over.
//
// Why it holds: the engine only sums quantities (whole numbers, so addition order cannot change a total), builds sets of dates and
// sorts them, and keeps the first event of a repeated clientUuid. The last one is the only order-dependent step, and the database
// makes it unreachable: update_event.client_uuid is UNIQUE (001_init.sql). So the cases here have no repeated clientUuid.
import { describe, expect, it } from 'vitest'
import { projectOrder, rateDates, cleanEvents } from '../src/index.js'
import { engineCases, rng } from './optData.js'

function shuffled<T>(xs: readonly T[], next: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!] }
  return a
}

describe('O-10: event order does not change the engine output', () => {
  const cases = engineCases(300, 11).map((c) => {
    const seen = new Set<string>()
    // one event per clientUuid, as the database guarantees; whole-number quantities, as the column is an int (NaN and negatives are kept: the engine drops them)
    return { ...c, events: c.events.filter((e) => !seen.has(e.clientUuid) && !!seen.add(e.clientUuid)) }
  })

  it('projectOrder, cleanEvents and rateDates give identical output for 5 random orderings (and reversed, and sorted) of every order\'s events', () => {
    const next = rng(5)
    let events = 0
    for (const c of cases) {
      const base = projectOrder(c.order, c.stages, c.events, c.calendars, c.today, c.settings)
      const baseClean = new Set(cleanEvents(c.events, c.today).map((e) => e.clientUuid))
      const orderings = [
        ...Array.from({ length: 5 }, () => shuffled(c.events, next)),
        [...c.events].reverse(),
        [...c.events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.clientUuid < b.clientUuid ? -1 : 1)),   // the order the old query gave
      ]
      for (const ev of orderings) {
        expect(JSON.stringify(projectOrder(c.order, c.stages, ev, c.calendars, c.today, c.settings))).toBe(JSON.stringify(base))
        expect(new Set(cleanEvents(ev, c.today).map((e) => e.clientUuid))).toEqual(baseClean)
        for (const s of c.stages) {
          const mine = (list: typeof ev) => list.filter((e) => e.stage === s.stage)
          expect(rateDates(mine(ev), c.calendars[s.unitId], c.today, c.settings)).toEqual(rateDates(mine(c.events), c.calendars[s.unitId], c.today, c.settings))
        }
      }
      events += c.events.length
    }
    expect(events).toBeGreaterThan(3000)
  })
})
