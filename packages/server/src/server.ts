// Process entry: reads the environment, then listens. Everything testable lives in app.ts.
//   DATABASE_URL     postgres://app_user:...@host/db   (the non-owner role)
//   TOKEN_SECRET     at least 32 random characters
//   ALLOWED_ORIGINS  comma-separated browser origins, e.g. https://app.example.com
//   TRUST_PROXY      "1" behind a reverse proxy
//   MEDIA_DIR        folder for uploaded photos (leave unset to switch photos off)
//   MEDIA_STORE      disk | memory | s3   (unset: disk when MEDIA_DIR is set, otherwise photos are off)
//   S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY   required when MEDIA_STORE=s3
//   S3_ENDPOINT, S3_FORCE_PATH_STYLE, S3_PREFIX, S3_SSE            optional (R2, MinIO, Backblaze, a folder, no-SSE services)
//   PORT             default 8787
import pg from 'pg'
import { buildApp } from './app.js'
import { parseOrigins } from './cors.js'
import { MediaConfigError, mediaStoreFromEnv } from './mediaFromEnv.js'
import { pgDb } from './pgDb.js'

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

const app = buildApp({
  // The callback runs only later, on a dropped idle connection, so `app` exists by then.
  db: pgDb(new pg.Pool({ connectionString: need('DATABASE_URL'), max: 10 }), (err) => app.log.error({ err }, 'idle db client error')),
  tokenSecret: need('TOKEN_SECRET'),
  allowedOrigins: origins,
  trustProxy: process.env.TRUST_PROXY === '1',
  ...(media ? { media } : {}),
  logger: true,
})

await app.listen({ port: Number(process.env.PORT ?? 8787), host: '0.0.0.0' })
