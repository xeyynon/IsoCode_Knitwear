// Vercel serverless entry: the same app as server.ts, built once per function instance and handed each request. No listen().
// Bundled into one file by scripts/vercel_build.mjs. The environment is the same as server.ts reads, plus:
//   DEMO_TODAY   optional; every real day reads as this date (demoClock.ts), so the seeded demo figures stay meaningful. Demo only
// ALLOWED_ORIGINS is not needed: the app and the API share one address. The deployment's own Vercel addresses are allowed anyway.
import type { IncomingMessage, ServerResponse } from 'node:http'
import pg from 'pg'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'
import { parseOrigins } from './cors.js'
import { demoClock } from './demoClock.js'
import { mediaStoreFromEnv } from './mediaFromEnv.js'
import { classifierFromEnv } from './aiFromEnv.js'
import { assertSafeDbRole, pgDb, unsafeRoleOverride } from './pgDb.js'
import { parseLogLevel, parseTrustProxy, poolSettings } from './startup.js'

const need = (env: NodeJS.ProcessEnv, name: string): string => {
  const v = env[name]?.trim()
  if (!v) throw new Error(`${name} is not set`)
  return v
}

/** The deployment's own addresses (production, branch and this deployment), as Vercel names them. */
export function vercelOrigins(env: NodeJS.ProcessEnv): string[] {
  return ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_BRANCH_URL', 'VERCEL_URL']
    .map((k) => env[k]?.trim()).filter((h): h is string => !!h).map((h) => `https://${h}`)
}

async function init(env: NodeJS.ProcessEnv): Promise<FastifyInstance> {
  // A serverless instance handles one request at a time: a small pool is enough, and many instances share the database.
  const pool = new pg.Pool(poolSettings({ DB_POOL_MAX: '2', ...env }, need(env, 'DATABASE_URL')))
  await assertSafeDbRole(async (sql) => (await pool.query(sql)).rows, { allowUnsafe: unsafeRoleOverride(env), warn: (m) => console.warn(m) })
  const db = pgDb(pool, (err) => console.error('idle db client error', err.name))
  const media = mediaStoreFromEnv(env, {
    db,
    warn: (m) => console.warn(m),
    onError: (op, info) => console.error(`media store ${op} failed: ${info.name}${info.status ? ` (HTTP ${info.status})` : ''}`),
  })
  const { origins } = parseOrigins(env.ALLOWED_ORIGINS)
  const dayClock = demoClock(env.DEMO_TODAY)   // only the factory's day; tokens and locks keep real time
  const app = buildApp({
    db,
    tokenSecret: need(env, 'TOKEN_SECRET'),
    allowedOrigins: [...new Set([...origins, ...vercelOrigins(env)])],
    trustProxy: parseTrustProxy(env.TRUST_PROXY ?? '1'),   // Vercel's edge is the one proxy in front
    ...(media ? { media } : {}),
    noteAi: classifierFromEnv(env),
    ...(dayClock ? { dayClock } : {}),
    logger: true,
    logLevel: parseLogLevel(env.LOG_LEVEL),
    warningFullRefreshMs: 0,   // instances come and go: refresh on each change rather than trusting an in-memory timer
  })
  await app.ready()
  return app
}

let ready: Promise<FastifyInstance> | null = null

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    ready ??= init(process.env)
    const app = await ready
    app.server.emit('request', req, res)
  } catch (err) {
    ready = null   // try again on the next request: a database that was waking up may be there now
    // The operator log names the problem (a missing variable, an unsafe database login); the caller gets a plain answer, no detail.
    console.error(`API start-up failed: ${err instanceof Error ? err.message : String(err)}`)
    res.statusCode = 503
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify({ error: 'unavailable', message: 'The service is starting or not set up. Please try again in a minute.' }))
  }
}
