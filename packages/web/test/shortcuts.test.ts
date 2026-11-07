import { describe, expect, it } from 'vitest'
import { IDLE, isTypingTarget, routeFor, SEQUENCE_MS, shortcutsOn, stepShortcut, type KeyFacts, type SequenceState } from '../src/ui/shortcutKeys'

const press = (key: string, extra: Partial<KeyFacts> = {}): KeyFacts => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...extra })

/** Press keys one after another, `gap` ms apart, and return every action that fired. */
function run(keys: string[], gap = 100): { actions: (string | null)[]; state: SequenceState } {
  let state = IDLE
  let now = 1000
  const actions: (string | null)[] = []
  for (const k of keys) {
    const r = stepShortcut(state, press(k), now)
    state = r.state
    actions.push(r.action)
    now += gap
  }
  return { actions, state }
}

describe('single keys', () => {
  it('"/" focuses the search and "?" opens the help', () => {
    expect(stepShortcut(IDLE, press('/'), 0)).toMatchObject({ action: 'search', handled: true })
    expect(stepShortcut(IDLE, press('?'), 0)).toMatchObject({ action: 'help', handled: true })
  })
  it('an ordinary letter does nothing and is left alone', () => {
    expect(stepShortcut(IDLE, press('x'), 0)).toMatchObject({ action: null, handled: false })
    expect(stepShortcut(IDLE, press('b'), 0)).toMatchObject({ action: null, handled: false })
  })
})

describe('"g" then a letter', () => {
  it('g b goes to the board, g r to review, g s to setup', () => {
    expect(run(['g', 'b']).actions).toEqual([null, 'board'])
    expect(run(['g', 'r']).actions).toEqual([null, 'review'])
    expect(run(['g', 's']).actions).toEqual([null, 'setup'])
  })
  it('the first "g" waits and is not an action by itself', () => {
    const r = stepShortcut(IDLE, press('g'), 500)
    expect(r.action).toBeNull()
    expect(r.state).toEqual({ first: 'g', at: 500 })
  })
  it('the sequence is used up: a second "b" does nothing', () => {
    expect(run(['g', 'b', 'b']).actions).toEqual([null, 'board', null])
  })
  it('works right up to the timeout and not after it', () => {
    expect(run(['g', 'b'], SEQUENCE_MS).actions).toEqual([null, 'board'])
    expect(run(['g', 'b'], SEQUENCE_MS + 1).actions).toEqual([null, null])
  })
  it('a late second key starts over rather than counting as the old sequence', () => {
    // g ... (too late) g b: the second g begins a new sequence that a prompt b completes.
    const first = stepShortcut(IDLE, press('g'), 0)
    const again = stepShortcut(first.state, press('g'), SEQUENCE_MS + 1)
    expect(again.state).toEqual({ first: 'g', at: SEQUENCE_MS + 1 })
    expect(stepShortcut(again.state, press('b'), SEQUENCE_MS + 50).action).toBe('board')
  })
  it('a wrong second key cancels the sequence', () => {
    expect(run(['g', 'x', 'b']).actions).toEqual([null, null, null])
  })
  it('a second key that is itself a shortcut still works', () => {
    expect(run(['g', '/']).actions).toEqual([null, 'search'])
    expect(run(['g', '?']).actions).toEqual([null, 'help'])
  })
  it('g g b still ends on the board: the second g restarts the wait', () => {
    expect(run(['g', 'g', 'b']).actions).toEqual([null, null, 'board'])
  })
  it('a completed sequence asks the browser to leave the key alone', () => {
    const first = stepShortcut(IDLE, press('g'), 0)
    expect(stepShortcut(first.state, press('r'), 10).handled).toBe(true)
  })
})

describe('modifier keys', () => {
  it('Ctrl, Cmd or Alt with a key is the browser\'s own shortcut and is ignored', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey'] as const) {
      expect(stepShortcut(IDLE, press('/', { [mod]: true }), 0)).toMatchObject({ action: null, handled: false })
      expect(stepShortcut(IDLE, press('g', { [mod]: true }), 0).state).toEqual(IDLE)
    }
  })
  it('Ctrl+B after g does not complete the sequence, and does not cancel it either', () => {
    const g = stepShortcut(IDLE, press('g'), 0)
    const ctrlB = stepShortcut(g.state, press('b', { ctrlKey: true }), 10)
    expect(ctrlB.action).toBeNull()
    expect(ctrlB.state).toEqual(g.state)
    expect(stepShortcut(ctrlB.state, press('b'), 20).action).toBe('board')
  })
  it('pressing Shift on its way to "?" does not break the wait', () => {
    const g = stepShortcut(IDLE, press('g'), 0)
    const shift = stepShortcut(g.state, press('Shift'), 5)
    expect(shift.state).toEqual(g.state)
    expect(shift.action).toBeNull()
  })
  it('a capital letter is a different key, not a shortcut', () => {
    expect(run(['g', 'B']).actions).toEqual([null, null])
    expect(run(['G', 'b']).actions).toEqual([null, null])
  })
})

describe('where a key is typed', () => {
  it('an input, a textarea or a select is typing', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true)
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true)
  })
  it('an editable region is typing', () => {
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })
  it('a button, a link or the page itself is not', () => {
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTypingTarget({ tagName: 'A' })).toBe(false)
    expect(isTypingTarget({ tagName: 'BODY', isContentEditable: false })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('who gets shortcuts', () => {
  it('a merchandiser on a merchandiser screen', () => {
    for (const p of ['/board', '/review', '/setup', '/orders/new', '/orders/abc']) expect(shortcutsOn('merchandiser', p)).toBe(true)
  })
  it('never a supervisor', () => {
    for (const p of ['/today', '/today/o1/cutting', '/board']) expect(shortcutsOn('supervisor', p)).toBe(false)
  })
  it('never someone signed out', () => {
    expect(shortcutsOn(undefined, '/board')).toBe(false)
  })
  it('never on the buyer page or the public pages, even for a merchandiser', () => {
    for (const p of ['/buyer', '/login', '/status']) expect(shortcutsOn('merchandiser', p)).toBe(false)
  })
})

describe('where each shortcut goes', () => {
  it('maps the three go-to actions to their screens and nothing else', () => {
    expect(routeFor('board')).toBe('/board')
    expect(routeFor('review')).toBe('/review')
    expect(routeFor('setup')).toBe('/setup')
    expect(routeFor('search')).toBeNull()
    expect(routeFor('help')).toBeNull()
  })
})
