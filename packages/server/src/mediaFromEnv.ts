import { diskStore, memoryMediaStore, type MediaStore } from './mediaStore.js'
import { s3Store, type S3Config, type S3Like, type S3StoreOptions } from './s3Store.js'

/** A start-up configuration mistake. The message names the variable and never contains a value. */
export class MediaConfigError extends Error {}

type Env = Record<string, string | undefined>

const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const REGION = /^[a-z0-9-]{2,40}$/
const PREFIX = /^[A-Za-z0-9_][A-Za-z0-9/_.-]*$/
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

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
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.has(u.hostname))) {
      throw new MediaConfigError('S3_ENDPOINT must start with https:// (http:// is allowed only for localhost)')
    }
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
}

/**
 * Which store the server uses.
 *   MEDIA_STORE unset        MEDIA_DIR set: disk (as before); otherwise photos are off (undefined).
 *   MEDIA_STORE=disk         needs MEDIA_DIR.
 *   MEDIA_STORE=memory       in-process only; photos vanish on restart. For trials.
 *   MEDIA_STORE=s3           needs S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
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
  throw new MediaConfigError('MEDIA_STORE must be disk, memory or s3')
}
