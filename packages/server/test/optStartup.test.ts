// OPT-LANE C: pool settings, graceful shutdown, log level and the S3 request timeout (BE-046, O-13, O-11).
import { EventEmitter } from 'node:events'
import http from 'node:http'
import pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { buildApp, type Db } from '../src/index.js'
import { AppError } from '../src/errors.js'
import { pgDb } from '../src/pgDb.js'
import { S3_CONNECT_TIMEOUT_MS, S3_REQUEST_TIMEOUT_MS, makeS3Client } from '../src/s3Store.js'
import {
  DEFAULT_POOL_MAX, DEFAULT_STATEMENT_TIMEOUT_MS, IDLE_IN_TRANSACTION_MS, POOL_CONNECT_TIMEOUT_MS, POOL_IDLE_MS, StartupConfigError,
  createShutdown, installProcessHandlers, parseLogLevel, parseWholeNumber, poolSettings,
} from '../src/startup.js'

describe('BE-046: the pool has limits', () => {
  it('BE-046: the defaults: 5 connections, a 5 s wait for one, 60 s idle, 30 s per statement, 15 s idle in a transaction, a name', () => {
    const s = poolSettings({}, 'postgres://u:p@h/db')
    expect(s).toEqual({
      connectionString: 'postgres://u:p@h/db', max: DEFAULT_POOL_MAX, idleTimeoutMillis: POOL_IDLE_MS, connectionTimeoutMillis: POOL_CONNECT_TIMEOUT_MS,
      statement_timeout: DEFAULT_STATEMENT_TIMEOUT_MS, idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_MS, application_name: 'isocode-api',
    })
    expect(s.max).toBe(5)
    expect(s.connectionTimeoutMillis).toBe(5000)
    expect(s.statement_timeout).toBe(30000)
    expect(s.idle_in_transaction_session_timeout).toBe(15000)
  })
  it('BE-046: DB_POOL_MAX and DB_STATEMENT_TIMEOUT_MS can be set, and a wrong value stops the server with a plain message', () => {
    expect(poolSettings({ DB_POOL_MAX: ' 8 ', DB_STATEMENT_TIMEOUT_MS: '0' }, 'x')).toMatchObject({ max: 8, statement_timeout: 0 })
    for (const bad of ['0', '51', 'abc', '-1', '2.5', '1e1', '']) {
      if (bad === '') { expect(poolSettings({ DB_POOL_MAX: bad }, 'x').max).toBe(5); continue }
      expect(() => poolSettings({ DB_POOL_MAX: bad }, 'x')).toThrow(StartupConfigError)
      expect(() => poolSettings({ DB_POOL_MAX: bad }, 'x')).toThrow(/DB_POOL_MAX/)
    }
    expect(() => poolSettings({ DB_STATEMENT_TIMEOUT_MS: 'soon' }, 'x')).toThrow(/DB_STATEMENT_TIMEOUT_MS/)
    expect(parseWholeNumber('X', undefined, 7, 1, 9)).toBe(7)
  })
  it('BE-046: pg really receives the server-side timeouts (they are options the driver knows)', () => {
    const c = new pg.Client(poolSettings({}, 'postgres://u:p@localhost/db'))
    const params = (c as unknown as { connectionParameters: Record<string, unknown> }).connectionParameters
    expect(params.statement_timeout).toBe(30000)
    expect(params.idle_in_transaction_session_timeout).toBe(15000)
    expect(params.application_name).toBe('isocode-api')
  })
  it('BE-046: a request that cannot get a connection in time is a 503 "busy", not a 500 and not a wait for ever', async () => {
    class Slow extends EventEmitter {
      connect(cb?: (err?: Error) => void) { if (cb) { cb(); return } return Promise.resolve() }
      query() { return Promise.resolve({ rows: [] }) }
      end(cb?: () => void) { if (cb) { cb(); return } return Promise.resolve() }
    }
    const pool = new pg.Pool({ Client: Slow as never, max: 1, connectionTimeoutMillis: 60 })
    const db = pgDb(pool)
    let release!: () => void
    const held = db.tx({ role: 'system' }, () => new Promise<void>((r) => { release = r }))
    await new Promise((r) => setTimeout(r, 20))
    const t0 = Date.now()
    await expect(db.tx({ role: 'system' }, async () => 1)).rejects.toMatchObject({ status: 503, code: 'busy' })
    expect(Date.now() - t0).toBeLessThan(1000)
    release(); await held
    await expect(db.tx({ role: 'system' }, async () => 1)).resolves.toBe(1)   // and it recovers
    await pool.end()
  })
})

describe('O-13: the S3 client gives up on a stuck bucket', () => {
  it('O-13: connection 5 s and request 15 s per attempt', async () => {
    const c = makeS3Client({ bucket: 'b', region: 'ap-south-1', accessKeyId: 'a', secretAccessKey: 's' }) as unknown as { config: { requestHandler: { configProvider: Promise<{ connectionTimeout: number; requestTimeout: number }> } } }
    const cfg = await c.config.requestHandler.configProvider
    expect(cfg.connectionTimeout).toBe(S3_CONNECT_TIMEOUT_MS)
    expect(cfg.requestTimeout).toBe(S3_REQUEST_TIMEOUT_MS)
    expect([S3_CONNECT_TIMEOUT_MS, S3_REQUEST_TIMEOUT_MS]).toEqual([5000, 15000])
  })
})

