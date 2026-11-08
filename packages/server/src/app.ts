import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify'
import { verifyToken, type TokenClaims } from './auth.js'
import { login, type LoginInput } from './authService.js'
import { getBoard } from './boardService.js'
import { isStaff, type Ctx, type Db } from './db.js'
import { AppError, badRequest, clientFault, duplicateFault, forbidden } from './errors.js'
import { submitEvent, type EventInput } from './eventService.js'
import { changeExFactory, createOrder, getOrderOptions, previewSchedule, type NewOrder } from './orderService.js'
import { getOrderDetail } from './orderDetailService.js'
import { getMyStages } from './myService.js'
import { confirmWarning, dismissWarning, listReview, undoDismissWarning, WarningRefresher, type RefreshScope } from './warningService.js'
import {
  clearCalendarDay, createMerchandiser, createSupervisor, createUnit, deleteTemplate, listAccounts, listCalendar, listTemplates, listUnits,
  resetPin, saveTemplate, setCalendarDay, setDisabled, signOutEverywhere,
} from './adminService.js'
import { confirmNote, listPendingNotes, loadReasons } from './noteService.js'
import { approvePhoto, getBuyerPhotoBytes, listApprovedPhotos, purgeRejectedPhotos, getPhotoBytes, listPendingPhotos, MAX_PHOTO_BYTES, rejectPhoto, savePhoto } from './photoService.js'
import type { MediaStore } from './mediaStore.js'
import { createBuyerLink, getBuyerView, getBuyerViewFor, listBuyerLinks, resolveBuyerToken, revokeBuyerLink, type BuyerView } from './buyerService.js'
import { buyerExportCsv, exportFileName } from './buyerExport.js'
import { listOutbox } from './outboxService.js'
import { listAudit } from './auditService.js'
import { isStageName, istDate } from './today.js'
import { createLoginLimiter, type LoginLimiter } from './loginLimiter.js'
import { AUTH_CACHE_MS, createAuthCache, type AccountState, type AuthCache } from './authCache.js'
import { registerHttpCache } from './httpCache.js'

export interface AppOptions {
  db: Db
  /** Signs tokens. Required, at least 32 characters: with no secret the server will not start (fails closed). */
  tokenSecret: string
  /** Browser origins allowed to call the API (already cleaned; see cors.ts). */
  allowedOrigins?: string[]
  /**
   * Behind a proxy every visitor shares one address unless this says how many proxies (or which addresses) sit in front: a hop count
   * (1 = one reverse proxy), or a list of proxy addresses / ranges. The caller's address is then the one the nearest trusted proxy saw,
   * read from the END of X-Forwarded-For, so a caller cannot choose their own by writing that header (BE-044). Off locally.
   * `true` is read as 1 (never as "trust every hop", which let the caller pick their address). startup.ts parseTrustProxy makes these.
   */
  trustProxy?: boolean | number | string[]
  clock?: () => Date
  /**
   * true = log to stdout. One short line per request (method, route pattern, status, milliseconds), no body, no header, no address,
   * nothing from the query string: the route pattern is used, never the address as written, so a link token can not reach a log.
   * An object picks the level and where the lines go (tests). The level otherwise comes from `logLevel`.
   */
  logger?: boolean | { level?: string; stream?: { write(line: string): void } }
  /** fatal | error | warn | info | debug | trace | silent. Default info. startup.ts parseLogLevel reads LOG_LEVEL. */
  logLevel?: string
  /** A request that has not finished arriving after this long (ms) is dropped: a phone trickling a photo body must not hold a socket for ever. Default 120000. */
  requestTimeoutMs?: number
  /** Where photo bytes are kept. Without it the photo routes answer 503 instead of pretending to work. */
  media?: MediaStore
  /** A full refresh of the warnings runs at least this often (ms); 0 = after every change. Default 5 minutes (WARNING_FULL_REFRESH_MS). */
  warningFullRefreshMs?: number
  /**
   * How long (ms) the sign-in check may remember an account's state (token version, stopped, unit) instead of asking the database on
   * every request. 0 = never remember. Default 5000. A change made through this process takes effect at once; one made by another
   * process or directly in the database, within this time. See authCache.ts.
   */
  authCacheMs?: number
  /** gzip for JSON bodies over 1 KB when the client accepts it. Default on. */
  compress?: boolean
}

