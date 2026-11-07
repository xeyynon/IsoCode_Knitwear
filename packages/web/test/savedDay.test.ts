import { describe, expect, it } from 'vitest'
import { restoreSaved, savedFor, type Stage } from '../src/stages/useStages'

const stage: Stage = { orderId: 'o1', po: 'PO-1', style: 'S', colour: 'Navy', stage: 'cutting', sequence: 1, qty: 100, plannedEnd: '2026-11-20', produced: 40, todayQty: 10, complete: false }

describe('a list saved on the phone, opened with no signal', () => {
  it('keeps the saved day and its figures on the same day', () => {
    const r = restoreSaved({ today: '2026-11-04', phoneDay: '2026-11-04', stages: [stage], savedAt: 0 }, '2026-11-04')
    expect(r.today).toBe('2026-11-04')
    expect(r.stages[0]!.todayQty).toBe(10)
  })

  it('dates updates to the next day, not the saved one, and does not show the saved day as today', () => {
    const r = restoreSaved({ today: '2026-11-03', phoneDay: '2026-11-03', stages: [stage], savedAt: 0 }, '2026-11-04')
    expect(r.today).toBe('2026-11-04')
    expect(r.stages[0]!.todayQty).toBe(0)
    expect(r.stages[0]!.produced).toBe(40)
  })

  it('moves the server day on by the days the phone has moved, so a phone clock ahead of the server is not dated in the future', () => {
    // When saved, the server said the 4th while the phone said the 5th; a day later the phone says the 6th.
    const r = restoreSaved({ today: '2026-11-04', phoneDay: '2026-11-05', stages: [stage], savedAt: 0 }, '2026-11-06')
    expect(r.today).toBe('2026-11-05')
    expect(r.stages[0]!.todayQty).toBe(0)
  })

  it('never goes back before the saved day, even if the phone clock was moved back', () => {
    const r = restoreSaved({ today: '2026-11-04', phoneDay: '2026-11-04', stages: [stage], savedAt: 0 }, '2026-11-02')
    expect(r.today).toBe('2026-11-04')
    expect(r.stages[0]!.todayQty).toBe(10)
  })

  it('uses the phone day for a copy saved before the phone day was recorded, when it is later', () => {
    const r = restoreSaved({ today: '2026-11-03', stages: [stage], savedAt: 0 }, '2026-11-04')
    expect(r.today).toBe('2026-11-04')
    expect(r.stages[0]!.todayQty).toBe(0)
  })
})

describe('whose saved list it is (a shared phone)', () => {
  const saved = { today: '2026-11-04', phoneDay: '2026-11-04', stages: [stage], savedAt: 0 }
  it('is used for the person who saved it', () => {
    expect(savedFor({ ...saved, owner: 'A' }, 'A')).toMatchObject({ owner: 'A' })
  })
  it('is not shown to the next person who signs in on the phone', () => {
    expect(savedFor({ ...saved, owner: 'A' }, 'B')).toBeUndefined()
  })
  it('is not used when it records nobody (an older copy) or nobody is signed in', () => {
    expect(savedFor(saved, 'B')).toBeUndefined()
    expect(savedFor({ ...saved, owner: 'A' }, null)).toBeUndefined()
    expect(savedFor(undefined, 'A')).toBeUndefined()
  })
})
