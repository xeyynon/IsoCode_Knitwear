// Keyboard shortcuts for merchandisers, as plain logic: which key does what, when a two-key
// sequence ("g" then "b") has timed out, and where a key must be left alone. The component
// (ui/Shortcuts.tsx) only reads the real key event and does what this says.

export type ShortcutAction = 'search' | 'board' | 'review' | 'setup' | 'help'

/** How long "g" waits for its second key. */
export const SEQUENCE_MS = 1500

export interface SequenceState {
  /** The first key of a sequence that is waiting, or null. */
  first: 'g' | null
  /** When that key was pressed (ms). */
  at: number
}

export const IDLE: SequenceState = { first: null, at: 0 }

/** The parts of a keyboard event the logic needs. */
export interface KeyFacts {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

export interface Step {
  state: SequenceState
  /** What to do now, if anything. */
  action: ShortcutAction | null
  /** True when the browser's own handling of the key (typing "/", Firefox quick find) must be stopped. */
  handled: boolean
}

const AFTER_G: Record<string, ShortcutAction> = { b: 'board', r: 'review', s: 'setup' }
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])

const ROUTES: Partial<Record<ShortcutAction, string>> = { board: '/board', review: '/review', setup: '/setup' }
/** The screen a go-to shortcut opens; null for the ones that stay where they are. */
export const routeFor = (action: ShortcutAction): string | null => ROUTES[action] ?? null

/** One key press. Keys with Ctrl, Cmd or Alt are the browser's own and change nothing; a bare modifier press (Shift on the way to "?") does not break a wait. */
export function stepShortcut(state: SequenceState, k: KeyFacts, now: number): Step {
  if (k.ctrlKey || k.metaKey || k.altKey || MODIFIER_KEYS.has(k.key)) return { state, action: null, handled: false }

  const waiting = state.first === 'g' && now - state.at <= SEQUENCE_MS
  if (waiting) {
    const action = AFTER_G[k.key]
    if (action) return { state: IDLE, action, handled: true }
  }
  // Anything else ends the wait and is then read as a fresh key.
  if (k.key === 'g') return { state: { first: 'g', at: now }, action: null, handled: false }
  if (k.key === '/') return { state: IDLE, action: 'search', handled: true }
  if (k.key === '?') return { state: IDLE, action: 'help', handled: true }
  return { state: IDLE, action: null, handled: false }
}

/** Typing, not commanding: a field where letters belong to the person. */
export function isTypingTarget(el: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false
  const tag = (el.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
}

/** Merchandisers only, and not on the buyer page or the public pages. The server decides access; this only decides whether keys are listened to. */
export function shortcutsOn(role: string | undefined, pathname: string): boolean {
  if (role !== 'merchandiser') return false
  return !['/buyer', '/login', '/status'].some((p) => pathname === p || pathname.startsWith(p + '/'))
}
