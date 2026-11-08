import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { assertMediaKey, type MediaStore } from './mediaStore.js'

/**
 * Photos in an S3-compatible bucket (AWS in Mumbai, Cloudflare R2, MinIO, Backblaze B2).
 *
 * Rules, each pinned by a test (test/s3Store.test.ts):
 *  - The bucket is private. No ACL is ever sent, so no object is public; the bucket itself must also block public access.
 *  - Bytes are streamed through the authenticated API routes. Nobody (phone, buyer) is given a bucket address
 *    or a presigned link; the routes decide who may read a photo, exactly as with the disk store.
 *  - Keys are validated with the same rule as the disk store BEFORE they reach the SDK.
 *  - The size ceiling is checked before anything is sent.
 *  - Objects are encrypted at rest (`AES256`).
 *  - A failure becomes a plain Error with a fixed message: no AWS text, no bucket name, no endpoint, no key.
 *    The detail goes only to the optional `onError` callback (an operator log: error name and HTTP status only).
 */
export interface S3Config {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** For R2, MinIO, Backblaze or a regional AWS endpoint. Leave out for plain AWS. */
  endpoint?: string
  /** Bucket in the path (http://host/bucket/key) instead of the host name. MinIO needs it. */
  forcePathStyle?: boolean
  /** Folder inside the bucket, for example `isocode/pilot/`. Always ends with `/` once cleaned. */
  prefix?: string
  /** `AES256` (default) or `none` for a service that rejects the header. */
  encryption?: 'AES256' | 'none'
}

/** The one method of the SDK client this store uses, so a test can inject a fake. */
export interface S3Like { send(command: unknown): Promise<unknown> }

export interface S3StoreOptions {
  client?: S3Like
  /** Refuse to upload more than this many bytes. photoService already caps photos at 3 MB; this is a second wall. */
  maxBytes?: number
  /** Operator log of a failure: what failed and the error's name/status only. Never given the message, key or bucket. */
  onError?: (op: 'put' | 'get' | 'delete', info: { name: string; status?: number }) => void
}

export const MAX_OBJECT_BYTES = 5 * 1024 * 1024
const GENERIC = 'media store unavailable'

type Failure = { name?: string; $metadata?: { httpStatusCode?: number } }
const statusOf = (e: unknown): number | undefined => (e as Failure | null)?.$metadata?.httpStatusCode
// Only a missing KEY is "not found". A 404 whose name says the bucket is missing is a configuration fault (a wrong or deleted bucket), and
// reading it as "not found" would make every photo look gone and a purge look done. Any other 404 stays "not found", as the earlier tests pin.
const isMissing = (e: unknown): boolean => {
  const name = (e as Failure | null)?.name
  if (name === 'NoSuchBucket') return false
  return name === 'NoSuchKey' || name === 'NotFound' || statusOf(e) === 404
}

/** Only photos are stored today. Anything else is sent as opaque bytes, which a browser will not render. */
export function contentTypeFor(key: string): string {
  return /\.jpe?g$/i.test(key) ? 'image/jpeg' : 'application/octet-stream'
}

/** Per attempt: how long to wait for a connection and for the bucket to answer once connected. Without them a stuck bucket held a request for ever. */
export const S3_CONNECT_TIMEOUT_MS = 5_000
export const S3_REQUEST_TIMEOUT_MS = 15_000

export function makeS3Client(cfg: S3Config): S3Like {
  return new S3Client({
    requestHandler: { connectionTimeout: S3_CONNECT_TIMEOUT_MS, requestTimeout: S3_REQUEST_TIMEOUT_MS },
    region: cfg.region,
    ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    forcePathStyle: cfg.forcePathStyle === true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    maxAttempts: 3,
  })
}

export function s3Store(cfg: S3Config, opts: S3StoreOptions = {}): MediaStore {
  const client = opts.client ?? makeS3Client(cfg)
  const maxBytes = opts.maxBytes ?? MAX_OBJECT_BYTES
  const prefix = cfg.prefix ? cfg.prefix.replace(/\/+$/, '') + '/' : ''
  const sse = cfg.encryption === 'none' ? {} : { ServerSideEncryption: 'AES256' as const }
  // Validate first, then add the prefix, so a caller can never reach outside it.
  const objectKey = (key: string) => { assertMediaKey(key); return prefix + key }
  const fail = (op: 'put' | 'get' | 'delete', e: unknown): never => {
    try { opts.onError?.(op, { name: String((e as Failure | null)?.name ?? 'Error'), ...(statusOf(e) !== undefined ? { status: statusOf(e)! } : {}) }) } catch { /* logging must not change the outcome */ }
    throw new Error(GENERIC)
  }

  return {
    async put(key, bytes) {
      const Key = objectKey(key)
      if (!Buffer.isBuffer(bytes) || bytes.length > maxBytes) throw new Error('media too large')
      try {
        await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key, Body: bytes, ContentLength: bytes.length, ContentType: contentTypeFor(key), CacheControl: 'private, no-store', ...sse }))
      } catch (e) { fail('put', e) }
    },
    async get(key) {
      const Key = objectKey(key)
      try {
        const out = (await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key }))) as { Body?: { transformToByteArray(): Promise<Uint8Array> } }
        if (!out.Body) return null
        return Buffer.from(await out.Body.transformToByteArray())
      } catch (e) {
        if (isMissing(e)) return null      // like the disk store: a file that is not there is "not found", not a failure
        return fail('get', e)
      }
    },
    async delete(key) {
      const Key = objectKey(key)
      try { await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key })) }
      catch (e) { if (!isMissing(e)) fail('delete', e) }   // deleting what is already gone succeeds, like the disk store
    },
  }
}
