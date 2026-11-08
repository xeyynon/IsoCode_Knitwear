// OPT-LANE C: O-11, one short log line per request and nothing secret in it.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import type { PGlite } from '@electric-sql/pglite'
import { buildApp, type Db } from '../src/index.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const NOW = new Date('2026-11-04T04:30:00Z')
const SECRET = 'x'.repeat(40)
let pg: PGlite
let db: Db
beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
beforeEach(async () => { await resetAndSeed(pg) })
afterAll(async () => { await pg.close() })

function sink() {
  const lines: string[] = []
  return { lines, stream: { write: (s: string) => { lines.push(s) } }, json: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>), bytes: () => lines.reduce((n, l) => n + Buffer.byteLength(l), 0) }
}

describe('O-11: one short line per request', () => {
  it('O-11: a request logs exactly one line with method, route pattern, status and milliseconds, and nothing else of the request', async () => {
    const out = sink()
    const app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, logger: { stream: out.stream } })
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })
    const token = login.json().token as string
    out.lines.length = 0
    const res = await app.inject({ url: `/api/orders/${ID.orderRed}?note=hello`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(out.lines).toHaveLength(1)
    const line = out.json()[0]!
    expect(line).toMatchObject({ method: 'GET', route: '/api/orders/:id', status: 200 })
    expect(typeof line.ms).toBe('number')
    expect(Object.keys(line).sort()).toEqual(['level', 'method', 'ms', 'reqId', 'route', 'status', 'time'])
    expect(out.lines[0]).not.toContain(ID.orderRed)
    expect(out.lines[0]).not.toContain('hello')
    expect(Buffer.byteLength(out.lines[0]!)).toBeLessThan(140)
  })

  it('O-11: about a third of the bytes of the default logger (two lines, 366 bytes per request)', async () => {
    const mine = sink()
    const app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, logger: { stream: mine.stream } })
    const t = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token as string
    mine.lines.length = 0
    for (let i = 0; i < 20; i++) await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${t}` } })
    expect(mine.lines).toHaveLength(20)
    // the same 20 requests through plain Fastify with its default request logging, as it was before
    const old = sink()
    const plain = Fastify({ logger: { stream: old.stream, level: 'info' } as never })
    plain.get('/api/me', async () => ({ role: 'merchandiser', unitId: null }))
    for (let i = 0; i < 20; i++) await plain.inject({ url: '/api/me' })
    expect(old.lines).toHaveLength(40)
    const after = mine.bytes() / 20, before = old.bytes() / 20
    console.log(`O-11 bytes per request: before ${before.toFixed(0)} in 2 lines, after ${after.toFixed(0)} in 1 line`)
    expect(after).toBeLessThan(before / 2.5)
  })

  it('O-11: health probes are not logged when they succeed; an unknown address is logged by the word "unmatched", never as written', async () => {
    const out = sink()
    const app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, logger: { stream: out.stream } })
    await app.inject({ url: '/api/health' })
    await app.inject({ url: '/api/status' })
    expect(out.lines).toHaveLength(0)
    const secret = 'qZ9-link-token-0123456789abcdef'
    await app.inject({ url: `/api/buyer/orders/${secret}?t=${secret}`, headers: { authorization: `Bearer ${secret}` } })
    await app.inject({ url: `/b/${secret}` })
    expect(out.json().map((l) => l.route)).toEqual(['unmatched', 'unmatched'])
    expect(out.lines.join('')).not.toContain(secret)
  })

  it('O-11: the buyer link never reaches a log line: not as the bearer value, not in the address, not in a query, not in an error', async () => {
    const out = sink()
    const app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, logger: { stream: out.stream, level: 'trace' } })
    const m = { authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token}` }
    const link = (await app.inject({ method: 'POST', url: '/api/buyer-links', headers: m, payload: { buyerId: ID.buyerB } })).json().token as string
    const b = { authorization: `Bearer ${link}` }
    for (const url of ['/api/buyer/orders', '/api/buyer/export.csv', `/api/buyer/orders?token=${link}`, `/api/buyer/photos/${ID.orderRed}`, `/api/buyer/photos/${link}`]) await app.inject({ url, headers: b })
    await app.inject({ url: `/api/buyer/orders`, headers: { authorization: `Bearer ${link}x` } })   // a wrong link: 401, logged, secret still absent
    const text = out.lines.join('')
    expect(text).not.toContain(link)
    expect(text).not.toContain(link.slice(0, 12))
    expect(text).not.toContain(CREDS.password)
    expect(text.toLowerCase()).not.toContain('authorization')
    expect(out.json().filter((l) => String(l.route).startsWith('/api/buyer')).length).toBeGreaterThanOrEqual(6)
  })

  it('O-11: a 500 still logs its error with the request id, and the request line carries the same id', async () => {
    const out = sink()
    const broken: Db = { tx: async (ctx, fn) => { if (ctx.role === 'merchandiser') throw new Error('disk on fire'); return db.tx(ctx, fn) } }
    const app = buildApp({ db: broken, tokenSecret: SECRET, clock: () => NOW, logger: { stream: out.stream } })
    const t = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: CREDS.email, password: CREDS.password } })).json().token as string
    out.lines.length = 0
    const res = await app.inject({ url: '/api/board', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain('disk on fire')
    const logs = out.json()
    const err = logs.find((l) => l.level === 50)!
    const req = logs.find((l) => l.route === '/api/board')!
    expect(JSON.stringify(err)).toContain('disk on fire')
    expect(err.reqId).toBeDefined()
    expect(err.reqId).toBe(req.reqId)
    expect(req.status).toBe(500)
    expect(logs.some((l) => String(l.msg ?? '').includes('incoming request'))).toBe(false)
  })

  it('O-11: logLevel decides: warn silences the request lines but not an error; the default is info', async () => {
    const quiet = sink()
    const a = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, logger: { stream: quiet.stream }, logLevel: 'warn' })
    await a.inject({ url: '/api/me' })
    expect(quiet.lines).toHaveLength(0)
    const def = sink()
    const b = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, logger: { stream: def.stream } })
    await b.inject({ url: '/api/me' })
    expect(def.lines).toHaveLength(1)
    const loud = sink()
    const c = buildApp({ db, tokenSecret: SECRET, clock: () => NOW, logger: { stream: loud.stream, level: 'error' } })
    await c.inject({ url: '/api/me' })
    expect(loud.lines).toHaveLength(0)
  })

  it('O-11: with logging off (the tests, the demo) nothing is written', async () => {
    const app = buildApp({ db, tokenSecret: SECRET, clock: () => NOW })
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401)
  })
})
