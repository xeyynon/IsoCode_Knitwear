import { describe, expect, it } from 'vitest'
import { reasonById, usableReasons } from '../src/notes/reasons'
import { backToBoard, orderLink, timelineRows, type TimelineStage } from '../src/orders/orderDetailLogic'

const stage = (over: Partial<TimelineStage>): TimelineStage => ({
  stage: 'knitting', sequence: 1, status: 'green', complete: false, plannedEnd: '2026-11-10', projectedEnd: '2026-11-10', ...over,
})

describe('the way back to the board', () => {
  it('a row link carries the filters it was clicked under', () => {
    expect(orderLink('abc', 'status=red&buyer=b1')).toBe('/orders/abc?from=status%3Dred%26buyer%3Db1')
  })
  it('no filters, no extra parameter', () => {
    expect(orderLink('abc', '')).toBe('/orders/abc')
    expect(orderLink('abc', '?')).toBe('/orders/abc')
  })
  it('the back link rebuilds exactly the board the merchandiser left, search and sort included', () => {
    const from = new URLSearchParams(orderLink('abc', 'q=88240&status=red&sort=ship').split('?')[1]).get('from')
    expect(backToBoard(from)).toBe('/board?q=88240&status=red&sort=ship')
  })
  it('survives a reload: it is read from the address alone', () => {
    const url = new URL('http://x' + orderLink('abc', 'buyer=b1'))
    expect(backToBoard(url.searchParams.get('from'))).toBe('/board?buyer=b1')
  })
  it('with nothing carried, it goes to the plain board', () => {
    expect(backToBoard(null)).toBe('/board')
    expect(backToBoard('')).toBe('/board')
  })
  it('a hand-edited value cannot send anyone elsewhere or smuggle a hash', () => {
    expect(backToBoard('status=red#evil')).toBe('/board?status=red%23evil')
    expect(backToBoard('//evil.example/x')).toBe('/board?%2F%2Fevil.example%2Fx=')
    expect(backToBoard('a'.repeat(2000))).toBe('/board')
  })
})

describe('the reason on a note', () => {
  const server = [{ id: 'yarn', en: 'Yarn delayed at dye house' }, { id: 'power', en: 'Power cut' }]
  it('is worded from the list the order came with, not the built-in one', () => {
    expect(reasonById(usableReasons(server), 'yarn')?.en).toBe('Yarn delayed at dye house')
    expect(reasonById(usableReasons(server), 'power')?.en).toBe('Power cut')
  })
  it('falls back to the built-in wording when the server sent no list', () => {
    expect(reasonById(usableReasons(undefined), 'power')?.en).toBe('No power')
  })
})

describe('timelineRows', () => {
  it('lists the stages in sequence order, whatever order they arrive in', () => {
    const rows = timelineRows([stage({ stage: 'sewing', sequence: 3 }), stage({ stage: 'knitting', sequence: 1 }), stage({ stage: 'linking', sequence: 2 })])
    expect(rows.map((r) => r.stage)).toEqual(['knitting', 'linking', 'sewing'])
  })
  it('counts days late and early from the plan, as the stage card does', () => {
    const [late, early, onPlan] = timelineRows([
      stage({ sequence: 1, projectedEnd: '2026-11-13' }),
      stage({ sequence: 2, projectedEnd: '2026-11-09' }),
      stage({ sequence: 3, projectedEnd: '2026-11-10' }),
    ])
    expect(late).toMatchObject({ days: 3, text: '3 days late' })
    expect(early).toMatchObject({ days: -1, text: '1 day early' })
    expect(onPlan).toMatchObject({ days: 0, text: 'on plan' })
  })
  it('works across a month end', () => {
    expect(timelineRows([stage({ plannedEnd: '2026-11-29', projectedEnd: '2026-12-02' })])[0]!.days).toBe(3)
  })
  it('a stage with no projection says so and gives no number (a dash beats an estimate)', () => {
    const r = timelineRows([stage({ status: 'grey', projectedEnd: null })])[0]!
    expect(r).toMatchObject({ projected: null, days: null, text: 'Not enough data' })
  })
  it('a finished stage is Done, with no days counted', () => {
    const r = timelineRows([stage({ complete: true, projectedEnd: '2026-11-12' })])[0]!
    expect(r).toMatchObject({ done: true, days: null, text: 'Done' })
  })
  it('keeps the status the server gave, never works one out', () => {
    expect(timelineRows([stage({ status: 'grey', projectedEnd: '2026-11-01' })])[0]!.status).toBe('grey')
    expect(timelineRows([stage({ status: 'red', projectedEnd: '2026-11-10' })])[0]!.status).toBe('red')
  })
})
