// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { activityTime, visibleEntries, type AuditEntry } from '../src/setup/activityLogic'
import { AccountActivity } from '../src/ui/organisms/AccountActivity'

// UI/UX plan, slice 5.3: Setup > People "Activity". The route (GET /api/accounts/audit, md/api.md) returns `sentence` in plain English
// already, so the page only shows it with the time (in India time, with the zone named) and never builds its own wording.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const entry = (n: number, sentence = `Ravi stopped Meena's account (${n}).`): AuditEntry => ({
  id: String(n), at: '2026-11-04T04:30:00.000Z', actor: 'Ravi', subject: 'Meena', subjectId: 's1', action: 'account_stopped', sentence,
})

describe('activityTime', () => {
  it('is the day, the time and the zone, in India time whatever the computer', () => {
    expect(activityTime('2026-11-04T04:30:00.000Z')).toBe('4 Nov, 10:00 am IST')
    expect(activityTime('2026-11-04T20:05:00.000Z')).toBe('5 Nov, 1:35 am IST')
  })
  it('says nothing for a date it cannot read', () => expect(activityTime('nope')).toBe(''))
})

describe('visibleEntries', () => {
  const list = Array.from({ length: 14 }, (_, i) => entry(i))
  it('shows the latest ten, and all when asked', () => {
    expect(visibleEntries(list, false)).toHaveLength(10)
    expect(visibleEntries(list, true)).toHaveLength(14)
  })
  it('a short list is shown whole', () => expect(visibleEntries(list.slice(0, 3), false)).toHaveLength(3))
})

describe('AccountActivity', () => {
  it('shows the server sentence and the time for each entry, newest first as sent', () => {
    const { container } = render(<AccountActivity entries={[entry(1, 'Ravi added Meena as a supervisor.'), entry(2)]} failed={false} onRetry={() => {}} />)
    const items = [...container.querySelectorAll('li')]
    expect(items).toHaveLength(2)
    expect(items[0]!.textContent).toContain('Ravi added Meena as a supervisor.')
    expect(items[0]!.textContent).toContain('4 Nov, 10:00 am IST')
  })
  it('says what it is when nothing has happened yet', () => {
    expect(render(<AccountActivity entries={[]} failed={false} onRetry={() => {}} />).container.textContent).toMatch(/nothing has been changed yet/i)
  })
  it('says it is loading, and shows the shared failure card with Retry when it could not load', () => {
    expect(render(<AccountActivity entries={null} failed={false} onRetry={() => {}} />).container.textContent).toMatch(/loading/i)
    const failed = render(<AccountActivity entries={null} failed onRetry={() => {}} />)
    expect(failed.container.querySelector('[role=alert]')).not.toBeNull()
    expect(failed.getByText('Retry')).toBeTruthy()
  })
  it('offers the rest of a long list behind a button, not all at once', () => {
    const { container, getByText } = render(<AccountActivity entries={Array.from({ length: 14 }, (_, i) => entry(i))} failed={false} onRetry={() => {}} />)
    expect(container.querySelectorAll('li')).toHaveLength(10)
    fireEvent.click(getByText('Show all 14'))
    expect(container.querySelectorAll('li')).toHaveLength(14)
  })
})

describe('the People tab reads it', () => {
  const tab = read('../src/setup/PeopleTab.tsx')
  it('asks the audit route and refreshes it after each change', () => {
    expect(tab).toContain("'/api/accounts/audit'")
    expect(tab).toContain('<AccountActivity')
  })
})
