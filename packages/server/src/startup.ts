// Reading the start-up environment strictly. Each function either returns a usable value or throws a StartupConfigError whose
// message is plain words that name the variable (never a secret): server.ts prints it and exits. Nothing here guesses: a value
// that is not clearly understood stops the server instead of quietly changing how it behaves.
import net from 'node:net'

export class StartupConfigError extends Error {}

/**
 * PORT. Unset, empty or blank means `fallback`. Otherwise it must be a whole number from 1 to 65535 written in plain digits.
 * (Before this, an empty PORT became 0, which means "any free port", and PORT=abc ended in a stack trace.)
 */
export function parsePort(raw: string | undefined, fallback = 8787): number {
  const v = raw?.trim()
  if (!v) return fallback
  const port = /^\d{1,5}$/.test(v) ? Number(v) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new StartupConfigError(`PORT must be a whole number from 1 to 65535, not "${v.slice(0, 40)}"`)
  }
  return port
}

/** What Fastify's `trustProxy` setting accepts, except the unsafe `true` (trust every hop). */
export type TrustProxySetting = false | number | string[]

const MAX_HOPS = 10
const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal'])

function isProxyAddress(item: string): boolean {
  if (KEYWORDS.has(item)) return true
  const slash = item.indexOf('/')
  const addr = slash === -1 ? item : item.slice(0, slash)
  const family = net.isIP(addr)
  if (!family) return false
  if (slash === -1) return true
  const bits = item.slice(slash + 1)
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (family === 4 ? 32 : 128)
}

/**
 * TRUST_PROXY: how many reverse proxies sit in front of this server, or which addresses they have.
 *   unset, empty, 0, false        no proxy: the address of the TCP connection is the caller
 *   1 (or true)                   one proxy in front, the usual case: the address that proxy saw is the caller
 *   2 to 10                       that many proxies in a row
 *   10.0.0.0/8,192.168.1.5        a list of proxy addresses or ranges (also loopback, linklocal, uniquelocal)
 * A count or a list means the caller's address is taken from the end of X-Forwarded-For, where the proxies add theirs, not from the
 * front, which the caller writes. Anything else is refused: a wrong value used to be taken as "no proxy" and put every user of the
 * app in one sign-in bucket, so ten wrong tries from anyone locked everyone out.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const v = raw?.trim()
  if (!v) return false
  const lower = v.toLowerCase()
  if (lower === '0' || lower === 'false') return false
  if (lower === 'true') return 1
  if (/^\d+$/.test(v)) {
    const hops = Number(v)
    if (hops >= 1 && hops <= MAX_HOPS) return hops
  } else {
    const items = v.split(',').map((x) => x.trim().toLowerCase())
    if (items.length && items.every((x) => x && isProxyAddress(x))) return items
  }
  throw new StartupConfigError(
    `TRUST_PROXY must be 0 (no proxy), 1 (one reverse proxy in front), a number up to ${MAX_HOPS}, or a comma-separated list of proxy `
    + `addresses such as 10.0.0.0/8 (not "${v.slice(0, 60)}")`)
}

// ---- database pool (BE-046, O-13)

export const DEFAULT_POOL_MAX = 5
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000
/** Connections that sit idle in a pool are closed after this long (the library default, 10 s, made a quiet server reconnect on the next request). */
export const POOL_IDLE_MS = 60_000
/** A request waits at most this long for a free connection, then fails with a 503 instead of queueing without limit. */
export const POOL_CONNECT_TIMEOUT_MS = 5_000
/** A transaction that stands idle (a stuck request) is ended by the database after this long, so it cannot hold locks and a backend for ever. */
export const IDLE_IN_TRANSACTION_MS = 15_000

/** A whole number in [min, max] written in plain digits; unset or blank is the fallback. Anything else stops the server with a message that names the variable. */
export function parseWholeNumber(name: string, raw: string | undefined, fallback: number, min: number, max: number): number {
  const v = raw?.trim()
  if (!v) return fallback
  const n = /^\d{1,9}$/.test(v) ? Number(v) : NaN
  if (!Number.isInteger(n) || n < min || n > max) throw new StartupConfigError(`${name} must be a whole number from ${min} to ${max}, not "${v.slice(0, 40)}"`)
  return n
}

export interface PoolSettings {
  connectionString: string
  max: number
  idleTimeoutMillis: number
  connectionTimeoutMillis: number
  statement_timeout: number
  idle_in_transaction_session_timeout: number
  application_name: string
}

