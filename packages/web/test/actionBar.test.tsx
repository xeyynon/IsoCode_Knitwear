// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ActionBar } from '../src/ui/molecules/ActionBar'
import { getBottomSlot, setBottomSlot, subscribeBottomSlot } from '../src/ui/bottomSlot'

// UI/UX plan, slice 1.1. The ActionBar shows what it is given, and publishes a slot that the "new version is ready" bar
// draws itself into, so the two never sit on top of each other.
afterEach(() => { cleanup(); setBottomSlot(null) })

describe('ActionBar', () => {
  it('shows its children, in the order given', () => {
    const { container } = render(<ActionBar><p>saved</p><button>Send</button></ActionBar>)
    const bar = container.querySelector('.actionbar')!
    expect([...bar.children].map((c) => c.tagName)).toEqual(['DIV', 'P', 'BUTTON'])   // the slot first, then the children as given
    expect(bar.textContent).toBe('savedSend')
  })

  it('publishes its slot while it is on screen, and withdraws it when it leaves', () => {
    expect(getBottomSlot()).toBeNull()
    const { container, unmount } = render(<ActionBar><button>Send</button></ActionBar>)
    expect(getBottomSlot()).toBe(container.querySelector('.actionbar__slot'))
    unmount()
    expect(getBottomSlot()).toBeNull()
  })

  it('tells a listener when the slot appears and goes', () => {
    let calls = 0
    const stop = subscribeBottomSlot(() => { calls++ })
    const { unmount } = render(<ActionBar><button>Send</button></ActionBar>)
    expect(calls).toBe(1)
    unmount()
    expect(calls).toBe(2)
    stop()
  })
})
