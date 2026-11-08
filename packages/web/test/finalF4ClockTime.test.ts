import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { clockTime } from '../src/dates'

// Final cycle W-18: the saved list's time was the phone's own locale string ("2:05:09 PM": seconds, AM and PM, in whatever language the phone had).
// It is the factory's time, hours and minutes on a 24-hour clock, for the language on screen.
describe('W-18: the time on the saved-list notice', () => {
  const at = new Date('2026-11-04T08:35:09Z')   // 14:05 in India
  it('W-18: is hours and minutes on a 24-hour clock in India time, in English', () => expect(clockTime('en', at)).toBe('14:05'))
  it('W-18: and in Tamil: no seconds, no AM or PM', () => {
    const t = clockTime('ta', at)
    expect(t).toMatch(/^\d{2}:\d{2}$|^[௦-௯]{2}:[௦-௯]{2}$/)
    expect(t).not.toMatch(/AM|PM|am|pm|[:.]\d{2}[:.]\d{2}/)
  })
  it('W-18: a late-night time is not 24:xx', () => expect(clockTime('en', new Date('2026-11-04T18:31:00Z'))).toBe('00:01'))
  it('W-18: Today uses it, not the phone\'s locale string', () => {
    const src = readFileSync(new URL('../src/pages/Today.tsx', import.meta.url), 'utf8')
    expect(src).toContain('clockTime(lang')
    expect(src).not.toContain('toLocaleTimeString')
  })
})
