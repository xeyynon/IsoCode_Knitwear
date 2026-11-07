import { DUMMY_HASH, signToken, verifySecret, type TokenClaims } from './auth.js'
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

/** Ten digits; accepts +91 and spaces. */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  return /^\d{10}$/.test(ten) ? ten : null
}

interface Row {
  id: string; role: 'merchandiser' | 'supervisor'; password_hash: string | null; pin_hash: string | null
  unit_id: string | null; failed_attempts: number; locked: boolean; token_version: number; disabled: boolean
}

/**
 * Check credentials. A wrong password and an unknown account give the same message and
 * take the same time. After MAX_FAILED_ATTEMPTS wrong tries an account is locked for
 * LOCK_MINUTES (a 4-digit PIN has only 10,000 values, so this limit is what protects it).
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
  if (lookup.key.includes(String.fromCharCode(0)) || lookup.secret.includes(String.fromCharCode(0))) { verifySecret(lookup.secret, DUMMY_HASH); throw INVALID() }

  // Throwing inside db.tx rolls the transaction back, which would undo the failed-attempt
  // counter. So decide inside, throw outside.
  const outcome = await db.tx({ role: 'auth' }, async (tx) => {
    const found = (await tx.query<Row>(
      `select id::text as id, role, password_hash, pin_hash, unit_id::text as unit_id, failed_attempts,
              coalesce(locked_until > $2::timestamptz, false) as locked, token_version, disabled_at is not null as disabled
         from account where ${lookup.sql}`, [lookup.key, now.toISOString()]))[0]
    // A stopped account answers exactly like an unknown one, and costs the same time.
    if (!found || found.disabled) { verifySecret(lookup.secret, DUMMY_HASH); return { kind: 'invalid' as const } }
    if (found.locked) return { kind: 'locked' as const }
    if (!verifySecret(lookup.secret, found[field])) {
      // Count in the database, not from the row read above: wrong PINs sent at the same moment
      // would otherwise each write the same "count + 1", and the lock would never come.
      // A lock that has run out starts the count again, so the account gets five fresh tries.
      await tx.query(
        `update account set failed_attempts = case when locked_until <= $3::timestamptz then 1 else failed_attempts + 1 end,
                locked_until = case when locked_until <= $3::timestamptz then null
                                    when failed_attempts + 1 >= $2::int then $3::timestamptz + make_interval(mins => $4::int) else locked_until end
          where id = $1`, [found.id, MAX_FAILED_ATTEMPTS, now.toISOString(), LOCK_MINUTES])
      return { kind: 'invalid' as const }
    }
    await tx.query(`update account set failed_attempts = 0, locked_until = null where id = $1`, [found.id])
    return { kind: 'ok' as const, account: found }
  })

  if (outcome.kind === 'locked') throw new AppError(429, 'locked', `Too many wrong attempts. Try again in ${LOCK_MINUTES} minutes.`)
  if (outcome.kind === 'invalid') throw INVALID()

  const { account } = outcome
  const ttlSeconds = account.role === 'supervisor' ? SUPERVISOR_TOKEN_DAYS * 86_400 : MERCHANDISER_TOKEN_HOURS * 3_600
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds
  const claims: TokenClaims = { sub: account.id, role: account.role, exp, ver: account.token_version, ...(account.unit_id ? { unitId: account.unit_id } : {}) }
  return { token: signToken(claims, secret), role: account.role, expiresAt: new Date(exp * 1000).toISOString() }
}
