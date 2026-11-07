import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isUpdateWaiting, queueAtRisk, shouldCheckForUpdate, shouldReloadOnTakeover, showUpdateBanner, SW_CHECK_EVERY_MS, SW_RELOAD_WINDOW_MS } from '../src/ui/swUpdate'
import { clearUnsentInput, hasUnsentInput, setUnsentInput } from '../src/ui/unsentInput'

const base = { waiting: true, dismissed: false, unsentInput: false, queueAtRisk: false }

describe('when the new-version banner shows', () => {
  it('shows when a new version is waiting and nothing is in the way', () => {
    expect(showUpdateBanner(base)).toBe(true)
  })
  it('does not show without a waiting version', () => {
    expect(showUpdateBanner({ ...base, waiting: false })).toBe(false)
  })
  it('stays away once dismissed', () => {
    expect(showUpdateBanner({ ...base, dismissed: true })).toBe(false)
  })
  it('stays away while a form holds input that is not sent', () => {
    expect(showUpdateBanner({ ...base, unsentInput: true })).toBe(false)
  })
  it('stays away while a reload would lose updates kept only in memory', () => {
    expect(showUpdateBanner({ ...base, queueAtRisk: true })).toBe(false)
  })
})

describe('a reload that could lose queued updates', () => {
  it('is only a risk when the queue is not in durable storage and something is waiting', () => {
    expect(queueAtRisk(false, 2)).toBe(true)
    expect(queueAtRisk(false, 0)).toBe(false)
    expect(queueAtRisk(true, 5)).toBe(false)
  })
})

describe('a version counts as waiting', () => {
  it('only when it is installed and an older version is running the page', () => {
    expect(isUpdateWaiting('installed', true)).toBe(true)
    // The very first install has no controller: nothing to update, nothing to ask.
    expect(isUpdateWaiting('installed', false)).toBe(false)
    expect(isUpdateWaiting('installing', true)).toBe(false)
    expect(isUpdateWaiting('activated', true)).toBe(false)
  })
})

describe('when to reload after the new version takes over', () => {
  const ok = { asked: true, reloadedThisPage: false, lastReloadAt: null, now: 1_000_000 }
  it('reloads once after the person asked', () => {
    expect(shouldReloadOnTakeover(ok)).toBe(true)
  })
  it('never reloads on its own: the first install and another tab updating also change the controller', () => {
    expect(shouldReloadOnTakeover({ ...ok, asked: false })).toBe(false)
  })
  it('never reloads twice on one page', () => {
    expect(shouldReloadOnTakeover({ ...ok, reloadedThisPage: true })).toBe(false)
  })
  it('never loops: a reload that just happened blocks another within the window', () => {
    expect(shouldReloadOnTakeover({ ...ok, lastReloadAt: ok.now - 5_000 })).toBe(false)
    expect(shouldReloadOnTakeover({ ...ok, lastReloadAt: ok.now - SW_RELOAD_WINDOW_MS - 1 })).toBe(true)
  })
})

describe('asking the browser for a newer version', () => {
  it('checks on the first return and then at most every half hour', () => {
    expect(shouldCheckForUpdate(null, 5)).toBe(true)
    expect(shouldCheckForUpdate(1_000, 1_000 + SW_CHECK_EVERY_MS - 1)).toBe(false)
    expect(shouldCheckForUpdate(1_000, 1_000 + SW_CHECK_EVERY_MS)).toBe(true)
  })
})

describe('input a form has not sent yet', () => {
  it('is on while any form says so and off when all have cleared it', () => {
    clearUnsentInput()
    expect(hasUnsentInput()).toBe(false)
    setUnsentInput('update', true)
    expect(hasUnsentInput()).toBe(true)
    setUnsentInput('update', false)
    expect(hasUnsentInput()).toBe(false)
  })
})

describe('the worker and the page agree', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  it('the worker skips waiting only when asked, never by itself', () => {
    expect(sw).toMatch(/addEventListener\('message'[\s\S]*SKIP_WAITING[\s\S]*self\.skipWaiting\(\)/)
    // Exactly one call, and it is the one inside the message handler.
    expect(sw.match(/self\.skipWaiting\(\)/g)).toHaveLength(1)
    const before = sw.slice(0, sw.indexOf("addEventListener('message'"))
    expect(before).not.toMatch(/skipWaiting\(\)/)
  })
})
