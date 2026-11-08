import { DUMMY_HASH, signToken, verifySecretAsync, type TokenClaims } from './auth.js'
import type { Db } from './db.js'
import { AppError, badRequest } from './errors.js'

export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MINUTES = 15
const MERCHANDISER_TOKEN_HOURS = 12
const SUPERVISOR_TOKEN_DAYS = 30   // supervisors stay signed in

export type LoginInput =
  | { email: string; password: string }
  | { phone: string; pin: string }

export interface LoginResult {
  token: string
  role: 'merchandiser' | 'supervisor'
  expiresAt: string
}

const INVALID = () => new AppError(401, 'invalid_credentials', 'Incorrect details')

/** "15 minutes", "1 minute": the time left on a lock, rounded UP so it is never "0 minutes", and at most the full lock. (BE-070) */
export function minutesLeft(msLeft: number): string {
  const n = Math.min(LOCK_MINUTES, Math.max(1, Math.ceil((Number.isFinite(msLeft) ? msLeft : LOCK_MINUTES * 60_000) / 60_000)))
  return `${n} minute${n === 1 ? '' : 's'}`
}

/** What a person sees when the account (or the name they typed) is locked. The same words for a real account and for a name with none. */
const LOCKED = (msLeft: number) => new AppError(429, 'locked', `Too many wrong attempts. Try again in ${minutesLeft(msLeft)}. If you forgot your PIN or password, ask your merchandiser to reset it.`)

/** Ten digits; accepts +91 and spaces. */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  return /^\d{10}$/.test(ten) ? ten : null
}

interface Row {
  id: string; role: 'merchandiser' | 'supervisor'; password_hash: string | null; pin_hash: string | null
  unit_id: string | null; failed_attempts: number; locked: boolean; lock_secs: number; token_version: number; disabled: boolean
}

// ---- tries against names that have no account (BE-033)
//
// A real account locks after MAX_FAILED_ATTEMPTS wrong tries. If an unknown phone or email never locked, "locked" would tell an
// attacker that the phone has an account. So wrong tries for a name with no account (or a stopped account) are counted here, in
// memory, and lock the same way, for the same time, with the same answer. Memory is bounded: when the table is full the key that was
// touched longest ago is forgotten, so an attacker sending a flood of different names cannot grow it, and a forgotten key only
// gets fresh tries. It is per process; a restart forgets everything (a real account's lock is in the database and is kept).
export interface FailureTracker {
  /** Is this key locked at `nowMs`? */
  isLocked(key: string, nowMs: number): boolean
  /** Milliseconds of lock left at `nowMs` (0 when not locked). */
  lockLeftMs(key: string, nowMs: number): number
  /** Count one wrong try. Like the account rule: the try after a lock has run out starts a new count at 1. */
  recordFailure(key: string, nowMs: number): void
  readonly size: number
}

export function createFailureTracker(maxEntries = 10_000): FailureTracker {
  const seen = new Map<string, { count: number; lockedUntil: number }>()   // insertion order = least recently touched first
  return {
    isLocked(key, nowMs) {
      const e = seen.get(key)
      return e !== undefined && e.lockedUntil > nowMs
    },
    lockLeftMs(key, nowMs) {
      const e = seen.get(key)
      return e !== undefined && e.lockedUntil > nowMs ? e.lockedUntil - nowMs : 0
    },
    recordFailure(key, nowMs) {
      const e = seen.get(key)
      seen.delete(key)
      let next: { count: number; lockedUntil: number }
      if (!e) next = { count: 1, lockedUntil: 0 }
      else if (e.lockedUntil > 0 && e.lockedUntil <= nowMs) next = { count: 1, lockedUntil: 0 }
      else next = { count: e.count + 1, lockedUntil: e.lockedUntil }
      if (next.lockedUntil === 0 && next.count >= MAX_FAILED_ATTEMPTS) next.lockedUntil = nowMs + LOCK_MINUTES * 60_000
      seen.set(key, next)
      while (seen.size > maxEntries) seen.delete(seen.keys().next().value as string)
    },
    get size() { return seen.size },
  }
}

// One table per Db object: the production process has one, and a test that builds its own Db starts clean.
const trackers = new WeakMap<Db, FailureTracker>()
const trackerFor = (db: Db): FailureTracker => {
  let t = trackers.get(db)
  if (!t) { t = createFailureTracker(); trackers.set(db, t) }
  return t
}

