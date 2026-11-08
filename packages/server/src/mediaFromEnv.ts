import type { Db } from './db.js'
import { dbMediaStore } from './dbMediaStore.js'
import { diskStore, memoryMediaStore, type MediaStore } from './mediaStore.js'
import { s3Store, type S3Config, type S3Like, type S3StoreOptions } from './s3Store.js'

/** A start-up configuration mistake. The message names the variable and never contains a value. */
export class MediaConfigError extends Error {}

type Env = Record<string, string | undefined>

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const REGION = /^[a-z0-9-]{2,40}$/
const PREFIX = /^[A-Za-z0-9_][A-Za-z0-9/_.-]*$/
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Is this host (as the URL parser writes it: numbers like 2852039166 or 0xa9fea9fe are already dotted, IPv6 is in brackets and compressed)
 * the link-local range 169.254.0.0/16 or fe80::/10, or a cloud metadata name? That is where a cloud machine's metadata service answers with
 * temporary credentials, and no object store lives there. Ordinary private ranges (10.x, 192.168.x, 172.16.x) are NOT refused: a MinIO on
 * the factory's own network is legitimate.
 */
export function isMetadataHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  if (h === 'metadata.google.internal' || h === 'fd00:ec2::254') return true   // GCP's name for it, and AWS's IPv6 address for it
  if (!h.includes(':')) return false
  const first = /^([0-9a-f]{1,4}):/.exec(h)
  if (first && (parseInt(first[1]!, 16) & 0xffc0) === 0xfe80) return true       // fe80::/10
  const mapped = /^::ffff:(?:([0-9a-f]{1,4}):[0-9a-f]{1,4}|(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3})$/.exec(h)   // IPv4 written inside IPv6
  if (mapped) return mapped[1] !== undefined ? parseInt(mapped[1], 16) === 0xa9fe : mapped[2] === '169' && mapped[3] === '254'
  return false
}

/** Reads S3_* variables. Throws MediaConfigError naming the first problem; no secret or endpoint is ever echoed. */
export function s3ConfigFromEnv(env: Env): S3Config {
  const get = (name: string): string | undefined => env[name]?.trim() || undefined
  const need = (name: string): string => { const v = get(name); if (!v) throw new MediaConfigError(`${name} is not set (required when MEDIA_STORE=s3)`); return v }

  const bucket = need('S3_BUCKET')
  if (!BUCKET.test(bucket) || bucket.includes('..')) throw new MediaConfigError('S3_BUCKET is not a valid bucket name')
  const region = need('S3_REGION')
  if (!REGION.test(region)) throw new MediaConfigError('S3_REGION is not a valid region name')
  const accessKeyId = need('S3_ACCESS_KEY_ID')
  const secretAccessKey = need('S3_SECRET_ACCESS_KEY')

  const cfg: S3Config = { bucket, region, accessKeyId, secretAccessKey }

  const endpoint = get('S3_ENDPOINT')
  if (endpoint) {
    let u: URL
    try { u = new URL(endpoint) } catch { throw new MediaConfigError('S3_ENDPOINT is not a valid address') }
    if (u.username || u.password) throw new MediaConfigError('S3_ENDPOINT must not contain a user name or password')
    if (isMetadataHost(u.hostname)) throw new MediaConfigError('S3_ENDPOINT must not be a link-local address (cloud metadata services answer there); use the address your storage provider gives you')
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) {
      throw new MediaConfigError('S3_ENDPOINT must start with https:// (http:// is allowed only for localhost)')
    }
    // A path, query or fragment would be dropped by u.origin and the requests would go to the wrong place: refuse it here, at start-up.
    if ((u.pathname !== '' && u.pathname !== '/') || u.search || u.hash) throw new MediaConfigError('S3_ENDPOINT must be only the address (scheme, host and port), with no path')
    cfg.endpoint = u.origin
  }

  const style = get('S3_FORCE_PATH_STYLE')?.toLowerCase()
  if (style !== undefined) {
    if (!['1', 'true', '0', 'false'].includes(style)) throw new MediaConfigError('S3_FORCE_PATH_STYLE must be 1, true, 0 or false')
    cfg.forcePathStyle = style === '1' || style === 'true'
  }

  const prefix = get('S3_PREFIX')
  if (prefix) {
    if (!PREFIX.test(prefix) || prefix.includes('..') || prefix.includes('//')) throw new MediaConfigError('S3_PREFIX may hold only letters, digits, / _ . - and must be a relative folder')
    cfg.prefix = prefix.replace(/\/+$/, '') + '/'
  }

  const sse = get('S3_SSE')
  if (sse) {
    if (sse !== 'AES256' && sse !== 'none') throw new MediaConfigError('S3_SSE must be AES256 or none')
    cfg.encryption = sse
  }
  return cfg
}

export interface MediaFromEnvOptions {
  /** Test seam: a fake S3 client. */
  s3Client?: S3Like
  onError?: S3StoreOptions['onError']
  warn?: (message: string) => void
  /** The app's database, for MEDIA_STORE=db. */
  db?: Db
}

/**
 * Which store the server uses.
 *   MEDIA_STORE unset        MEDIA_DIR set: disk (as before); otherwise photos are off (undefined).
 *   MEDIA_STORE=disk         needs MEDIA_DIR.
 *   MEDIA_STORE=memory       in-process only; photos vanish on restart. For trials.
 *   MEDIA_STORE=s3           needs S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
 *   MEDIA_STORE=db           photo bytes in Postgres (migration 019): a host with no disk and no bucket, such as the review demo.
 */
export function mediaStoreFromEnv(env: Env, opts: MediaFromEnvOptions = {}): MediaStore | undefined {
  const kind = env.MEDIA_STORE?.trim().toLowerCase() || undefined
  const dir = env.MEDIA_DIR?.trim() || undefined
  if (kind === undefined) return dir ? diskStore(dir) : undefined
  if (kind === 'disk') {
    if (!dir) throw new MediaConfigError('MEDIA_DIR is not set (required when MEDIA_STORE=disk)')
    return diskStore(dir)
  }
  if (kind === 'memory') { opts.warn?.('MEDIA_STORE=memory: photos live in memory and vanish on restart'); return memoryMediaStore() }
  if (kind === 's3') {
    if (dir) opts.warn?.('MEDIA_DIR is ignored because MEDIA_STORE=s3')
    return s3Store(s3ConfigFromEnv(env), { ...(opts.s3Client ? { client: opts.s3Client } : {}), ...(opts.onError ? { onError: opts.onError } : {}) })
  }
  if (kind === 'db') {
    if (!opts.db) throw new MediaConfigError('MEDIA_STORE=db needs the database, which this start-up path does not pass')
    return dbMediaStore(opts.db)
  }
  throw new MediaConfigError('MEDIA_STORE must be disk, memory, s3 or db')
}
