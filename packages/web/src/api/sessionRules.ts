// Pure rules for the session, kept apart from the browser so they can be tested.
// The server is the security boundary; nothing here is trusted for access control.
export type Role = 'merchandiser' | 'supervisor'

export interface Claims { role: Role; exp: number; sub?: string }

/** Read the claims out of a token for UX only (which screen to show, when it expires). Never a security check. */
export function decodeClaims(token: string | null | undefined): Claims | null {
  if (!token) return null
  const body = token.split('.')[0]
  if (!body) return null
  try {
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))) as Partial<Claims> & { sub?: unknown }
    if ((json.role !== 'merchandiser' && json.role !== 'supervisor') || typeof json.exp !== 'number') return null
    return { role: json.role, exp: json.exp, ...(typeof json.sub === 'string' ? { sub: json.sub } : {}) }
  } catch {
    return null
  }
}

export const isExpired = (c: Claims, nowMs: number): boolean => c.exp * 1000 <= nowMs

/** Supervisors stay signed in on their own phone; merchandisers' sessions die with the tab. */
export const storeKind = (role: Role): 'local' | 'session' => (role === 'supervisor' ? 'local' : 'session')

export const homeFor = (role: Role): string => (role === 'supervisor' ? '/today' : '/board')

export type SignInFailure = 'rejected' | 'locked' | 'rate_limited' | 'unreachable' | 'invalid'

/** Plain, actionable text. Never prints the server address. */
export function signInMessage(kind: SignInFailure, serverMessage?: string): string {
  switch (kind) {
    case 'rejected': return 'Incorrect details. Check and try again.'
    case 'locked': return serverMessage ?? 'Too many wrong attempts. Try again in 15 minutes.'
    case 'rate_limited': return 'Too many attempts. Please wait a few minutes.'
    case 'invalid': return serverMessage ?? 'Please fill in every field.'
    default: return 'Cannot reach the server right now. Check your connection and try again.'
  }
}