/**
 * Check credentials. A wrong password and an unknown account give the same message and
 * take the same time. After MAX_FAILED_ATTEMPTS wrong tries an account is locked for
 * LOCK_MINUTES (a 4-digit PIN has only 10,000 values, so this limit is what protects it).
 * A locked account, an unknown name and a stopped account that has been tried as often all give the same answer,
 * and every answer except a refusal for a malformed request costs one hash.
 */
export async function login(db: Db, input: LoginInput, secret: string, now: Date): Promise<LoginResult> {
  let lookup: { sql: string; key: string; secret: string }
  if ('email' in input) {
    if (typeof input.email !== 'string' || typeof input.password !== 'string' || !input.email || !input.password) throw badRequest('Email and password are required')
    lookup = { sql: `role = 'merchandiser' and lower(email) = lower($1)`, key: input.email.trim(), secret: input.password }
  } else {
    const phone = typeof input.phone === 'string' ? normalisePhone(input.phone) : null
    if (!phone || typeof input.pin !== 'string' || !/^\d{4}$/.test(input.pin)) throw badRequest('Phone number and 4-digit PIN are required')
    lookup = { sql: `role = 'supervisor' and phone = $1`, key: phone, secret: input.pin }
  }
  const field = 'email' in input ? 'password_hash' : 'pin_hash'
  // No account can have a zero character in its email or password, and the database cannot store one: answer as for any wrong detail.
  if (lookup.key.includes(String.fromCharCode(0)) || lookup.secret.includes(String.fromCharCode(0))) { await verifySecretAsync(lookup.secret, DUMMY_HASH); throw INVALID() }

  const nowMs = now.getTime()
  const unknownKey = `${'email' in input ? 'email' : 'phone'}:${lookup.key.toLowerCase()}`
  const tracker = trackerFor(db)

  // Read the account in a short transaction. The hash check (which may have to wait for a free slot) happens outside it, so a
  // queue of sign-ins never holds database connections.
  const found = await db.tx({ role: 'auth' }, async (tx) => (await tx.query<Row>(
    `select id::text as id, role, password_hash, pin_hash, unit_id::text as unit_id, failed_attempts,
            coalesce(locked_until > $2::timestamptz, false) as locked,
            coalesce(extract(epoch from (locked_until - $2::timestamptz)), 0)::float8 as lock_secs, token_version, disabled_at is not null as disabled
       from account where ${lookup.sql}`, [lookup.key, now.toISOString()]))[0])

  // Throwing inside db.tx rolls the transaction back, which would undo the failed-attempt
  // counter. So the counter is written in its own transaction and the throw comes after it.
  if (!found || found.disabled) {
    // A stopped account answers exactly like an unknown one, and costs the same time (and locks the same way).
    await verifySecretAsync(lookup.secret, DUMMY_HASH)
    if (tracker.isLocked(unknownKey, nowMs)) throw LOCKED(tracker.lockLeftMs(unknownKey, nowMs))
    tracker.recordFailure(unknownKey, nowMs)
    throw INVALID()
  }
  if (found.locked) {
    await verifySecretAsync(lookup.secret, DUMMY_HASH)   // the same cost as every other answer
    throw LOCKED(Number(found.lock_secs) * 1000)
  }
  if (!(await verifySecretAsync(lookup.secret, found[field]))) {
    // Count in the database, not from the row read above: wrong PINs sent at the same moment
    // would otherwise each write the same "count + 1", and the lock would never come.
    // A lock that has run out starts the count again, so the account gets five fresh tries.
    await db.tx({ role: 'auth' }, (tx) => tx.query(
      `update account set failed_attempts = case when locked_until <= $3::timestamptz then 1 else failed_attempts + 1 end,
              locked_until = case when locked_until <= $3::timestamptz then null
                                  when failed_attempts + 1 >= $2::int then $3::timestamptz + make_interval(mins => $4::int) else locked_until end
        where id = $1`, [found.id, MAX_FAILED_ATTEMPTS, now.toISOString(), LOCK_MINUTES]))
    throw INVALID()
  }
  await db.tx({ role: 'auth' }, (tx) => tx.query(`update account set failed_attempts = 0, locked_until = null where id = $1`, [found.id]))

  const ttlSeconds = found.role === 'supervisor' ? SUPERVISOR_TOKEN_DAYS * 86_400 : MERCHANDISER_TOKEN_HOURS * 3_600
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds
  const claims: TokenClaims = { sub: found.id, role: found.role, exp, ver: found.token_version, ...(found.unit_id ? { unitId: found.unit_id } : {}) }
  return { token: signToken(claims, secret), role: found.role, expiresAt: new Date(exp * 1000).toISOString() }
}
