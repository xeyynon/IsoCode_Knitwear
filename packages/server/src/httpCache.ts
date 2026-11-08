import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import type { FastifyInstance } from 'fastify'

// Fewer bytes on the wire for the big JSON that phones and desktops poll every minute (O-4), with no new dependency.
//
//   compression  JSON bodies of GZIP_MIN_BYTES or more are gzipped (node:zlib, off the main thread) when the client says it accepts
//                gzip. Never photo bytes or a CSV: only application/json. Every response that COULD be compressed says
//                `Vary: Accept-Encoding`, so a cache never serves a compressed body to a client that cannot read it.
//   validators   the polled GET routes below carry an ETag (a hash of the body that was just built, plus who is asking) and answer
//                `If-None-Match` with 304 and no body when it still matches. The body is always built first and then hashed, so the
//                tag changes whenever the answer does, whatever caused the change (this process, another one, a direct edit in the
//                database). It saves bandwidth and the client's parsing, not the server's work.
//
// Cache-Control is not touched here: each route keeps what it says (no-store). See the report for what that means for browsers.

const gzipAsync = promisify(gzip)

export const GZIP_MIN_BYTES = 1024
export const GZIP_LEVEL = 4

/** Routes that carry a validator. "METHOD pattern", the pattern as registered (not the address as written). */
export const VALIDATED_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/board', 'GET /api/review', 'GET /api/my/stages', 'GET /api/buyer/orders',
])

/** `Vary` with one more token, without losing the ones already there (CORS adds `Origin`). */
function addVary(existing: unknown, token: string): string {
  const have = String(existing ?? '').split(',').map((t) => t.trim()).filter(Boolean)
  return have.some((t) => t.toLowerCase() === token.toLowerCase() || t === '*') ? have.join(', ') : [...have, token].join(', ')
}

/** True when the client lists gzip with a quality above zero. */
export function acceptsGzip(header: unknown): boolean {
  if (typeof header !== 'string') return false
  return header.split(',').some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    if (name!.trim() !== 'gzip') return false
    const q = params.map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p)?.[1]).find((x) => x !== undefined)
    return q === undefined || Number(q) > 0
  })
}

/** Does an If-None-Match header list this tag? Weak comparison (RFC 9110), `*` matches anything. */
export function matchesTag(header: unknown, tag: string): boolean {
  if (typeof header !== 'string') return false
  const bare = (t: string) => t.trim().replace(/^W\//, '')
  const mine = bare(tag)
  return header.split(',').some((t) => t.trim() === '*' || bare(t) === mine)
}

export function etagOf(scope: string, body: string | Buffer): string {
  return `W/"${createHash('sha1').update(scope).update('\0').update(body).digest('base64url')}"`
}

export interface HttpCacheOptions {
  /** Switch compression off (tests, or a proxy that already does it). Default on. */
  gzip?: boolean
  /** Switch validators off. Default on. */
  etag?: boolean
}

export function registerHttpCache(app: FastifyInstance, opts: HttpCacheOptions = {}): void {
  const useGzip = opts.gzip !== false
  const useEtag = opts.etag !== false
  app.addHook('onSend', async (req, reply, payload) => {
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload   // a stream or nothing: leave it alone
    if (!String(reply.getHeader('content-type') ?? '').toLowerCase().startsWith('application/json')) return payload
    if (reply.statusCode !== 200) return payload

    if (useEtag && req.method === 'GET' && VALIDATED_ROUTES.has(`GET ${req.routeOptions?.url}`)) {
      const who = req.buyerId ? `buyer:${req.buyerId}` : `${req.claims?.role ?? '-'}:${req.claims?.unitId ?? '-'}:${req.claims?.sub ?? '-'}`
      const tag = etagOf(who, payload)
      reply.header('ETag', tag)
      reply.header('Vary', addVary(reply.getHeader('vary'), 'Accept-Encoding'))
      if (matchesTag(req.headers['if-none-match'], tag)) {
        reply.code(304)
        reply.removeHeader('content-type')
        reply.removeHeader('content-length')
        return ''
      }
    }

    if (!useGzip || req.method === 'HEAD') return payload
    const size = typeof payload === 'string' ? Buffer.byteLength(payload) : payload.length
    if (size < GZIP_MIN_BYTES) return payload
    reply.header('Vary', addVary(reply.getHeader('vary'), 'Accept-Encoding'))
    if (!acceptsGzip(req.headers['accept-encoding']) || reply.getHeader('content-encoding')) return payload
    const packed = await gzipAsync(payload, { level: GZIP_LEVEL })
    reply.header('Content-Encoding', 'gzip')
    reply.removeHeader('content-length')
    return packed
  })
}