declare module 'fastify' {
  interface FastifyRequest { claims?: TokenClaims; ctx?: Ctx; buyerId?: string }
  /** Every route registered, so a test can sweep them all and a new route is covered without anyone remembering to add it. */
  interface FastifyInstance { routeList: { method: string; url: string }[]; loginLimiter: LoginLimiter; authCache: AuthCache }
}

// HEAD is listed for the two probes: Fastify answers HEAD on every GET route, and a monitor that probes with HEAD must not see a 401 as an outage.
const PUBLIC = new Set(['GET /api/health', 'GET /api/status', 'HEAD /api/health', 'HEAD /api/status', 'POST /api/auth/login'])
const MAX_BATCH = 200
const STATUS_TTL_MS = 60_000

export function buildApp(opts: AppOptions): FastifyInstance {
  if (!opts.tokenSecret || opts.tokenSecret.length < 32) {
    throw new Error('TOKEN_SECRET must be set to at least 32 characters. Refusing to start without it.')
  }
  const clock = opts.clock ?? (() => new Date())
  const origins = new Set(opts.allowedOrigins ?? [])
  // Fastify 5.12 treats a bare number as "trust nobody" (it cannot check the immediate peer), which put every visitor behind a proxy in one
  // sign-in bucket. So a hop count is turned into the function it stands for: the first `hops` addresses (the socket, then each proxy's
  // entry in X-Forwarded-For) are proxies, and the caller is the first address after them, counted from the end. `true` is 1, not "all".
  const hops = opts.trustProxy === true ? 1 : opts.trustProxy
  const trustProxy = typeof hops === 'number' ? (hops >= 1 ? (_addr: string, hop: number) => hop < hops : false) : hops ?? false
  const logger = opts.logger === undefined || opts.logger === false ? false : {
    level: (typeof opts.logger === 'object' ? opts.logger.level : undefined) ?? opts.logLevel ?? 'info',
    base: null,   // no pid / hostname on every line
    serializers: { req: (r: { method?: string }) => ({ method: r.method }), res: (r: { statusCode?: number }) => ({ statusCode: r.statusCode }) },
    redact: ['req.headers.authorization', 'headers.authorization'],
    ...(typeof opts.logger === 'object' && opts.logger.stream ? { stream: opts.logger.stream } : {}),
  }
  // A log controller that logs no request: the two default lines per request ("incoming request", "request completed", about 366 bytes together) are
  // replaced by the one line below (O-11).
  const app = Fastify({ logger, trustProxy, logController: new LogController({ disableRequestLogging: true }), requestTimeout: opts.requestTimeoutMs ?? 120_000 })
  app.addHook('onResponse', async (req, reply) => {
    const route = req.is404 ? 'unmatched' : (req.routeOptions?.url ?? 'unmatched')   // the pattern, never the address as written
    if ((route === '/api/health' || route === '/api/status') && reply.statusCode < 400) return   // probe traffic is not worth a line
    req.log.info({ method: req.method, route, status: reply.statusCode, ms: Math.round(reply.elapsedTime) })
  })
  const routeList: { method: string; url: string }[] = []
  app.decorate('routeList', routeList)
  app.addHook('onRoute', (r) => { for (const m of [r.method].flat()) if (m !== 'HEAD' && m !== 'OPTIONS') routeList.push({ method: m, url: r.url }) })

  const authCache = createAuthCache(opts.authCacheMs ?? AUTH_CACHE_MS)
  app.decorate('authCache', authCache)
  registerHttpCache(app, { gzip: opts.compress !== false })

  // ---- CORS: exact-match allow list; nothing is allowed by default
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    // BE-071: with an allow-list, EVERY answer can differ by Origin (the allowed origin gets Access-Control-Allow-Origin, the others do not), so
    // every answer says so, or a cache could keep the one made for a stranger and serve it to the app.
    if (origins.size > 0) reply.header('Vary', 'Origin')
    if (origin && origins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Access-Control-Expose-Headers', 'ETag')   // so a page on another origin can read the validator and send it back
      if (req.method === 'OPTIONS') {
        reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        // The four X- headers are what the phone's photo upload sends (details travel in headers, the body is the raw JPEG).
        reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match, X-Client-Uuid, X-Order-Id, X-Stage, X-Date')
        reply.header('Access-Control-Max-Age', '600')
        return reply.code(204).send()
      }
    } else if (req.method === 'OPTIONS') {
      return reply.code(204).send()   // no CORS headers: the browser refuses the real request
    }
  })

  // ---- authentication: every route is guarded unless listed in PUBLIC, so a new route is guarded by default
  app.addHook('onRequest', async (req) => {
    if (req.method === 'OPTIONS') return
    // The route that matched, not the spelling in the address: "/api/%62uyer/orders" is the buyer route and must be treated as one
    // (a staff sign-in must never reach a buyer route, nor a link a staff route). Unmatched addresses fall back to the raw path.
    const path = req.routeOptions?.url ?? req.url.split('?')[0]
    if (PUBLIC.has(`${req.method} ${path}`)) return
    const header = req.headers.authorization
    const token = /^Bearer +(\S+) *$/i.exec(header ?? '')?.[1] ?? null   // the scheme word is case-insensitive (RFC 7235)
    if (path?.startsWith('/api/buyer/')) {
      // A buyer's link token opens ONLY the /api/buyer routes; a staff token does not, and a link token opens nothing else.
      const buyerId = token ? await opts.db.tx({ role: 'auth' }, (tx) => resolveBuyerToken(tx, token, clock())) : null
      if (!buyerId) throw new AppError(401, 'invalid_link', 'This link is not valid. Ask your contact for a new one.')
      req.buyerId = buyerId
      return
    }
    const claims = token ? verifyToken(token, opts.tokenSecret, clock()) : null
    if (!claims) throw new AppError(401, 'unauthenticated', 'Please sign in')
    // A token is only good while the account is: not stopped, not signed out everywhere, still in the same unit.
    // Remembered for a few seconds (authCache.ts); the routes that change an account forget it at once.
    const acct = await authCache.lookup(claims.sub, async () => (await opts.db.tx({ role: 'auth' }, (tx) => tx.query<AccountState>(
      'select token_version, disabled_at is not null as disabled, unit_id::text as unit_id from account where id = $1', [claims.sub])))[0])
    if (!acct || acct.disabled || acct.token_version !== (claims.ver ?? 0) || (claims.role === 'supervisor' && acct.unit_id !== (claims.unitId ?? null))) {
      throw new AppError(401, 'unauthenticated', 'Please sign in')
    }
    req.claims = claims
    req.ctx = claims.role === 'supervisor'
      ? { role: 'supervisor', unitId: claims.unitId! }
      : { role: 'merchandiser' }
  })

  // ---- errors: safe messages only; detail goes to the server log, never to the caller
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message } })
    const fault = clientFault(err)
    if (fault) return reply.code(fault.status).send({ error: { code: fault.code, message: fault.message } })
    const dup = duplicateFault(err)   // the loser of a create race: the same plain 409 as the check
    if (dup) return reply.code(dup.status).send({ error: { code: dup.code, message: dup.message } })
    const status = (err as { statusCode?: number }).statusCode
    if (status === 413) {
      // A body over the limit will never fit, however often it is sent: say so with a stable code the phone can act on.
      const photo = req.routeOptions?.url === '/api/photos' || String(req.headers['content-type'] ?? '').toLowerCase().startsWith('image/jpeg')
      return reply.code(413).send({ error: photo ? { code: 'photo_too_large', message: 'That photo is too large' } : { code: 'too_large', message: 'That request is too large' } })
    }
    if (status && status >= 400 && status < 500) return reply.code(400).send({ error: { code: 'bad_request', message: 'Invalid request' } })
    req.log.error({ err }, 'unhandled error')
    return reply.code(500).send({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } })
  })
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }))

  const ctxOf = (req: FastifyRequest): Ctx => { if (!req.ctx) throw new AppError(401, 'unauthenticated', 'Please sign in'); return req.ctx }
  // Anything that can change a colour or a planned date brings the warnings up to date at once, so a buyer
  // never reads one the engine no longer backs. As the system, and never allowed to fail the change itself.
  // Only what the change touched is recomputed (a scope); the first refresh, a new factory day and a failed one are full. Never throws.
  const warnings = new WarningRefresher({ db: opts.db, clock, fullEveryMs: opts.warningFullRefreshMs, onError: (e) => app.log.error({ err: e }, 'warning refresh failed') })
  const refreshAfter = (req: FastifyRequest, scope?: RefreshScope) => warnings.request(scope, (e) => req.log.error({ err: e }, 'warning refresh failed'))

  // ---- public
  app.get('/api/health', async () => ({ ok: true }))

  let statusCache: { at: number; body: unknown } | null = null
  app.get('/api/status', async () => {
    const now = clock().getTime()
    if (statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.body
    const started = Date.now()
    let dbState: 'up' | 'down' = 'up'
    try { await opts.db.tx({ role: 'auth' }, (tx) => tx.query('select 1')) } catch { dbState = 'down' }
    const checks = [
      { name: 'API', state: 'up' },
      { name: 'Database', state: dbState, ms: Date.now() - started },
    ]
    const body = { ok: checks.every((c) => c.state === 'up'), checkedAt: clock().toISOString(), checks }
    statusCache = { at: now, body }
    return body
  })

  // The sign-in budget (loginLimiter.ts): keyed on req.ip, which with a trusted-proxy setting is the address the nearest trusted proxy
  // saw. Bounded, swept on a timer that does not keep the process alive, and no entry for a try that spends nothing.
  const limiter = createLoginLimiter()
  app.decorate('loginLimiter', limiter)
  const stopSweep = limiter.start(() => clock().getTime())
  app.addHook('onClose', async () => { stopSweep() })
  app.post('/api/auth/login', async (req, reply) => {
    const now = clock()
    if (limiter.blocked(req.ip, now.getTime())) throw new AppError(429, 'rate_limited', 'Too many attempts. Please wait and try again.')
    const body = req.body
    if (typeof body !== 'object' || body === null) throw badRequest('Invalid request')
    // Spend the budget before the await and give it back if this try does not count, so a burst
    // of requests in flight together cannot all pass the check above.
    const spent = limiter.spend(req.ip, now.getTime())
    try {
      const result = await login(opts.db, body as LoginInput, opts.tokenSecret, now)
      // A successful sign-in does not spend the budget, but it does not refund failures already spent either.
      spent.refund()
      return result
    } catch (e) {
      const counted = e instanceof AppError && (e.code === 'invalid_credentials' || e.code === 'locked')
      if (!counted) spent.refund()
      throw e
    } finally {
      reply.header('Cache-Control', 'no-store')
    }
  })

  // ---- signed in
  app.get('/api/me', async (req) => ({ role: req.claims!.role, unitId: req.claims!.unitId ?? null }))

  app.get('/api/board', async (req, reply) => {
    const ctx = ctxOf(req)
    const today = istDate(clock())   // one reading, so the rows and the "today" beside them can never name different days
    const rows = await opts.db.tx(ctx, (tx) => getBoard(tx, ctx, today))
    reply.header('Cache-Control', 'no-store')
    return { today, rows }
  })

  // ---- photos
  // A photo arrives as the raw JPEG (not JSON), with its details in headers.
  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: MAX_PHOTO_BYTES + 1024 }, (_req, body, done) => done(null, body))
  const mediaOr503 = (): MediaStore => { if (!opts.media) throw new AppError(503, 'photos_unavailable', 'Photos are not set up on this server'); return opts.media }
  const sendPhoto = (reply: import('fastify').FastifyReply, bytes: Buffer) => reply
    .header('Content-Type', 'image/jpeg').header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').send(bytes)

  app.post('/api/photos', { bodyLimit: MAX_PHOTO_BYTES + 1024 }, async (req) => {
    const ctx = ctxOf(req)
    const media = mediaOr503()
    const h = req.headers
    // The stage name travels URL-encoded in a header (it may be Tamil). Bad escapes are the caller's mistake, not a crash.
    let stage = ''
    if (typeof h['x-stage'] === 'string') {
      try { stage = decodeURIComponent(h['x-stage']) } catch { throw badRequest('x-stage is not valid: send the stage name URL-encoded') }
      if (!isStageName(stage)) throw badRequest('x-stage is not a valid stage name')
    }
    if (!Buffer.isBuffer(req.body)) throw badRequest('Send the photo as image/jpeg')
    // No transaction is open while the photo store works (savePhoto, BE-046).
    return savePhoto(opts.db, ctx, media, {
      clientUuid: String(h['x-client-uuid'] ?? ''), orderId: String(h['x-order-id'] ?? ''), stage, date: String(h['x-date'] ?? ''), bytes: req.body as Buffer,
    }, istDate(clock()), (_key, err) => req.log.warn({ err }, 'photo upload: could not delete an object that has no row'))
  })
  app.get<{ Params: { id: string } }>('/api/photos/:id/file', async (req, reply) => {
    const ctx = ctxOf(req)
    const media = mediaOr503()
    return sendPhoto(reply, await getPhotoBytes(opts.db, ctx, media, req.params.id))
  })
  app.post<{ Params: { id: string } }>('/api/photos/:id/approve', async (req) => {
    const ctx = ctxOf(req)
    await opts.db.tx(ctx, (tx) => approvePhoto(tx, ctx, req.claims!.sub, req.params.id))
    return { ok: true }
  })
  app.post<{ Params: { id: string } }>('/api/photos/:id/reject', async (req) => {
    const ctx = ctxOf(req)
    await opts.db.tx(ctx, (tx) => rejectPhoto(tx, ctx, req.params.id))
    return { ok: true }
  })
  app.get<{ Params: { id: string } }>('/api/buyer/photos/:id', async (req, reply) => {
    const ctx: Ctx = { role: 'buyer', buyerId: req.buyerId! }
    const media = mediaOr503()
    return sendPhoto(reply, await getBuyerPhotoBytes(opts.db, ctx, media, ctx.buyerId!, req.params.id))
  })

  // ---- setup: people, units, closed days, templates, photo clean-up (merchandisers)
  app.post('/api/photos/purge', async (req) => {
    const ctx = ctxOf(req)
    if (!isStaff(ctx)) throw forbidden()   // before the 503: a supervisor must not learn how the server is set up
    // Only a number, or text that is all digits, is a number of days: Number('') and Number([]) are 0 and would delete every rejected file at once.
    const raw = (req.body as { days?: unknown } | null)?.days ?? 7
    const days = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,5}$/.test(raw) ? Number(raw) : NaN
    return { purged: await purgeRejectedPhotos(opts.db, ctx, mediaOr503(), days) }
  })
  app.get('/api/units', async (req, reply) => { const ctx = ctxOf(req); reply.header('Cache-Control', 'no-store'); return { units: await opts.db.tx(ctx, (tx) => listUnits(tx, ctx)) } })
  app.post('/api/units', async (req, reply) => { const ctx = ctxOf(req); return reply.code(201).send(await opts.db.tx(ctx, (tx) => createUnit(tx, ctx, (req.body ?? {}) as never))) })
  app.get('/api/accounts', async (req, reply) => { const ctx = ctxOf(req); reply.header('Cache-Control', 'no-store'); return { accounts: await opts.db.tx(ctx, (tx) => listAccounts(tx, ctx, clock())) } })
  // The audit trail of the actions below. A fixed path, and GET only: it cannot be read as an ":id" route.
  app.get('/api/accounts/audit', async (req, reply) => {
    const ctx = ctxOf(req); reply.header('Cache-Control', 'no-store')
    return { entries: await opts.db.tx(ctx, (tx) => listAudit(tx, ctx, (req.query as { subject?: unknown }).subject)) }
  })
  // Each route that changes an account forgets what the sign-in check remembers about it as soon as its transaction has ended
  // (in a finally: also when the answer to the commit was lost, because the change may have happened). Without this the next request
  // would still be let in for up to authCacheMs. Moving a supervisor to another unit has no route; it is done in SQL (see authCache.ts).
  const changingAccount = async <T>(id: unknown, work: () => Promise<T>): Promise<T> => {
    try { return await work() } finally { authCache.invalidate(typeof id === 'string' ? id : undefined) }
  }
  app.post('/api/accounts/supervisors', async (req, reply) => { const ctx = ctxOf(req); return reply.code(201).send(await changingAccount(undefined, () => opts.db.tx(ctx, (tx) => createSupervisor(tx, ctx, (req.body ?? {}) as never, req.claims!.sub)))) })
  app.post('/api/accounts/merchandisers', async (req, reply) => { const ctx = ctxOf(req); return reply.code(201).send(await changingAccount(undefined, () => opts.db.tx(ctx, (tx) => createMerchandiser(tx, ctx, (req.body ?? {}) as never, req.claims!.sub)))) })
  app.post<{ Params: { id: string } }>('/api/accounts/:id/pin', async (req) => { const ctx = ctxOf(req); await changingAccount(req.params.id, () => opts.db.tx(ctx, (tx) => resetPin(tx, ctx, req.params.id, (req.body as { pin?: unknown } | null)?.pin, req.claims!.sub))); return { ok: true } })
  app.post<{ Params: { id: string } }>('/api/accounts/:id/sign-out', async (req) => { const ctx = ctxOf(req); await changingAccount(req.params.id, () => opts.db.tx(ctx, (tx) => signOutEverywhere(tx, ctx, req.params.id, req.claims!.sub))); return { ok: true } })
  app.post<{ Params: { id: string } }>('/api/accounts/:id/disabled', async (req) => { const ctx = ctxOf(req); await changingAccount(req.params.id, () => opts.db.tx(ctx, (tx) => setDisabled(tx, ctx, req.claims!.sub, req.params.id, (req.body as { disabled?: unknown } | null)?.disabled))); return { ok: true } })
  app.get('/api/calendar', async (req, reply) => {
    const ctx = ctxOf(req); reply.header('Cache-Control', 'no-store')
    const unitId = (req.query as { unitId?: string }).unitId
    return { days: await opts.db.tx(ctx, (tx) => listCalendar(tx, ctx, unitId)) }
  })
  app.post('/api/calendar', async (req) => { const ctx = ctxOf(req); await opts.db.tx(ctx, (tx) => setCalendarDay(tx, ctx, (req.body ?? {}) as never)); await refreshAfter(req, { unitId: String((req.body as { unitId?: unknown }).unitId) }); return { ok: true } })
  app.post('/api/calendar/clear', async (req) => { const ctx = ctxOf(req); await opts.db.tx(ctx, (tx) => clearCalendarDay(tx, ctx, (req.body ?? {}) as never)); await refreshAfter(req, { unitId: String((req.body as { unitId?: unknown }).unitId) }); return { ok: true } })
  app.get('/api/templates', async (req, reply) => { const ctx = ctxOf(req); reply.header('Cache-Control', 'no-store'); return { templates: await opts.db.tx(ctx, (tx) => listTemplates(tx, ctx)) } })
  app.post('/api/templates', async (req, reply) => {
    const ctx = ctxOf(req)
    const input = (req.body ?? {}) as { id?: unknown }
    const saved = await opts.db.tx(ctx, (tx) => saveTemplate(tx, ctx, input as never))
    return reply.code(input.id === undefined || input.id === null ? 201 : 200).send(saved)   // like every other create: 201 for a new one, 200 for a change
  })
  app.post<{ Params: { id: string } }>('/api/templates/:id/delete', async (req) => { const ctx = ctxOf(req); await opts.db.tx(ctx, (tx) => deleteTemplate(tx, ctx, req.params.id)); return { ok: true } })

  // ---- the buyer's read-only view (link token, not a sign-in)
  app.get('/api/buyer/orders', async (req, reply) => {
    const ctx: Ctx = { role: 'buyer', buyerId: req.buyerId! }
    reply.header('Cache-Control', 'no-store')
    reply.header('Referrer-Policy', 'no-referrer')
    return opts.db.tx(ctx, (tx) => getBuyerView(tx, ctx))
  })

  // The same orders as a file for Excel. Built from the buyer view above, so it can show nothing the page does not.
  const sendCsv = (reply: import('fastify').FastifyReply, view: BuyerView) => reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${exportFileName(view.buyer.name, istDate(clock()))}"`)
    .header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff')
    .send(buyerExportCsv(view))
  app.get('/api/buyer/export.csv', async (req, reply) => {
    const ctx: Ctx = { role: 'buyer', buyerId: req.buyerId! }
    return sendCsv(reply, await opts.db.tx(ctx, (tx) => getBuyerView(tx, ctx)))
  })
  app.get<{ Params: { id: string } }>('/api/buyers/:id/export.csv', async (req, reply) => {
    const ctx = ctxOf(req)
    return sendCsv(reply, await opts.db.tx(ctx, (tx) => getBuyerViewFor(tx, ctx, req.params.id)))
  })

  // ---- the review gate and buyer links (merchandisers)
  app.get('/api/review', async (req, reply) => {
    const ctx = ctxOf(req)
    // Bring the warnings up to date first, as the system, so the queue is never stale. A failed refresh never blocks the list.
    await warnings.ensureFresh((e) => req.log.error({ err: e }, 'warning refresh failed'))   // a full refresh only if something is dirty, the day changed or it has been a while
    reply.header('Cache-Control', 'no-store')
    return opts.db.tx(ctx, async (tx) => ({
      ...(await listReview(tx, ctx)), photos: await listPendingPhotos(tx, ctx), approvedPhotos: await listApprovedPhotos(tx, ctx),
      notes: await listPendingNotes(tx, ctx), reasons: await loadReasons(tx),
    }))
  })
  app.post<{ Params: { id: string } }>('/api/warnings/:id/confirm', async (req) => {
    const ctx = ctxOf(req)
    const { text, seenStatus, seenText } = (req.body ?? {}) as { text?: string; seenStatus?: unknown; seenText?: unknown }
    await opts.db.tx(ctx, (tx) => confirmWarning(tx, ctx, req.claims!.sub, req.params.id, text, { status: seenStatus, text: seenText }))
    return { ok: true }
  })
  app.post<{ Params: { id: string } }>('/api/notes/:id/confirm', async (req) => {
    const ctx = ctxOf(req)
    await opts.db.tx(ctx, (tx) => confirmNote(tx, ctx, req.claims!.sub, req.params.id, (req.body ?? {}) as { textEn?: string; category?: string }))
    return { ok: true }
  })
  // The fixed list of reasons, for the phone's picker. Any signed-in person may read it.
  app.get('/api/reasons', async (req, reply) => {
    const ctx = ctxOf(req)
    reply.header('Cache-Control', 'no-store')
    return { reasons: await opts.db.tx(ctx, (tx) => loadReasons(tx)) }
  })

  app.post<{ Params: { id: string } }>('/api/warnings/:id/dismiss', async (req) => {
    const ctx = ctxOf(req)
    await opts.db.tx(ctx, (tx) => dismissWarning(tx, ctx, req.params.id))
    return { ok: true }
  })
  // Undo "Don't show" for a warning that was still waiting for review. A confirmed one cannot be undone (409 needs_confirmation).
  app.post<{ Params: { id: string } }>('/api/warnings/:id/undo-dismiss', async (req) => {
    const ctx = ctxOf(req)
    await opts.db.tx(ctx, (tx) => undoDismissWarning(tx, ctx, req.params.id, istDate(clock())))
    return { ok: true }
  })
  // Mocked alerts (nothing is sent): the latest 50, newest first.
  app.get('/api/outbox', async (req, reply) => {
    const ctx = ctxOf(req)
    reply.header('Cache-Control', 'no-store')
    return { alerts: await opts.db.tx(ctx, (tx) => listOutbox(tx, ctx)) }
  })
  app.get('/api/buyer-links', async (req, reply) => {
    const ctx = ctxOf(req)
    reply.header('Cache-Control', 'no-store')
    return { links: await opts.db.tx(ctx, (tx) => listBuyerLinks(tx, ctx, clock())) }
  })
  app.post('/api/buyer-links', async (req, reply) => {
    const ctx = ctxOf(req)
    reply.header('Cache-Control', 'no-store')
    const made = await opts.db.tx(ctx, (tx) => createBuyerLink(tx, ctx, (req.body ?? {}) as { buyerId: string; days?: number; label?: string }, clock()))
    return reply.code(201).send(made)
  })
  app.post<{ Params: { id: string } }>('/api/buyer-links/:id/revoke', async (req) => {
    const ctx = ctxOf(req)
    await opts.db.tx(ctx, (tx) => revokeBuyerLink(tx, ctx, req.params.id))
    return { ok: true }
  })

  app.get('/api/my/stages', async (req, reply) => {
    const ctx = ctxOf(req)
    const today = istDate(clock())
    const stages = await opts.db.tx(ctx, (tx) => getMyStages(tx, ctx, today))
    reply.header('Cache-Control', 'no-store')
    return { today, stages }
  })

  // Static paths first: "options" and "preview" must not be read as an order id.
  app.get('/api/orders/options', async (req, reply) => {
    const ctx = ctxOf(req)
    reply.header('Cache-Control', 'no-store')
    return opts.db.tx(ctx, (tx) => getOrderOptions(tx, ctx))
  })

  app.post('/api/orders/preview', async (req, reply) => {
    const ctx = ctxOf(req)
    const { templateId, exFactory, sizes } = (req.body ?? {}) as { templateId?: string; exFactory?: string; sizes?: unknown }
    reply.header('Cache-Control', 'no-store')
    return opts.db.tx(ctx, (tx) => previewSchedule(tx, ctx, { templateId: templateId as string, exFactory: exFactory as string, sizes }, istDate(clock())))
  })

  app.get<{ Params: { id: string } }>('/api/orders/:id', async (req, reply) => {
    const ctx = ctxOf(req)
    reply.header('Cache-Control', 'no-store')
    return opts.db.tx(ctx, (tx) => getOrderDetail(tx, ctx, req.params.id, istDate(clock())))
  })

  app.post('/api/orders', async (req, reply) => {
    const ctx = ctxOf(req)
    const created = await opts.db.tx(ctx, (tx) => createOrder(tx, ctx, req.body as NewOrder, istDate(clock())))
    await refreshAfter(req, { orderId: created.orderId })   // an order that starts late has its warning at once, not when someone next opens the review
    return reply.code(201).send(created)
  })

  app.post<{ Params: { id: string } }>('/api/orders/:id/ex-factory', async (req) => {
    const ctx = ctxOf(req)
    const { exFactory, reason } = (req.body ?? {}) as { exFactory?: string; reason?: string }
    const changed = await opts.db.tx(ctx, (tx) => changeExFactory(tx, ctx, req.claims!.sub, req.params.id, exFactory as string, reason as string))
    await refreshAfter(req, { orderId: req.params.id })
    return changed
  })

  app.post('/api/events', async (req) => {
    const ctx = ctxOf(req)
    const result = await opts.db.tx(ctx, (tx) => submitEvent(tx, ctx, req.body as EventInput, istDate(clock()), req.claims!.sub))
    await refreshAfter(req, { orderId: (req.body as EventInput).orderId })   // updates change colours, as in the batch route below
    return { ok: true, duplicate: result.duplicate }
  })

  // The offline queue sends a batch. One bad item must not sink the rest, and a retry of
  // the whole batch is safe because every item is idempotent on clientUuid.
  app.post('/api/events/batch', async (req) => {
    const ctx = ctxOf(req)
    const events = (req.body as { events?: unknown } | null)?.events
    if (!Array.isArray(events) || events.length === 0 || events.length > MAX_BATCH) throw badRequest(`events must be a list of 1 to ${MAX_BATCH}`)
    const today = istDate(clock())
    const results = []
    const touched = new Set<string>()   // the orders whose updates were stored (or were already), for the refresh below
    for (const raw of events as EventInput[]) {
      const clientUuid = (raw as { clientUuid?: unknown } | null)?.clientUuid
      try {
        const r = await opts.db.tx(ctx, (tx) => submitEvent(tx, ctx, raw, today, req.claims!.sub))
        results.push({ clientUuid, result: r.duplicate ? 'duplicate' : 'accepted' })
        touched.add(raw.orderId)
      } catch (e) {
        const fault = e instanceof AppError ? e : clientFault(e)   // a value the database refuses is this item's fault, not the server's
        if (!fault) { warnings.markDirty(); throw e }   // infrastructure trouble: fail the request so the client retries all (items stored so far get a full refresh next time)
        results.push({ clientUuid, result: 'rejected', code: fault.code, message: fault.message })
      }
    }
    // Updates change colours, so bring the warnings up to date. As the system, and never allowed to fail the send.
    if (touched.size) await refreshAfter(req, { orderIds: [...touched] })
    return { results }
  })

  return app
}
