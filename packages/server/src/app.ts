import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { verifyToken, type TokenClaims } from './auth.js'
import { login, type LoginInput } from './authService.js'
import { getBoard } from './boardService.js'
import type { Ctx, Db } from './db.js'
import { AppError, badRequest } from './errors.js'
import { submitEvent, type EventInput } from './eventService.js'
import { changeExFactory, createOrder, getOrderOptions, previewSchedule, type NewOrder } from './orderService.js'
import { getOrderDetail } from './orderDetailService.js'
import { getMyStages } from './myService.js'
import { confirmWarning, dismissWarning, listReview, refreshWarnings } from './warningService.js'
import {
  clearCalendarDay, createMerchandiser, createSupervisor, createUnit, deleteTemplate, listAccounts, listCalendar, listTemplates, listUnits,
  resetPin, saveTemplate, setCalendarDay, setDisabled, signOutEverywhere,
} from './adminService.js'
import { confirmNote, listPendingNotes, loadReasons } from './noteService.js'
import { approvePhoto, getBuyerPhotoBytes, listApprovedPhotos, purgeRejectedPhotos, getPhotoBytes, listPendingPhotos, MAX_PHOTO_BYTES, rejectPhoto, savePhoto } from './photoService.js'
import type { MediaStore } from './mediaStore.js'
import { createBuyerLink, getBuyerView, listBuyerLinks, resolveBuyerToken, revokeBuyerLink } from './buyerService.js'
import { istDate } from './today.js'

export interface AppOptions {
  db: Db
  /** Signs tokens. Required, at least 32 characters: with no secret the server will not start (fails closed). */
  tokenSecret: string
  /** Browser origins allowed to call the API (already cleaned; see cors.ts). */
  allowedOrigins?: string[]
  /** Behind a proxy every visitor shares one address unless this is on. Off locally: it would let a caller choose their own IP. */
  trustProxy?: boolean
  clock?: () => Date
  logger?: boolean
  /** Where photo bytes are kept. Without it the photo routes answer 503 instead of pretending to work. */
  media?: MediaStore
}

declare module 'fastify' {
  interface FastifyRequest { claims?: TokenClaims; ctx?: Ctx; buyerId?: string }
}

const PUBLIC = new Set(['GET /api/health', 'GET /api/status', 'POST /api/auth/login'])
const MAX_BATCH = 200
const LOGIN_BUDGET = 10                // failed sign-ins per address per window
const LOGIN_WINDOW_MS = 15 * 60_000
const STATUS_TTL_MS = 60_000

