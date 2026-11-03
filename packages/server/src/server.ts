// Process entry: reads the environment, then listens. Everything testable lives in app.ts.
//   DATABASE_URL     postgres://app_user:...@host/db   (the non-owner role)
//   TOKEN_SECRET     at least 32 random characters
//   ALLOWED_ORIGINS  comma-separated browser origins, e.g. https://app.example.com
//   TRUST_PROXY      "1" behind a reverse proxy
//   MEDIA_DIR        folder for uploaded photos (leave unset to switch photos off)
//   PORT             default 8787
import pg from 'pg'
import { buildApp } from './app.js'
import { parseOrigins } from './cors.js'
import { diskStore } from './mediaStore.js'
import { pgDb } from './pgDb.js'

const need = (name: string): string => {
  const v = process.env[name]?.trim()
  if (!v) { console.error(`${name} is not set. Refusing to start.`); process.exit(1) }
  return v
}

const { origins, dropped } = parseOrigins(process.env.ALLOWED_ORIGINS)
if (dropped.length) console.warn(`ALLOWED_ORIGINS: ignored invalid entries: ${dropped.join(' | ')}`)

const app = buildApp({
  db: pgDb(new pg.Pool({ connectionString: need('DATABASE_URL'), max: 10 })),
  tokenSecret: need('TOKEN_SECRET'),
  allowedOrigins: origins,
  trustProxy: process.env.TRUST_PROXY === '1',
  ...(process.env.MEDIA_DIR ? { media: diskStore(process.env.MEDIA_DIR) } : {}),
  logger: true,
})

await app.listen({ port: Number(process.env.PORT ?? 8787), host: '0.0.0.0' })