/**
 * The connection pool's settings. DB_POOL_MAX (default 5: each connection is a Postgres process and the work is mostly CPU, so more
 * of them do not help a small server) and DB_STATEMENT_TIMEOUT_MS (default 30000; 0 = none) can be set; the rest are fixed.
 * The two server-side timeouts go to Postgres in the connection's start-up message.
 */
export function poolSettings(env: Record<string, string | undefined>, connectionString: string): PoolSettings {
  return {
    connectionString,
    max: parseWholeNumber('DB_POOL_MAX', env.DB_POOL_MAX, DEFAULT_POOL_MAX, 1, 50),
    idleTimeoutMillis: POOL_IDLE_MS,
    connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS,
    statement_timeout: parseWholeNumber('DB_STATEMENT_TIMEOUT_MS', env.DB_STATEMENT_TIMEOUT_MS, DEFAULT_STATEMENT_TIMEOUT_MS, 0, 3_600_000),
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_MS,
    application_name: 'isocode-api',
  }
}

// ---- log level (O-11)

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])

/** LOG_LEVEL: fatal, error, warn, info, debug, trace or silent. Unset or blank is info. Anything else stops the server. */
export function parseLogLevel(raw: string | undefined): string {
  const v = raw?.trim().toLowerCase()
  if (!v) return 'info'
  if (!LOG_LEVELS.has(v)) throw new StartupConfigError(`LOG_LEVEL must be one of ${[...LOG_LEVELS].join(', ')}, not "${v.slice(0, 40)}"`)
  return v
}

// ---- graceful shutdown (BE-046, O-13)

export const SHUTDOWN_GRACE_MS = 10_000

export interface ShutdownParts {
  /** Stop accepting, wait for requests in flight, close the listener (Fastify's app.close()). */
  closeApp: () => Promise<unknown>
  /** End the database pool after the app is closed, so no request can need it any more (pool.end()). */
  closePool: () => Promise<unknown>
  exit: (code: number) => void
  log: (message: string) => void
  /** The most it may take before the process is ended anyway. */
  graceMs?: number
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200)

/**
 * Returns the function to run on SIGTERM / SIGINT: close the app first (no new requests, in-flight ones finish), then the pool, then
 * exit 0. If that takes longer than graceMs, or either step fails, exit 1. A second signal while it is running is ignored (it is
 * already doing it). The grace timer never keeps the process alive by itself.
 */
export function createShutdown(parts: ShutdownParts): (reason: string, code?: number) => Promise<void> {
  let started: Promise<void> | null = null
  return (reason, code = 0) => {
    if (started) { parts.log(`shutdown already running; ignoring ${reason}`); return started }
    parts.log(`shutting down (${reason})`)
    started = (async () => {
      let exitCode = code
      const timer = setTimeout(() => { parts.log(`shutdown took longer than ${parts.graceMs ?? SHUTDOWN_GRACE_MS} ms; exiting anyway`); parts.exit(1) }, parts.graceMs ?? SHUTDOWN_GRACE_MS)
      timer.unref()
      try { await parts.closeApp() } catch (e) { exitCode = 1; parts.log(`closing the app failed: ${errorText(e)}`) }
      try { await parts.closePool() } catch (e) { exitCode = 1; parts.log(`closing the database pool failed: ${errorText(e)}`) }
      clearTimeout(timer)
      parts.exit(exitCode)
    })()
    return started
  }
}

/**
 * Hooks the shutdown to the signals and logs what would otherwise vanish: an unhandled rejection is logged (the server keeps running:
 * refreshes and the like are written never to throw, so one that does is a bug to read about, not a reason to drop every phone); an
 * uncaught exception is logged and ends the process after closing cleanly, because the state after it is not known.
 */
export function installProcessHandlers(
  proc: Pick<NodeJS.Process, 'on'>, shutdown: (reason: string, code?: number) => Promise<void>, log: (message: string) => void,
): void {
  proc.on('SIGTERM', () => { void shutdown('SIGTERM') })
  proc.on('SIGINT', () => { void shutdown('SIGINT') })
  proc.on('unhandledRejection', (reason) => { log(`unhandled rejection: ${errorText(reason)}`) })
  proc.on('uncaughtException', (err) => { log(`uncaught exception: ${errorText(err)}`); void shutdown('uncaughtException', 1) })
}
