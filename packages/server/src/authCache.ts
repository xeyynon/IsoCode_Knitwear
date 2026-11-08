// A short-lived, in-process memory of what the sign-in check needs per account (O-5): the token version, whether the account is
// stopped, and its unit. Without it every request opens a whole database transaction (4 round trips) just to read that row.
//
// WHEN IT IS WRONG: never in the process that made the change (sign-out everywhere, stop/allow, PIN reset, a new account: the route
// calls `invalidate` as soon as its transaction has ended, and any lookup already running when that happens is not stored). A SECOND
// server process, or a change made directly in the database (for example moving a supervisor to another unit with SQL), is seen
// within `ttlMs` (default 5 seconds). `ttlMs` 0 switches the memory off: every request asks the database, as before.

export interface AccountState { token_version: number; disabled: boolean; unit_id: string | null }

export const AUTH_CACHE_MS = 5_000
export const AUTH_CACHE_MAX = 2_000

export interface AuthCache {
  /** The account's state: from memory when fresh, otherwise `load()`. Requests for one account that miss together share one load. */
  lookup(id: string, load: () => Promise<AccountState | undefined>): Promise<AccountState | undefined>
  /** Forget one account (or everything), now. Anything being loaded at this moment is not stored when it finishes. */
  invalidate(id?: string): void
  readonly size: number
  readonly ttlMs: number
}

export function createAuthCache(ttlMs: number = AUTH_CACHE_MS, maxEntries: number = AUTH_CACHE_MAX, now: () => number = Date.now): AuthCache {
  const entries = new Map<string, { at: number; state: AccountState }>()   // insertion order = oldest first
  const loading = new Map<string, Promise<AccountState | undefined>>()
  let generation = 0
  const norm = (id: string) => String(id).toLowerCase()   // the database compares uuids, not spellings

  return {
    ttlMs,
    get size() { return entries.size },
    invalidate(id) {
      generation++
      if (id === undefined) { entries.clear(); return }
      entries.delete(norm(id))
    },
    async lookup(rawId, load) {
      if (!(ttlMs > 0)) return load()
      const id = norm(rawId)
      const hit = entries.get(id)
      if (hit) {
        if (now() - hit.at < ttlMs) return hit.state
        entries.delete(id)
      }
      const gen = generation
      const key = `${gen}:${id}`   // a lookup that began before an invalidation is never shared with one that began after
      let pending = loading.get(key)
      if (!pending) {
        pending = load().finally(() => { loading.delete(key) })
        loading.set(key, pending)
      }
      const state = await pending
      if (state && gen === generation) {
        if (entries.size >= maxEntries && !entries.has(id)) entries.delete(entries.keys().next().value as string)
        entries.set(id, { at: now(), state })
      }
      return state
    },
  }
}
