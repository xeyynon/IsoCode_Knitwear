// Bug round 2: BE-071, `Vary: Origin` was sent only for an allowed origin, so a cache could keep the answer made for one caller
// (no Access-Control-Allow-Origin) and hand it to a caller whose origin is allowed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { buildApp, type Db } from '../src/index.js'
import { migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const ORIGIN = 'https://app.example.test'
let pg: PGlite
let db: Db
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg); await resetAndSeed(pg) })
afterAll(async () => { await pg.close() })

const varies = (h: Record<string, unknown>) => String(h.vary ?? '').split(',').map((t) => t.trim().toLowerCase())

describe('BE-071: Vary: Origin on every response that can differ by Origin', () => {
  const app = () => buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => new Date('2026-11-04T04:30:00Z'), allowedOrigins: [ORIGIN] })

  it('BE-071: an allowed origin, a different origin, no origin at all, and a preflight from a stranger all carry it', async () => {
    const a = app()
    const cases: [string, Record<string, string>, string][] = [
      ['GET', { origin: ORIGIN }, 'allowed origin'],
      ['GET', { origin: 'https://evil.example.test' }, 'other origin'],
      ['GET', {}, 'no origin'],
      ['OPTIONS', { origin: 'https://evil.example.test', 'access-control-request-method': 'GET' }, 'preflight from another origin'],
      ['OPTIONS', { origin: ORIGIN, 'access-control-request-method': 'GET' }, 'preflight from the allowed origin'],
    ]
    for (const [method, headers, label] of cases) {
      const res = await a.inject({ method: method as 'GET', url: '/api/health', headers })
      expect(varies(res.headers), label).toContain('origin')
    }
    // the allow header itself is still only for the allowed origin
    expect((await a.inject({ url: '/api/health', headers: { origin: 'https://evil.example.test' } })).headers['access-control-allow-origin']).toBeUndefined()
    expect((await a.inject({ url: '/api/health', headers: { origin: ORIGIN } })).headers['access-control-allow-origin']).toBe(ORIGIN)
  })

  it('BE-071: the error answers (401, 404) carry it too', async () => {
    const a = app()
    const unauthorised = await a.inject({ url: '/api/board' })
    expect(unauthorised.statusCode).toBe(401)
    expect(varies(unauthorised.headers)).toContain('origin')
    const missing = await a.inject({ url: '/api/no-such-route', headers: { origin: 'https://evil.example.test' } })
    expect(varies(missing.headers)).toContain('origin')
  })

  it('BE-071: with no allow-list nothing can differ by Origin, so no Vary is added', async () => {
    const a = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => new Date('2026-11-04T04:30:00Z') })
    const res = await a.inject({ url: '/api/health', headers: { origin: ORIGIN } })
    expect(varies(res.headers)).not.toContain('origin')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
