import net from 'node:net'

// The sign-in budget per caller address (BE-044, BE-045, O-12).
//
// WHO the caller is: `req.ip`, which Fastify works out from the TRUST_PROXY setting. With a hop count (1 = one reverse proxy in front)
// or a list of proxy addresses it is the address the nearest trusted proxy saw, taken from the END of X-Forwarded-For, where the
// proxies add theirs; whatever the caller wrote at the front is ignored. This file only tidies that address into a key.
//
// HOW MUCH memory: an entry exists only while a failed try is on record, it is removed when its window ends (a sweep on a timer that
// does not keep the process alive) or when the last failure is given back, and the map has a hard size cap.

/** Failed sign-ins per address per window. */
export const LOGIN_BUDGET = 10
export const LOGIN_WINDOW_MS = 15 * 60_000
/** Most addresses remembered at once. About 200 bytes each, so 10,000 is about 2 MB at the very most. */
export const LOGIN_MAX_ENTRIES = 10_000
export const LOGIN_SWEEP_MS = 60_000

/**
 * The key one caller is counted under. An IPv4-mapped IPv6 address ("::ffff:1.2.3.4") is the IPv4 address; any other IPv6 address
 * is counted by its /64 (one home or one phone is given a whole /64, so counting single addresses would let one caller have 2^64
 * budgets). Anything that is not an address at all is counted as itself, shortened.
 */
export function limiterKey(ip: string): string {
  const raw = String(ip ?? '').trim().toLowerCase().split('%')[0]!   // a zone id ("fe80::1%eth0") is not part of the address
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw)
  if (mapped && net.isIPv4(mapped[1]!)) return mapped[1]!
  if (net.isIPv4(raw)) return raw
  if (net.isIPv6(raw)) {
    const groups = expandV6(raw)
    if (groups) return `${groups.slice(0, 4).join(':')}::/64`
  }
  return raw.slice(0, 64)
}

/** The eight 16-bit groups of an IPv6 address as unpadded lower-case hex, or null if it cannot be read. */
function expandV6(a: string): string[] | null {
  let s = a
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s)
  if (v4) {
    const p = v4[1]!.split('.').map(Number)
    if (p.some((n) => n > 255)) return null
    s = s.slice(0, v4.index) + ((p[0]! << 8) | p[1]!).toString(16) + ':' + ((p[2]! << 8) | p[3]!).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - tail.length
  if (halves.length === 1 ? head.length !== 8 : fill < 0) return null
  const all = halves.length === 1 ? head : [...head, ...Array<string>(fill).fill('0'), ...tail]
  return all.map((g) => parseInt(g || '0', 16).toString(16))
}

interface Slot { count: number; resetAt: number }

export interface LoginLimiter {
  /** True when this address has used its budget in the current window. Creates nothing. */
  blocked(ip: string, nowMs: number): boolean
  /** Spend one try BEFORE the work starts (so a burst in flight together cannot all pass `blocked`). Returns what to give back. */
  spend(ip: string, nowMs: number): Spent
  /** Entries held right now (for tests and for the operator). */
  readonly size: number
  /** Drop every entry whose window has ended. Returns how many went. */
  sweep(nowMs: number): number
  /** Start the periodic sweep on a timer that never keeps the process alive. Returns a function that stops it. */
  start(now: () => number, everyMs?: number): () => void
}

/** What `spend` hands back: give the try back (the attempt was not a failure) or keep it. */
export interface Spent { refund(): void }

export function createLoginLimiter(budget = LOGIN_BUDGET, windowMs = LOGIN_WINDOW_MS, maxEntries = LOGIN_MAX_ENTRIES): LoginLimiter {
  const slots = new Map<string, Slot>()   // insertion order = least recently spent first, so the cap drops the stalest

  const sweep = (nowMs: number): number => {
    let gone = 0
    for (const [k, s] of slots) if (s.resetAt <= nowMs) { slots.delete(k); gone++ }
    return gone
  }

  return {
    get size() { return slots.size },
    sweep,
    blocked(ip, nowMs) {
      const s = slots.get(limiterKey(ip))
      return !!s && s.resetAt > nowMs && s.count >= budget
    },
    spend(ip, nowMs) {
      const key = limiterKey(ip)
      let slot = slots.get(key)
      if (!slot || slot.resetAt <= nowMs) {
        if (!slot && slots.size >= maxEntries) {
          sweep(nowMs)
          // Still full of live entries: forget the one spent on longest ago rather than grow.
          while (slots.size >= maxEntries) slots.delete(slots.keys().next().value as string)
        }
        slot = { count: 0, resetAt: nowMs + windowMs }
      }
      slot.count++
      slots.delete(key)   // re-insert: most recently spent goes last
      slots.set(key, slot)
      const mine = slot
      return {
        refund() {
          mine.count--
          // The last failure given back leaves nothing to remember: drop the entry (only if it is still this window's).
          if (mine.count <= 0 && slots.get(key) === mine) slots.delete(key)
        },
      }
    },
    start(now, everyMs = LOGIN_SWEEP_MS) {
      const timer = setInterval(() => { sweep(now()) }, everyMs)
      timer.unref()
      return () => clearInterval(timer)
    },
  }
}