export function buildApp(opts: AppOptions): FastifyInstance {
  if (!opts.tokenSecret || opts.tokenSecret.length < 32) {
    throw new Error('TOKEN_SECRET must be set to at least 32 characters. Refusing to start without it.')
  }
  const clock = opts.clock ?? (() => new Date())
  const origins = new Set(opts.allowedOrigins ?? [])
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? false })

  // ---- CORS: exact-match allow list; nothing is allowed by default
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin
    if (origin && origins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Vary', 'Origin')
      if (req.method === 'OPTIONS') {
        reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
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
    const path = req.url.split('?')[0]
    if (PUBLIC.has(`${req.method} ${path}`)) return
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null
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
    const acct = (await opts.db.tx({ role: 'auth' }, (tx) => tx.query<{ token_version: number; disabled: boolean; unit_id: string | null }>(
      'select token_version, disabled_at is not null as disabled, unit_id::text as unit_id from account where id = $1', [claims.sub])))[0]
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
    const status = (err as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) return reply.code(400).send({ error: { code: 'bad_request', message: 'Invalid request' } })
    req.log.error({ err }, 'unhandled error')
    return reply.code(500).send({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } })
  })
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }))

  const ctxOf = (req: FastifyRequest): Ctx => { if (!req.ctx) throw new AppError(401, 'unauthenticated', 'Please sign in'); return req.ctx }

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

  const failures = new Map<string, { count: number; resetAt: number }>()
  app.post('/api/auth/login', async (req, reply) => {
    const now = clock()
    const f = failures.get(req.ip)
    if (f && f.resetAt > now.getTime() && f.count >= LOGIN_BUDGET) throw new AppError(429, 'rate_limited', 'Too many attempts. Please wait and try again.')
    const body = req.body
    if (typeof body !== 'object' || body === null) throw badRequest('Invalid request')
    try {
      const result = await login(opts.db, body as LoginInput, opts.tokenSecret, now)
      failures.delete(req.ip)          // a successful sign-in does not spend the budget
      return result
    } catch (e) {
      if (e instanceof AppError && (e.code === 'invalid_credentials' || e.code === 'locked')) {
        const cur = f && f.resetAt > now.getTime() ? f : { count: 0, resetAt: now.getTime() + LOGIN_WINDOW_MS }
        failures.set(req.ip, { count: cur.count + 1, resetAt: cur.resetAt })
      }
      throw e
    } finally {
      reply.header('Cache-Control', 'no-store')
    }
  })

  // ---- signed in
  app.get('/api/me', async (req) => ({ role: req.claims!.role, unitId: req.claims!.unitId ?? null }))

  app.get('/api/board', async (req, reply) => {
    const ctx = ctxOf(req)
    const rows = await opts.db.tx(ctx, (tx) => getBoard(tx, ctx, istDate(clock())))
    reply.header('Cache-Control', 'no-store')
    return { today: istDate(clock()), rows }
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
    const stage = typeof h['x-stage'] === 'string' ? decodeURIComponent(h['x-stage']) : ''
    if (!Buffer.isBuffer(req.body)) throw badRequest('Send the photo as image/jpeg')
    return opts.db.tx(ctx, (tx) => savePhoto(tx, ctx, media, {
      clientUuid: String(h['x-client-uuid'] ?? ''), orderId: String(h['x-order-id'] ?? ''), stage, date: String(h['x-date'] ?? ''), bytes: req.body as Buffer,
    }, istDate(clock())))
  })
  app.get<{ Params: { id: string } }>('/api/photos/:id/file', async (req, reply) => {
    const ctx = ctxOf(req)
    const media = mediaOr503()
    return sendPhoto(reply, await opts.db.tx(ctx, (tx) => getPhotoBytes(tx, media, req.params.id)))
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
    return sendPhoto(reply, await opts.db.tx(ctx, (tx) => getBuyerPhotoBytes(tx, media, ctx.buyerId!, req.params.id)))
  })

  // ---- setup: people, units, closed days, templates, photo clean-up (merchandisers)
  app.post('/api/photos/purge', async (req) => {
    const ctx = ctxOf(req)
    const days = Number((req.body as { days?: unknown } | null)?.days ?? 7)
    return { purged: await opts.db.tx(ctx, (tx) => purgeRejectedPhotos(tx, ctx, mediaOr503(), days)) }
  })
  app.get('/api/units', async (req, reply) => { const ctx = ctxOf(req); reply.header('Cache-Control', 'no-store'); return { units: await opts.db.tx(ctx, (tx) => listUnits(tx, ctx)) } })
  app.post('/api/units', async (req, reply) => { const ctx = ctxOf(req); return reply.code(201).send(await opts.db.tx(ctx, (tx) => createUnit(tx, ctx, (req.body ?? {}) as never))) })
  app.get('/api/accounts', async (req, reply) => { const ctx = ctxOf(req); reply.header('Cache-Control', 'no-store'); return { accounts: await opts.db.tx(ctx, (tx) => listAccounts(tx, ctx, clock())) } })
  app.post('/api/accounts/supervisors', async (req, reply) => { const ctx = ctxOf(req); return reply.code(201).send(await opts.db.tx(ctx, (tx) => createSupervisor(tx, ctx, (req.body ?? {}) as never))) })
  app.post('/api/accounts/merchandisers', async (req, reply) => { const ctx = ctxOf(req); return reply.code(201).send(await opts.db.tx(ctx, (tx) => createMerchandiser(tx, ctx, (req.body ?? {}) as never))) })
  app.post<{ Params: { id: string } }>('/api/accounts/:id/pin', async (req) => { const ctx = ctxOf(req); await opts.db.tx(ctx, (tx) => resetPin(tx, ctx, req.params.id, (req.body as { pin?: unknown } | null)?.pin)); return { ok: true } })
  app.post<{ Params: { id: string } }>('/api/accounts/:id/sign-out', async (req) => { const ctx = ctxOf(req); await opts.db.tx(ctx, (tx) => signOutEverywhere(tx, ctx, req.params.id)); return { ok: true } })
  app.post<{ Params: { id: string } }>('/api/accounts/:id/disabled', async (req) => { const ctx = ctxOf(req); await opts.db.tx(ctx, (tx) => setDisabled(tx, ctx, req.claims!.sub, req.params.id, (req.body as { disabled?: unknown } | null)?.disabled)); return { ok: true } })
  app.get('/api/calendar', async (req, reply) => {
    const ctx = ctxOf(req); reply.header('Cache-Control', 'no-store')
    const unitId = (req.query as { unitId?: string }).unitId
    return { days: await opts.db.tx(ctx, (tx) => listCalendar(tx, ctx, unitId)) }
  })
  app.post('/api/calendar', async (req) => { const ctx = ctxOf(req); await opts.db.tx(ctx, (tx) => setCalendarDay(tx, ctx, (req.body ?? {}) as never)); return { ok: true } })
  app.post('/api/calendar/clear', async (req) => { const ctx = ctxOf(req); await opts.db.tx(ctx, (tx) => clearCalendarDay(tx, ctx, (req.body ?? {}) as never)); return { ok: true } })
  app.get('/api/templates', async (req, reply) => { const ctx = ctxOf(req); reply.header('Cache-Control', 'no-store'); return { templates: await opts.db.tx(ctx, (tx) => listTemplates(tx, ctx)) } })
  app.post('/api/templates', async (req) => { const ctx = ctxOf(req); return opts.db.tx(ctx, (tx) => saveTemplate(tx, ctx, (req.body ?? {}) as never)) })
  app.post<{ Params: { id: string } }>('/api/templates/:id/delete', async (req) => { const ctx = ctxOf(req); await opts.db.tx(ctx, (tx) => deleteTemplate(tx, ctx, req.params.id)); return { ok: true } })

  // ---- the buyer's read-only view (link token, not a sign-in)
  app.get('/api/buyer/orders', async (req, reply) => {
    const ctx: Ctx = { role: 'buyer', buyerId: req.buyerId! }
    reply.header('Cache-Control', 'no-store')
    reply.header('Referrer-Policy', 'no-referrer')
    return opts.db.tx(ctx, (tx) => getBuyerView(tx, ctx))
  })

  // ---- the review gate and buyer links (merchandisers)
  app.get('/api/review', async (req, reply) => {
    const ctx = ctxOf(req)
    // Bring the warnings up to date first, as the system, so the queue is never stale.
    await opts.db.tx({ role: 'system' }, (tx) => refreshWarnings(tx, { role: 'system' }, istDate(clock())))
    reply.header('Cache-Control', 'no-store')
    return opts.db.tx(ctx, async (tx) => ({
      ...(await listReview(tx, ctx)), photos: await listPendingPhotos(tx, ctx), approvedPhotos: await listApprovedPhotos(tx, ctx),
      notes: await listPendingNotes(tx, ctx), reasons: await loadReasons(tx),
    }))
  })
  app.post<{ Params: { id: string } }>('/api/warnings/:id/confirm', async (req) => {
    const ctx = ctxOf(req)
    const { text } = (req.body ?? {}) as { text?: string }
    await opts.db.tx(ctx, (tx) => confirmWarning(tx, ctx, req.claims!.sub, req.params.id, text))
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
    const { templateId, exFactory } = (req.body ?? {}) as { templateId?: string; exFactory?: string }
    reply.header('Cache-Control', 'no-store')
    return opts.db.tx(ctx, (tx) => previewSchedule(tx, ctx, { templateId: templateId as string, exFactory: exFactory as string }, istDate(clock())))
  })

  app.get<{ Params: { id: string } }>('/api/orders/:id', async (req, reply) => {
    const ctx = ctxOf(req)
    reply.header('Cache-Control', 'no-store')
    return opts.db.tx(ctx, (tx) => getOrderDetail(tx, ctx, req.params.id, istDate(clock())))
  })

  app.post('/api/orders', async (req, reply) => {
    const ctx = ctxOf(req)
    const created = await opts.db.tx(ctx, (tx) => createOrder(tx, ctx, req.body as NewOrder, istDate(clock())))
    return reply.code(201).send(created)
  })

  app.post<{ Params: { id: string } }>('/api/orders/:id/ex-factory', async (req) => {
    const ctx = ctxOf(req)
    const { exFactory, reason } = (req.body ?? {}) as { exFactory?: string; reason?: string }
    return opts.db.tx(ctx, (tx) => changeExFactory(tx, ctx, req.claims!.sub, req.params.id, exFactory as string, reason as string))
  })

  app.post('/api/events', async (req) => {
    const ctx = ctxOf(req)
    const result = await opts.db.tx(ctx, (tx) => submitEvent(tx, ctx, req.body as EventInput, istDate(clock())))
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
    for (const raw of events as EventInput[]) {
      const clientUuid = (raw as { clientUuid?: unknown } | null)?.clientUuid
      try {
        const r = await opts.db.tx(ctx, (tx) => submitEvent(tx, ctx, raw, today))
        results.push({ clientUuid, result: r.duplicate ? 'duplicate' : 'accepted' })
      } catch (e) {
        if (!(e instanceof AppError)) throw e   // infrastructure trouble: fail the request so the client retries all
        results.push({ clientUuid, result: 'rejected', code: e.code, message: e.message })
      }
    }
    // Updates change colours, so bring the warnings up to date. As the system, and never allowed to fail the send.
    try { await opts.db.tx({ role: 'system' }, (tx) => refreshWarnings(tx, { role: 'system' }, today)) } catch (e) { req.log.error({ err: e }, 'warning refresh failed') }
    return { results }
  })

  return app
}
