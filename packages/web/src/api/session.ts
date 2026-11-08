// The one point of contact with the backend. It owns the address, the sign-in header and
// what a 401 means, so no screen can forget any of them.
import { applySignInLanguage } from '../i18n'
import { classifyFetchError, decodeClaims, isExpired, isGatewayFailure, signInMessage, storeKind, type Claims, type Role, type SignInFailure } from './sessionRules'

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? ''
const KEY = 'orders.token'

let memory: string | null = null
// Set when a token that existed stopped working (the server refused it, or it ran out), so the sign-in page can say why it is showing. Held in
// memory only: it is for the next screen, not something to keep. A deliberate sign-out and a wrong PIN never set it.
let sessionEnded = false
export const sessionEndedNotice = (): boolean => sessionEnded
export const acknowledgeSessionEnded = (): void => { sessionEnded = false }
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

// Storage can throw (private windows, blocked site data): always wrapped, and the app works without it.
const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn() } catch { return fallback } }

function readStored(): string | null {
  return safe(() => window.localStorage.getItem(KEY), null) ?? safe(() => window.sessionStorage.getItem(KEY), null)
}

export function getToken(): string | null {
  if (!memory) memory = readStored()
  const claims = decodeClaims(memory)
  if (memory && (!claims || isExpired(claims, Date.now()))) { endSession(); return null }
  return memory
}

function setToken(token: string, role: Role) {
  sessionEnded = false
  memory = token
  safe(() => { window.localStorage.removeItem(KEY); window.sessionStorage.removeItem(KEY) }, undefined)
  const kind = storeKind(role)
  safe(() => (kind === 'local' ? window.localStorage : window.sessionStorage).setItem(KEY, token), undefined)
  notify()
}

export function clearToken() {
  memory = null
  safe(() => { window.localStorage.removeItem(KEY); window.sessionStorage.removeItem(KEY) }, undefined)
  notify()
}

/** The token stopped working: sign out, and remember to say so on the sign-in page. */
export function endSession() {
  sessionEnded = true
  clearToken()
}

export const signOut = () => { sessionEnded = false; clearToken() }
export const getClaims = (): Claims | null => decodeClaims(getToken())

/** For useSyncExternalStore. */
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const snapshot = (): string | null => getToken()

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

/** Fetch an API route with the token attached. Any 401 signs the user out so the app returns to the login screen. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    })
  } catch (e) {
    // The caller cancelling its own request is theirs to handle; anything else thrown here is the connection.
    if (classifyFetchError(e, !!init.signal?.aborted) === 'cancelled') throw e
    throw new ApiError(0, 'unreachable', signInMessage('unreachable'))
  }
  if (res.status === 401) { if (token) endSession(); else clearToken() }   // no token means a sign-in that was refused: not a session that ended
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
  // A proxy or gateway page is the connection failing, not the app answering. The real status is kept (the sync queue reads it).
  if (!res.ok && isGatewayFailure(res.status, !!body?.error?.code)) throw new ApiError(res.status, 'unreachable', signInMessage('unreachable'))
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? 'Something went wrong. Please try again.')
  return body as T
}

/** Fetch a file (a photo) with the sign-in header. An <img> tag cannot send headers, so the bytes are fetched here. */
export async function apiBlob(path: string, headerToken?: string): Promise<Blob> {
  const token = headerToken ?? getToken()
  let res: Response
  try { res = await fetch(`${API_BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }) }
  catch { throw new ApiError(0, 'unreachable', signInMessage('unreachable')) }
  if (res.status === 401 && !headerToken) { if (token) endSession(); else clearToken() }
  if (!res.ok) throw new ApiError(res.status, isGatewayFailure(res.status, false) ? 'unreachable' : 'error', 'That picture could not be loaded.')
  return res.blob()
}

export type SignInResult = { ok: true; role: Role } | { ok: false; kind: SignInFailure; message: string }

const KIND_BY_CODE: Record<string, SignInFailure> = {
  invalid_credentials: 'rejected', locked: 'locked', rate_limited: 'rate_limited', bad_request: 'invalid',
}

/** Never throws: separates "wrong details" from "cannot reach the server". */
export async function signIn(body: { email: string; password: string } | { phone: string; pin: string }): Promise<SignInResult> {
  try {
    const r = await apiFetch<{ token: string; role: Role }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) })
    applySignInLanguage(r.role)   // before the screen changes, so a supervisor's first screen is already in Tamil
    setToken(r.token, r.role)
    // getToken drops a token this device's clock already calls expired; say so instead of doing nothing.
    if (!getClaims()) return { ok: false, kind: 'clock', message: signInMessage('clock') }
    return { ok: true, role: r.role }
  } catch (e) {
    if (e instanceof ApiError) {
      const kind: SignInFailure = KIND_BY_CODE[e.code] ?? 'unreachable'
      return { ok: false, kind, message: signInMessage(kind, e.message) }
    }
    return { ok: false, kind: 'unreachable', message: signInMessage('unreachable') }
  }
}
