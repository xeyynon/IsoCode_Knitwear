// Pure rules for the session, kept apart from the browser so they can be tested.
// The server is the security boundary; nothing here is trusted for access control.
import { translate, type Lang } from '../i18n'

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

export type FetchFailure = 'cancelled' | 'unreachable'

/**
 * Why a fetch() threw. The caller aborting its own request is not a failure (a newer request replaced it);
 * everything else it can throw is the network: TypeError ("Failed to fetch"), a timeout, or an abort nobody asked for.
 */
export function classifyFetchError(e: unknown, callerAborted: boolean): FetchFailure {
  return (e as { name?: string } | null)?.name === 'AbortError' && callerAborted ? 'cancelled' : 'unreachable'
}

/**
 * Was this answer from something between the phone and the app (a proxy or gateway), not from the app?
 * 502, 503 and 504 say so themselves. Any other 5xx counts when the body is not the app's own JSON error:
 * the app always answers with { error: { code } }.
 */
export function isGatewayFailure(status: number, hasAppError: boolean): boolean {
  return status === 502 || status === 503 || status === 504 || (status >= 500 && !hasAppError)
}

/** A failure the reader can fix by waiting or reconnecting, as thrown by apiFetch (ApiError code 'unreachable'). */
export function isUnreachable(e: unknown): boolean {
  const x = e as { status?: unknown; code?: unknown } | null
  return !!x && typeof x === 'object' && (x.code === 'unreachable' || x.status === 0)
}

/** What a screen keeps when its load fails: the words, and whether the cause is the connection. */
export interface LoadFailure { message: string; unreachable: boolean }

/** Turn anything a load threw into a LoadFailure. The server's own message wins for a real server answer. */
export function describeFailure(e: unknown, fallback: string): LoadFailure {
  if (isUnreachable(e)) return { message: signInMessage('unreachable'), unreachable: true }
  const m = (e as { status?: unknown; message?: unknown } | null)
  return { message: typeof m?.status === 'number' && typeof m.message === 'string' && m.message ? m.message : fallback, unreachable: false }
}

export type SignInFailure ='rejected' | 'locked' | 'rate_limited' | 'unreachable' | 'invalid' | 'clock'

/**
 * Plain, actionable text. Never prints the server address. In English the server's own words win
 * where it sends any; in Tamil they are English, so the Tamil sentence is used (keeping the lock's minutes).
 */
export function signInMessage(kind: SignInFailure, serverMessage?: string, lang: Lang = 'en'): string {
  const server = lang === 'en' ? serverMessage : undefined
  switch (kind) {
    case 'rejected': return translate(lang, 'err.rejected')
    case 'locked': return server ?? translate(lang, 'err.locked', { min: /(\d+) minute/.exec(serverMessage ?? '')?.[1] ?? 15 })
    case 'rate_limited': return translate(lang, 'err.rateLimited')
    case 'invalid': return server ?? translate(lang, 'err.invalid')
    case 'clock': return translate(lang, 'err.clock')
    default: return translate(lang, 'err.unreachable')
  }
}
