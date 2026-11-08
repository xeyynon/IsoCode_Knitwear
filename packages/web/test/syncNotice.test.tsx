// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { NOTICE_MS, noticeFor } from '../src/ui/syncNotice'
import { SyncChip } from '../src/ui/SyncChip'
import type { QueueController, QueueState } from '../src/queue/controller'

// UI/UX plan, slice 4.4: the change from "waiting" to "sent" is noticed, not just re-worded. Never green (sync is not order status).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')

const base = { pending: 0, rejected: [], syncing: false, online: true, foreign: 0, foreignRejected: 0, error: null } as unknown as QueueState
const ctl = { syncNow: async () => {} } as unknown as QueueController

describe('noticeFor', () => {
  it('says nothing on the first look', () => expect(noticeFor(null, 'ok')).toBe(false))
  it('says nothing while the tone stays (3 waiting then 2 waiting)', () => expect(noticeFor('wait', 'wait')).toBe(false))
  it('notices waiting to sent, and a turn to a problem', () => {
    expect(noticeFor('wait', 'ok')).toBe(true)
    expect(noticeFor('ok', 'problem')).toBe(true)
    expect(noticeFor('problem', 'ok')).toBe(true)
  })
})

describe('SyncChip', () => {
  afterEach(() => vi.useRealTimers())
  it('is not marked on arrival, is marked when it settles, and the mark goes away by itself', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<SyncChip state={{ ...base, pending: 2 }} ctl={ctl} />)
    const chip = () => container.querySelector('.sync') as HTMLElement
    expect(chip().className).not.toContain('sync--noticed')
    rerender(<SyncChip state={{ ...base, pending: 0 }} ctl={ctl} />)
    expect(chip().className).toContain('sync--noticed')
    act(() => { vi.advanceTimersByTime(NOTICE_MS + 50) })
    expect(chip().className).not.toContain('sync--noticed')
  })
  it('does not mark a count going down while still waiting', () => {
    const { container, rerender } = render(<SyncChip state={{ ...base, pending: 3 }} ctl={ctl} />)
    rerender(<SyncChip state={{ ...base, pending: 2 }} ctl={ctl} />)
    expect(container.querySelector('.sync')!.className).not.toContain('sync--noticed')
  })
})

describe('the notice in CSS', () => {
  it('is a ring in the accent, never green or a status colour', () => {
    const rule = /\.sync--noticed\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rule).toContain('animation:')
    expect(rule + (/@keyframes sync-notice\s*\{[\s\S]*?\}\s*\}/.exec(css)?.[0] ?? '')).not.toMatch(/green|status|--ok/)
  })
  it('does not move under reduced motion (a still outline instead)', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.sync--noticed\s*\{\s*animation:\s*none;[^}]*outline:/)
  })
})
