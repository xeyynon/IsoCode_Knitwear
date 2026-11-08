// Secrets and tokens using only node:crypto. No user table beyond `account`, no sessions
// table: a token is a stateless HMAC-signed claim. Consequence: a deleted or locked
// account stays valid until its token expires (12 h merchandiser, 30 days supervisor).
import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'
import { AppError } from './errors.js'

const SCRYPT_N = 16384
const KEYLEN = 32

/** `scrypt$N$salt$hash` (base64url). */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(secret, salt, KEYLEN, { N: SCRYPT_N })
  return `scrypt$${SCRYPT_N}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export function verifySecret(secret: string, stored: string | null | undefined): boolean {
  const [scheme, n, salt, hash] = (stored ?? '').split('$')
  if (scheme !== 'scrypt' || !n || !salt || !hash) return false
  const want = Buffer.from(hash, 'base64url')
  const got = scryptSync(secret, Buffer.from(salt, 'base64url'), want.length, { N: Number(n) })
  return got.length === want.length && timingSafeEqual(got, want)
}

// ---- the same checks without stopping the server (BE-034)
//
// scryptSync holds the one JavaScript thread for about 45 ms per call, so about 22 sign-in tries a second would freeze the
// whole API. Sign-in uses these instead: crypto.scrypt runs on libuv's thread pool. At most `concurrency` run at once; the
// next `maxQueue` wait for a slot, and beyond that a try is refused with 503 (the person tries again in a moment) instead
// of piling up memory and database connections. hashSecret / verifySecret above stay synchronous for the admin code.
const limits = { concurrency: 4, maxQueue: 64 }
let running = 0
const waiting: Array<() => void> = []

/** Test hook: change the limits; the returned function puts the old ones back. */
export function setHashLimits(next: { concurrency?: number; maxQueue?: number }): () => void {
  const old = { ...limits }
  if (next.concurrency !== undefined) limits.concurrency = next.concurrency
  if (next.maxQueue !== undefined) limits.maxQueue = next.maxQueue
  return () => { Object.assign(limits, old) }
}
/** How many hashes are running and how many are waiting for a slot. */
export const hashLoad = (): { running: number; waiting: number } => ({ running, waiting: waiting.length })

async function inSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= limits.concurrency) {
    if (waiting.length >= limits.maxQueue) throw new AppError(503, 'busy', 'The server is busy. Please try again in a moment.')
    await new Promise<void>((resolve) => waiting.push(resolve))   // the slot is handed over below, so `running` stays counted
  } else {
    running++
  }
  try {
    return await work()
  } finally {
    const next = waiting.shift()
    if (next) next(); else running--
  }
}

const scryptAsync = (secret: string, salt: Buffer, keylen: number, N: number): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(secret, salt, keylen, { N }, (err, key) => (err ? reject(err) : resolve(key))))

/** Same result as hashSecret, computed on the thread pool. */
export function hashSecretAsync(secret: string): Promise<string> {
  return inSlot(async () => {
    const salt = randomBytes(16)
    const hash = await scryptAsync(secret, salt, KEYLEN, SCRYPT_N)
    return `scrypt$${SCRYPT_N}$${salt.toString('base64url')}$${hash.toString('base64url')}`
  })
}

/** Same answer as verifySecret, computed on the thread pool. Throws AppError 503 when too many checks are already waiting. */
export function verifySecretAsync(secret: string, stored: string | null | undefined): Promise<boolean> {
  const [scheme, n, salt, hash] = (stored ?? '').split('$')
  if (scheme !== 'scrypt' || !n || !salt || !hash) return Promise.resolve(false)
  const want = Buffer.from(hash, 'base64url')
  return inSlot(async () => {
    const got = await scryptAsync(secret, Buffer.from(salt, 'base64url'), want.length, Number(n))
    return got.length === want.length && timingSafeEqual(got, want)
  })
}

/** Verified against when the account does not exist, so a miss costs the same time as a wrong password. */
export const DUMMY_HASH = hashSecret('not-a-real-secret')

export interface TokenClaims {
  sub: string                    // account id
  role: 'merchandiser' | 'supervisor'
  unitId?: string
  /** The account's token_version when this was made. Raising it in the database signs the person out everywhere. */
  ver?: number
  exp: number                    // seconds since epoch
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')
const mac = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest()

export function signToken(claims: TokenClaims, secret: string): string {
  const body = b64(JSON.stringify(claims))
  return `${body}.${b64(mac(body, secret))}`
}

export function verifyToken(token: string, secret: string, now: Date): TokenClaims | null {
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined) return null
  const want = mac(body, secret)
  const got = Buffer.from(sig, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenClaims
    if (typeof c.exp !== 'number' || c.exp * 1000 <= now.getTime()) return null
    if (c.role !== 'merchandiser' && c.role !== 'supervisor') return null
    if (c.role === 'supervisor' && !c.unitId) return null
    return c
  } catch {
    return null
  }
}
