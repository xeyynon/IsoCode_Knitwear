// Secrets and tokens using only node:crypto. No user table beyond `account`, no sessions
// table: a token is a stateless HMAC-signed claim. Consequence: a deleted or locked
// account stays valid until its token expires (12 h merchandiser, 30 days supervisor).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

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

/** Verified against when the account does not exist, so a miss costs the same time as a wrong password. */
export const DUMMY_HASH = hashSecret('not-a-real-secret')

export interface TokenClaims {
  sub: string                    // account id
  role: 'merchandiser' | 'supervisor'
  unitId?: string
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