describe('O-11: LOG_LEVEL', () => {
  it('O-11: unset and blank are info; the six pino levels and silent are read in any case; anything else is refused', () => {
    expect(parseLogLevel(undefined)).toBe('info')
    expect(parseLogLevel('  ')).toBe('info')
    for (const l of ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']) expect(parseLogLevel(l.toUpperCase())).toBe(l)
    expect(() => parseLogLevel('verbose')).toThrow(/LOG_LEVEL/)
  })
})

describe('O-13: graceful shutdown', () => {
  const parts = (over: Partial<Parameters<typeof createShutdown>[0]> = {}) => {
    const calls: string[] = []
    const p = {
      closeApp: async () => { calls.push('app') }, closePool: async () => { calls.push('pool') },
      exit: (c: number) => { calls.push(`exit ${c}`) }, log: (m: string) => { calls.push(`log: ${m}`) }, ...over,
    }
    return { calls, p }
  }
  it('O-13: the app is closed first, then the pool, then the process exits 0', async () => {
    const { calls, p } = parts()
    await createShutdown(p)('SIGTERM')
    expect(calls.filter((c) => !c.startsWith('log'))).toEqual(['app', 'pool', 'exit 0'])
  })
  it('O-13: the pool is not closed until the requests in flight have finished', async () => {
    const order: string[] = []
    let finish!: () => void
    const inflight = new Promise<void>((r) => { finish = r })
    const { p } = parts({ closeApp: async () => { await inflight; order.push('app closed') }, closePool: async () => { order.push('pool closed') }, exit: () => { order.push('exit') } })
    const done = createShutdown(p)('SIGTERM')
    await new Promise((r) => setTimeout(r, 30))
    expect(order).toEqual([])
    finish(); await done
    expect(order).toEqual(['app closed', 'pool closed', 'exit'])
  })
  it('O-13: a second signal while it runs does nothing more', async () => {
    const { calls, p } = parts()
    const stop = createShutdown(p)
    await Promise.all([stop('SIGTERM'), stop('SIGINT')])
    expect(calls.filter((c) => c === 'app')).toHaveLength(1)
    expect(calls.filter((c) => c.startsWith('exit'))).toEqual(['exit 0'])
  })
  it('O-13: a step that fails is logged, the other still runs, and the exit code is 1', async () => {
    const { calls, p } = parts({ closeApp: async () => { throw new Error('boom') } })
    await createShutdown(p)('SIGTERM')
    expect(calls).toContain('pool')
    expect(calls.some((c) => c.includes('closing the app failed: boom'))).toBe(true)
    expect(calls.filter((c) => c.startsWith('exit'))).toEqual(['exit 1'])
  })
  it('O-13: a shutdown that hangs ends the process anyway after the grace time', async () => {
    const { calls, p } = parts({ closeApp: () => new Promise(() => undefined), graceMs: 40 })
    void createShutdown(p)('SIGTERM')
    await new Promise((r) => setTimeout(r, 120))
    expect(calls.filter((c) => c.startsWith('exit'))).toEqual(['exit 1'])
  })
  it('O-13: SIGTERM and SIGINT start it; an unhandled rejection is logged and does not; an uncaught exception shuts down with 1', () => {
    const proc = new EventEmitter()
    const shutdown = vi.fn(async () => undefined)
    const logs: string[] = []
    installProcessHandlers(proc as never, shutdown, (m) => logs.push(m))
    proc.emit('SIGTERM'); proc.emit('SIGINT')
    expect(shutdown.mock.calls).toEqual([['SIGTERM'], ['SIGINT']])
    proc.emit('unhandledRejection', new Error('lost promise'))
    expect(logs).toEqual(['unhandled rejection: lost promise'])
    expect(shutdown).toHaveBeenCalledTimes(2)
    proc.emit('uncaughtException', new Error('oops'))
    expect(logs[1]).toBe('uncaught exception: oops')
    expect(shutdown.mock.calls[2]).toEqual(['uncaughtException', 1])
  })

  it('O-13: against a real listening server: a request in flight is answered, new connections are refused, then the pool is ended', async () => {
    let started!: () => void
    const began = new Promise<void>((r) => { started = r })
    const slow: Db = { tx: async (_ctx, fn) => { started(); await new Promise((r) => setTimeout(r, 150)); return fn({ query: async () => [{ token_version: 0, disabled: false, unit_id: null }] as never }) } }
    const { signToken } = await import('../src/auth.js')
    const SECRET = 'x'.repeat(40)
    const NOW = new Date('2026-11-04T04:30:00Z')
    const app = buildApp({ db: slow, tokenSecret: SECRET, clock: () => NOW, authCacheMs: 0 })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const token = signToken({ sub: '00000000-0000-0000-0000-0000000000ee', role: 'merchandiser', exp: Math.floor(NOW.getTime() / 1000) + 600, ver: 0 }, SECRET)
    const order: string[] = []
    const reply = new Promise<number>((resolve, reject) => {
      http.get({ port, host: '127.0.0.1', path: '/api/me', headers: { authorization: `Bearer ${token}`, connection: 'close' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)) }).on('error', reject)
    })
    await began
    const stop = createShutdown({ closeApp: () => app.close(), closePool: async () => { order.push('pool') }, exit: (c) => { order.push(`exit ${c}`) }, log: () => undefined })
    const finished = stop('SIGTERM')
    await new Promise((r) => setTimeout(r, 30))
    const refused = await new Promise<string>((resolve) => {
      http.get({ port, host: '127.0.0.1', path: '/api/health' }, () => resolve('answered')).on('error', (e) => resolve((e as NodeJS.ErrnoException).code ?? 'error'))
    })
    expect(refused).toBe('ECONNREFUSED')
    expect(order).toEqual([])                       // still waiting for the request in flight
    expect(await reply).toBe(200)
    await finished
    expect(order).toEqual(['pool', 'exit 0'])
  })
})

describe('the refusal for a busy server is a plain AppError', () => {
  it('BE-046: status 503 and code busy are allowed by the error type', () => {
    expect(new AppError(503, 'busy', 'x').status).toBe(503)
  })
})
