// Process entry: reads the environment, then listens. Everything testable lives in app.ts.
//   DATABASE_URL     postgres://app_user:...@host/db   (the non-owner role)
//   TOKEN_SECRET     at least 32 random characters
//   ALLOWED_ORIGINS  comma-separated browser origins, e.g. https://app.example.com
//   TRUST_PROXY      how many reverse proxies are in front: 1 (the usual), 2-10, or a list of proxy addresses; 0 or unset: none. Anything else stops the server
//   MEDIA_DIR        folder for uploaded photos (leave unset to switch photos off)
//   MEDIA_STORE      disk | memory | s3   (unset: disk when MEDIA_DIR is set, otherwise photos are off)
//   S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY   required when MEDIA_STORE=s3
//   S3_ENDPOINT, S3_FORCE_PATH_STYLE, S3_PREFIX, S3_SSE            optional (R2, MinIO, Backblaze, a folder, no-SSE services)
//   LOG_LEVEL        fatal | error | warn | info | debug | trace | silent. Default info. One short line per request at info
//   DB_POOL_MAX      database connections, 1 to 50. Default 5 (each is a Postgres process; the work is CPU-bound)
//   DB_STATEMENT_TIMEOUT_MS   the database ends any statement that runs longer than this. Default 30000; 0 = no limit
//   PORT             default 8787 (empty counts as unset); a value that is not a whole number from 1 to 65535 stops the server
//   ALLOW_UNSAFE_DB_ROLE   1 = start even if DATABASE_URL is a superuser / BYPASSRLS / table-owner login. LOCAL DEVELOPMENT ONLY; unset in every real deployment
import pg from 'pg'
import { buildApp } from './app.js'
import { parseOrigins } from './cors.js'
import { MediaConfigError, mediaStoreFromEnv } from './mediaFromEnv.js'
import { assertSafeDbRole, pgDb, unsafeRoleOverride } from './pgDb.js'
import { createShutdown, installProcessHandlers, parseLogLevel, parsePort, parseTrustProxy, poolSettings } from './startup.js'

const need = (name: string): string => {
  const v = process.env[name]?.trim()
  if (!v) { console.error(`${name} is not set. Refusing to start.`); process.exit(1) }
  return v
}

// A media mistake stops the server at once with a plain message that names the variable (never a value).
let media: ReturnType<typeof mediaStoreFromEnv>
try {
  media = mediaStoreFromEnv(process.env, {
    warn: (m) => console.warn(m),
    // The operator log of a storage failure carries the error name and HTTP status only: no bucket, key or message.
    onError: (op, info) => console.error(`media store ${op} failed: ${info.name}${info.status ? ` (HTTP ${info.status})` : ''}`),
  })
} catch (err) {
  if (err instanceof MediaConfigError) { console.error(`${err.message}. Refusing to start.`); process.exit(1) }
  throw err
}

const { origins, dropped } = parseOrigins(process.env.ALLOWED_ORIGINS)
if (dropped.length) console.warn(`ALLOWED_ORIGINS: ignored invalid entries: ${dropped.join(' | ')}`)


// Plain-words configuration errors, one line each, never a stack trace.
let port: number
let trustProxy: ReturnType<typeof parseTrustProxy>
let allowUnsafeRole: boolean
let logLevel: string
let pool: pg.Pool
try {
  port = parsePort(process.env.PORT)
  trustProxy = parseTrustProxy(process.env.TRUST_PROXY)
  allowUnsafeRole = unsafeRoleOverride(process.env)
  logLevel = parseLogLevel(process.env.LOG_LEVEL)
  pool = new pg.Pool(poolSettings(process.env, need('DATABASE_URL')))
} catch (err) {
  if (err instanceof Error) { console.error(`${err.message}. Refusing to start.`); process.exit(1) }
  throw err
}

// Row-level security protects nothing if this login is a superuser, bypasses it or owns the tables: refuse to start.
try {
  await assertSafeDbRole(async (sql) => (await pool.query(sql)).rows, { allowUnsafe: allowUnsafeRole, warn: (m) => console.warn(m) })
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
}

const app = buildApp({
  // The callback runs only later, on a dropped idle connection, so `app` exists by then.
  db: pgDb(pool, (err) => app.log.error({ err }, 'idle db client error')),
  tokenSecret: need('TOKEN_SECRET'),
  allowedOrigins: origins,
  trustProxy,
  ...(media ? { media } : {}),
  logger: true,
  logLevel,
})

// SIGTERM / SIGINT: stop accepting, let requests in flight finish, close the app, then the pool, then exit (10 s at most).
installProcessHandlers(process, createShutdown({
  closeApp: () => app.close(), closePool: () => pool.end(), exit: (code) => process.exit(code), log: (m) => app.log.warn(m),
}), (m) => app.log.error(m))

await app.listen({ port, host: '0.0.0.0' })
