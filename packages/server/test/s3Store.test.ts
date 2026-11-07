import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { buildApp, diskStore, memoryMediaStore, type Db, type MediaStore } from '../src/index.js'
import { MediaConfigError, mediaStoreFromEnv, s3ConfigFromEnv } from '../src/mediaFromEnv.js'
import { s3Store, type S3Config, type S3Like } from '../src/s3Store.js'
import { CREDS, ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

// ---------------------------------------------------------------------------------------------
// A fake S3 client: an in-memory bucket that answers the three commands the store sends, records every
// command, and can be told to fail. No network. The error shapes copy what the AWS SDK throws.
// ---------------------------------------------------------------------------------------------
type Cmd = PutObjectCommand | GetObjectCommand | DeleteObjectCommand
const awsError = (name: string, status: number, message: string) => Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } })

class FakeS3 implements S3Like {
  objects = new Map<string, { body: Buffer; input: PutObjectCommand['input'] }>()
  commands: Cmd[] = []
  failWith: Error | null = null
  async send(command: unknown): Promise<unknown> {
    const c = command as Cmd
    this.commands.push(c)
    if (this.failWith) throw this.failWith
    const id = `${c.input.Bucket}/${c.input.Key}`
    if (c instanceof PutObjectCommand) { this.objects.set(id, { body: Buffer.from(c.input.Body as Buffer), input: c.input }); return {} }
    if (c instanceof GetObjectCommand) {
      const o = this.objects.get(id)
      if (!o) throw awsError('NoSuchKey', 404, 'The specified key does not exist.')
      return { Body: { transformToByteArray: async () => new Uint8Array(o.body) } }
    }
    if (c instanceof DeleteObjectCommand) { this.objects.delete(id); return {} }
    throw new Error('unexpected command')
  }
}

const CFG: S3Config = { bucket: 'acme-photos-mumbai', region: 'ap-south-1', accessKeyId: 'AKIAFAKEKEYID', secretAccessKey: 'fake-secret-do-not-print' }
const fakeStore = (over: Partial<S3Config> = {}, opts: Parameters<typeof s3Store>[1] = {}) => {
  const client = new FakeS3()
  return { client, store: s3Store({ ...CFG, ...over }, { client, ...opts }) }
}

// ---------------------------------------------------------------------------------------------
// The shared behaviour every MediaStore must have. Run below against memory, disk and the faked S3 store.
// ---------------------------------------------------------------------------------------------
const BAD_KEYS = ['../escape.jpg', 'photos/../../escape.jpg', '/etc/passwd', 'a b.jpg', 'photos\\x.jpg', 'photos//a.jpg', 'photos/./a.jpg', 'photos/', '', '.hidden.jpg', 'a..b.jpg', 'photos/a.jpg\n', 'x'.repeat(201)]

function mediaStoreContract(name: string, make: () => Promise<{ store: MediaStore; cleanup?: () => Promise<void> }>) {
  describe(`MediaStore contract: ${name}`, () => {
    let store: MediaStore
    let cleanup: (() => Promise<void>) | undefined
    beforeEach(async () => { ({ store, cleanup } = await make()) })
    afterAll(async () => { await cleanup?.() })

    it('stores bytes exactly and reads them back as a Buffer', async () => {
      const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0xfe, 0xff, 0xd9])
      await store.put('photos/a.jpg', bytes)
      const got = await store.get('photos/a.jpg')
      expect(Buffer.isBuffer(got)).toBe(true)
      expect(Buffer.compare(got!, bytes)).toBe(0)
    })
    it('keeps its own copy: changing the buffer afterwards changes nothing stored', async () => {
      const bytes = Buffer.from('original')
      await store.put('photos/copy.jpg', bytes)
      bytes.fill(0x7a)
      expect((await store.get('photos/copy.jpg'))?.toString()).toBe('original')
    })
    it('a missing key reads as null, not an error', async () => {
      expect(await store.get('photos/missing.jpg')).toBeNull()
    })
    it('putting the same key again replaces it', async () => {
      await store.put('photos/r.jpg', Buffer.from('one'))
      await store.put('photos/r.jpg', Buffer.from('two'))
      expect((await store.get('photos/r.jpg'))?.toString()).toBe('two')
    })
    it('keys in different folders do not collide', async () => {
      await store.put('photos/x.jpg', Buffer.from('p'))
      await store.put('other/x.jpg', Buffer.from('o'))
      expect((await store.get('photos/x.jpg'))?.toString()).toBe('p')
      expect((await store.get('other/x.jpg'))?.toString()).toBe('o')
    })
    it('delete removes the file and touches no other', async () => {
      await store.put('photos/d.jpg', Buffer.from('d'))
      await store.put('photos/keep.jpg', Buffer.from('k'))
      await store.delete('photos/d.jpg')
      expect(await store.get('photos/d.jpg')).toBeNull()
      expect((await store.get('photos/keep.jpg'))?.toString()).toBe('k')
    })
    it('deleting a key that is not there succeeds, and so does doing it twice', async () => {
      await expect(store.delete('photos/never.jpg')).resolves.toBeUndefined()
      await store.put('photos/twice.jpg', Buffer.from('t'))
      await store.delete('photos/twice.jpg')
      await expect(store.delete('photos/twice.jpg')).resolves.toBeUndefined()
    })
    it.each(BAD_KEYS.map((k) => [JSON.stringify(k.length > 40 ? `${k.slice(0, 10)}...(${k.length})` : k), k]))('refuses the key %s for put, get and delete with the same plain error', async (_label, key) => {
      await expect(store.put(key, Buffer.from('x'))).rejects.toThrow(/^bad media key$/)
      await expect(store.get(key)).rejects.toThrow(/^bad media key$/)
      await expect(store.delete(key)).rejects.toThrow(/^bad media key$/)
    })
    it('accepts the keys the server makes', async () => {
      const key = `photos/${crypto.randomUUID()}.jpg`
      await store.put(key, Buffer.from('ok'))
      expect((await store.get(key))?.toString()).toBe('ok')
    })
  })
}

mediaStoreContract('memory', async () => ({ store: memoryMediaStore() }))
let tmpDirs: string[] = []
mediaStoreContract('disk', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'media-contract-'))
  tmpDirs.push(dir)
  return { store: diskStore(dir) }
})
afterAll(async () => { await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))) })
mediaStoreContract('s3 (faked client)', async () => ({ store: fakeStore().store }))
mediaStoreContract('s3 (faked client, with a prefix)', async () => ({ store: fakeStore({ prefix: 'isocode/pilot/' }).store }))

// ---------------------------------------------------------------------------------------------
// What is specific to the S3 store.
// ---------------------------------------------------------------------------------------------
describe('s3 store: the exact commands', () => {
  it('put sends bucket, key, bytes, the JPEG content type and server-side encryption AES256, and nothing public', async () => {
    const { client, store } = fakeStore()
    const bytes = Buffer.from('jpeg-bytes')
    await store.put('photos/abc.jpg', bytes)
    expect(client.commands).toHaveLength(1)
    const c = client.commands[0] as PutObjectCommand
    expect(c).toBeInstanceOf(PutObjectCommand)
    expect(c.input).toEqual({
      Bucket: 'acme-photos-mumbai', Key: 'photos/abc.jpg', Body: bytes, ContentLength: bytes.length,
      ContentType: 'image/jpeg', CacheControl: 'private, no-store', ServerSideEncryption: 'AES256',
    })
  })
  it('never sends an ACL or any public-access or presign field, on any command', async () => {
    const { client, store } = fakeStore()
    await store.put('photos/p.jpg', Buffer.from('x')); await store.get('photos/p.jpg'); await store.delete('photos/p.jpg')
    expect(client.commands).toHaveLength(3)
    for (const c of client.commands) {
      const keys = Object.keys(c.input)
      expect(keys.filter((k) => /acl|grant|public|presign|website|tagging/i.test(k))).toEqual([])
    }
  })
  it('get and delete name the bucket and the key', async () => {
    const { client, store } = fakeStore()
    await store.put('photos/g.jpg', Buffer.from('x'))
    await store.get('photos/g.jpg')
    await store.delete('photos/g.jpg')
    expect(client.commands[1]).toBeInstanceOf(GetObjectCommand)
    expect(client.commands[1]!.input).toEqual({ Bucket: 'acme-photos-mumbai', Key: 'photos/g.jpg' })
    expect(client.commands[2]).toBeInstanceOf(DeleteObjectCommand)
    expect(client.commands[2]!.input).toEqual({ Bucket: 'acme-photos-mumbai', Key: 'photos/g.jpg' })
  })
  it('a prefix is added after validation and always ends with one slash', async () => {
    for (const prefix of ['pilot', 'pilot/', 'pilot//']) {
      const { client, store } = fakeStore({ prefix })
      await store.put('photos/p.jpg', Buffer.from('x'))
      expect((client.commands[0] as PutObjectCommand).input.Key).toBe('pilot/photos/p.jpg')
    }
  })
  it('a service that rejects the encryption header can be told to leave it out, and only then', async () => {
    const { client, store } = fakeStore({ encryption: 'none' })
    await store.put('photos/p.jpg', Buffer.from('x'))
    expect((client.commands[0] as PutObjectCommand).input).not.toHaveProperty('ServerSideEncryption')
    const on = fakeStore({ encryption: 'AES256' })
    await on.store.put('photos/p.jpg', Buffer.from('x'))
    expect((on.client.commands[0] as PutObjectCommand).input.ServerSideEncryption).toBe('AES256')
  })
  it('a non-photo key is sent as opaque bytes', async () => {
    const { client, store } = fakeStore()
    await store.put('audio/a.bin', Buffer.from('x'))
    expect((client.commands[0] as PutObjectCommand).input.ContentType).toBe('application/octet-stream')
  })
})

describe('s3 store: the key rule runs before the SDK', () => {
  it.each(BAD_KEYS.map((k) => [JSON.stringify(k.slice(0, 30)), k]))('a bad key %s sends no command at all', async (_l, key) => {
    const { client, store } = fakeStore({ prefix: 'pilot/' })
    await expect(store.put(key, Buffer.from('x'))).rejects.toThrow('bad media key')
    await expect(store.get(key)).rejects.toThrow('bad media key')
    await expect(store.delete(key)).rejects.toThrow('bad media key')
    expect(client.commands).toHaveLength(0)
  })
  it('a prefix cannot be climbed out of with the key', async () => {
    const { client, store } = fakeStore({ prefix: 'pilot/' })
    await expect(store.get('../other/secret.jpg')).rejects.toThrow('bad media key')
    expect(client.commands).toHaveLength(0)
  })
})

describe('s3 store: size limits are enforced before upload', () => {
  it('refuses an object over the ceiling without sending anything', async () => {
    const { client, store } = fakeStore({}, { maxBytes: 1000 })
    await expect(store.put('photos/big.jpg', Buffer.alloc(1001))).rejects.toThrow('media too large')
    expect(client.commands).toHaveLength(0)
    await store.put('photos/ok.jpg', Buffer.alloc(1000))
    expect(client.commands).toHaveLength(1)
  })
  it('the default ceiling is above the 3 MB photo limit and refuses far more than that', async () => {
    const { client, store } = fakeStore()
    await store.put('photos/three.jpg', Buffer.alloc(3 * 1024 * 1024))
    await expect(store.put('photos/huge.jpg', Buffer.alloc(6 * 1024 * 1024))).rejects.toThrow('media too large')
    expect(client.commands).toHaveLength(1)
  })
})

describe('s3 store: errors are plain and leak nothing', () => {
  const LEAKY = awsError('AccessDenied', 403, `User: arn:aws:iam::123456789012:user/uploader is not authorized to perform: s3:PutObject on resource: "arn:aws:s3:::acme-photos-mumbai/photos/x.jpg" at https://acme-photos-mumbai.s3.ap-south-1.amazonaws.com`)
  const seen = (e: unknown) => String((e as Error).message) + String((e as Error).stack?.split('\n')[0]) + JSON.stringify(e) + String((e as { cause?: unknown }).cause ?? '')

  it.each(['put', 'get', 'delete'] as const)('%s failure becomes one fixed message with no AWS text, bucket, key, endpoint or secret', async (op) => {
    const { client, store } = fakeStore({ endpoint: 'https://minio.internal.example:9000' })
    client.failWith = LEAKY
    const run = () => op === 'put' ? store.put('photos/x.jpg', Buffer.from('x')) : op === 'get' ? store.get('photos/x.jpg') : store.delete('photos/x.jpg')
    const err = await run().then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('media store unavailable')
    const everything = seen(err)
    for (const secret of ['acme-photos-mumbai', 'photos/x.jpg', 'arn:aws', 'AccessDenied', 'amazonaws', 'minio.internal', CFG.secretAccessKey, CFG.accessKeyId]) expect(everything).not.toContain(secret)
  })
  it('a network failure is the same plain error', async () => {
    const { client, store } = fakeStore()
    client.failWith = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:9000'), { name: 'Error', code: 'ECONNREFUSED' })
    await expect(store.get('photos/x.jpg')).rejects.toThrow(/^media store unavailable$/)
  })
  it('the operator log gets the error name and status only', async () => {
    const calls: unknown[] = []
    const { client, store } = fakeStore({}, { onError: (op, info) => calls.push([op, info]) })
    client.failWith = LEAKY
    await expect(store.put('photos/x.jpg', Buffer.from('x'))).rejects.toThrow()
    expect(calls).toEqual([['put', { name: 'AccessDenied', status: 403 }]])
    expect(JSON.stringify(calls)).not.toContain('acme-photos')
  })
  it('a broken logger cannot change the outcome', async () => {
    const { client, store } = fakeStore({}, { onError: () => { throw new Error('log down') } })
    client.failWith = LEAKY
    await expect(store.put('photos/x.jpg', Buffer.from('x'))).rejects.toThrow('media store unavailable')
  })
  it('a missing object is null on get and a success on delete, by name or by status 404', async () => {
    for (const e of [awsError('NoSuchKey', 404, 'x'), awsError('NotFound', 404, 'x'), awsError('Whatever', 404, 'x')]) {
      const { client, store } = fakeStore()
      client.failWith = e
      expect(await store.get('photos/gone.jpg')).toBeNull()
      await expect(store.delete('photos/gone.jpg')).resolves.toBeUndefined()
    }
  })
  it('a 403 on get is a failure, not "not found": it means the credentials are wrong, and hiding that would hide an outage', async () => {
    const { client, store } = fakeStore()
    client.failWith = awsError('AccessDenied', 403, 'x')
    await expect(store.get('photos/x.jpg')).rejects.toThrow('media store unavailable')
  })
  it('an empty body reads as not found', async () => {
    const store = s3Store(CFG, { client: { send: async () => ({}) } })
    expect(await store.get('photos/x.jpg')).toBeNull()
  })
})

describe('choosing the store from the environment', () => {
  const S3_ENV = { MEDIA_STORE: 's3', S3_BUCKET: 'acme-photos-mumbai', S3_REGION: 'ap-south-1', S3_ACCESS_KEY_ID: 'AKIAFAKEKEYID', S3_SECRET_ACCESS_KEY: 'fake-secret-do-not-print' }

  it('disk stays the default when only MEDIA_DIR is set, and photos stay off when nothing is set', () => {
    expect(mediaStoreFromEnv({})).toBeUndefined()
    expect(mediaStoreFromEnv({ MEDIA_DIR: path.join(tmpdir(), 'x-never-created') })).toBeDefined()
    expect(mediaStoreFromEnv({ MEDIA_STORE: '  ' })).toBeUndefined()
  })
  it('memory and disk can be named; disk needs its folder', () => {
    const warnings: string[] = []
    expect(mediaStoreFromEnv({ MEDIA_STORE: 'memory' }, { warn: (m) => warnings.push(m) })).toBeDefined()
    expect(warnings[0]).toMatch(/vanish/)
    expect(() => mediaStoreFromEnv({ MEDIA_STORE: 'disk' })).toThrow('MEDIA_DIR is not set')
    expect(mediaStoreFromEnv({ MEDIA_STORE: 'disk', MEDIA_DIR: path.join(tmpdir(), 'x-never-created') })).toBeDefined()
  })
  it('an unknown MEDIA_STORE is refused, not ignored', () => {
    expect(() => mediaStoreFromEnv({ MEDIA_STORE: 'gcs' })).toThrow(MediaConfigError)
    expect(() => mediaStoreFromEnv({ MEDIA_STORE: 'gcs' })).toThrow('MEDIA_STORE must be')
  })
  it('s3 is built from the variables and talks to the injected client', async () => {
    const client = new FakeS3()
    const store = mediaStoreFromEnv({ ...S3_ENV, S3_PREFIX: 'pilot' }, { s3Client: client })!
    await store.put('photos/e.jpg', Buffer.from('x'))
    expect((client.commands[0] as PutObjectCommand).input).toMatchObject({ Bucket: 'acme-photos-mumbai', Key: 'pilot/photos/e.jpg', ServerSideEncryption: 'AES256' })
  })
  it('s3 wins over MEDIA_DIR, with a warning', () => {
    const warnings: string[] = []
    mediaStoreFromEnv({ ...S3_ENV, MEDIA_DIR: './media' }, { s3Client: new FakeS3(), warn: (m) => warnings.push(m) })
    expect(warnings.join()).toMatch(/MEDIA_DIR is ignored/)
  })

  it.each(['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])('a missing %s stops start-up with a message that names it and contains no secret', (name) => {
    const env: Record<string, string | undefined> = { ...S3_ENV, [name]: undefined }
    for (const blank of [undefined, '', '   ']) {
      env[name] = blank
      let err: unknown
      try { mediaStoreFromEnv(env, { s3Client: new FakeS3() }) } catch (e) { err = e }
      expect(err).toBeInstanceOf(MediaConfigError)
      const msg = (err as Error).message
      expect(msg).toContain(name)
      for (const v of Object.entries(S3_ENV).filter(([k]) => k !== name && k !== 'MEDIA_STORE' && k !== 'S3_REGION' && k !== 'S3_BUCKET').map(([, v]) => v)) expect(msg).not.toContain(v)
    }
  })

  describe('a bad value names the variable and never echoes the value', () => {
    const SECRETY = 'https://admin:hunter2-password@minio.example.com'
    it.each([
      ['S3_BUCKET', 'Bad_Bucket!'], ['S3_BUCKET', 'ab'], ['S3_REGION', 'ap south'], ['S3_ENDPOINT', 'not a url'], ['S3_ENDPOINT', SECRETY],
      ['S3_ENDPOINT', 'http://minio.example.com:9000'], ['S3_ENDPOINT', 'ftp://minio.example.com'], ['S3_FORCE_PATH_STYLE', 'maybe-secret-value'],
      ['S3_PREFIX', '../up'], ['S3_PREFIX', '/abs'], ['S3_PREFIX', 'a b'], ['S3_PREFIX', 'a//b'], ['S3_SSE', 'aws:kms'],
    ])('%s=%j', (name, value) => {
      let err: unknown
      try { s3ConfigFromEnv({ ...S3_ENV, [name]: value }) } catch (e) { err = e }
      expect(err).toBeInstanceOf(MediaConfigError)
      const msg = (err as Error).message
      expect(msg).toContain(name)
      for (const leak of [value, 'hunter2', S3_ENV.S3_SECRET_ACCESS_KEY, S3_ENV.S3_ACCESS_KEY_ID]) expect(msg).not.toContain(leak)
    })
  })

  it('accepts the optional variables', () => {
    expect(s3ConfigFromEnv({ ...S3_ENV, S3_ENDPOINT: 'https://abc.r2.cloudflarestorage.com/', S3_FORCE_PATH_STYLE: 'TRUE', S3_PREFIX: 'a/b/', S3_SSE: 'none' }))
      .toMatchObject({ bucket: 'acme-photos-mumbai', region: 'ap-south-1', endpoint: 'https://abc.r2.cloudflarestorage.com', forcePathStyle: true, prefix: 'a/b/', encryption: 'none' })
    expect(s3ConfigFromEnv({ ...S3_ENV, S3_ENDPOINT: 'http://localhost:9000', S3_FORCE_PATH_STYLE: '1' })).toMatchObject({ endpoint: 'http://localhost:9000', forcePathStyle: true })
    expect(s3ConfigFromEnv({ ...S3_ENV, S3_FORCE_PATH_STYLE: '0' }).forcePathStyle).toBe(false)
    const plain = s3ConfigFromEnv(S3_ENV)
    expect(plain.endpoint).toBeUndefined(); expect(plain.prefix).toBeUndefined(); expect(plain.forcePathStyle).toBeUndefined()
  })
  it('the real client can be built from the variables without touching the network', () => {
    expect(mediaStoreFromEnv({ ...S3_ENV, S3_ENDPOINT: 'http://127.0.0.1:9' })).toBeDefined()
  })
})

// ---------------------------------------------------------------------------------------------
// Through the real app: the photo routes with the S3 store behind them.
// ---------------------------------------------------------------------------------------------
const NOW = new Date('2026-11-04T04:30:00Z')
const jpeg = (size = 2000): Buffer => { const b = Buffer.alloc(size, 0x41); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[size - 2] = 0xff; b[size - 1] = 0xd9; return b }

describe('the photo routes on the S3 store', () => {
  let pg: PGlite
  let db: Db
  let s3: FakeS3
  let app: ReturnType<typeof buildApp>
  beforeAll(async () => { pg = await migratedDb(); db = pgliteDb(pg) })
  afterAll(async () => { await pg.close() })
  beforeEach(async () => {
    await resetAndSeed(pg)
    s3 = new FakeS3()
    app = buildApp({ db, tokenSecret: 'x'.repeat(40), clock: () => NOW, media: s3Store(CFG, { client: s3 }) })
  })
  const login = async (b: object) => ({ authorization: `Bearer ${(await app.inject({ method: 'POST', url: '/api/auth/login', payload: b })).json().token}` })
  const merch = () => login({ email: CREDS.email, password: CREDS.password })
  const sup = () => login({ phone: CREDS.phone, pin: CREDS.pin })
  const upload = async (body: Buffer = jpeg()) => app.inject({
    method: 'POST', url: '/api/photos',
    headers: { ...(await sup()), 'content-type': 'image/jpeg', 'x-client-uuid': crypto.randomUUID(), 'x-order-id': ID.orderRed, 'x-stage': 'sewing', 'x-date': '2026-11-04' },
    payload: body,
  })
  const buyerToken = async () => (await app.inject({ method: 'POST', url: '/api/buyer-links', headers: await merch(), payload: { buyerId: ID.buyerB } })).json().token as string

  it('an upload becomes one private, encrypted object under a random server-made key; the row holds the key', async () => {
    const res = await upload()
    expect(res.statusCode).toBe(200)
    const [row] = (await pg.query<{ storage_key: string }>('select storage_key from photo')).rows
    expect(row!.storage_key).toMatch(/^photos\/[0-9a-f-]{36}\.jpg$/)
    const put = s3.commands.filter((c) => c instanceof PutObjectCommand) as PutObjectCommand[]
    expect(put).toHaveLength(1)
    expect(put[0]!.input).toMatchObject({ Bucket: CFG.bucket, Key: row!.storage_key, ContentType: 'image/jpeg', ServerSideEncryption: 'AES256' })
    expect(put[0]!.input).not.toHaveProperty('ACL')
  })

  it('the file comes back through the API, with the bytes, never cached, and no bucket address anywhere in the reply', async () => {
    const { id } = (await upload()).json()
    const res = await app.inject({ url: `/api/photos/${id}/file`, headers: await merch() })
    expect(res.statusCode).toBe(200)
    expect(Buffer.compare(res.rawPayload, jpeg())).toBe(0)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.headers.location).toBeUndefined()
    const all = JSON.stringify(res.headers) + res.body.slice(0, 0)
    expect(all).not.toMatch(/amazonaws|s3\.|X-Amz|acme-photos/i)
  })

  it('authorisation is unchanged: no sign-in, a buyer before approval and another buyer all get nothing and the bucket is not even asked', async () => {
    const { id } = (await upload()).json()
    const before = s3.commands.length
    expect((await app.inject({ url: `/api/photos/${id}/file` })).statusCode).toBe(401)
    const t = await buyerToken()
    expect((await app.inject({ url: `/api/photos/${id}/file`, headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(401)
    const unapproved = await app.inject({ url: `/api/buyer/photos/${id}`, headers: { authorization: `Bearer ${t}` } })
    expect(unapproved.statusCode).toBe(404)
    expect(s3.commands.length).toBe(before)   // refused by the database rules before any call to storage
    await app.inject({ method: 'POST', url: `/api/photos/${id}/approve`, headers: await merch() })
    const ok = await app.inject({ url: `/api/buyer/photos/${id}`, headers: { authorization: `Bearer ${t}` } })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['cache-control']).toBe('no-store')
    expect(Buffer.compare(ok.rawPayload, jpeg())).toBe(0)
  })

  it('a bad or oversized photo is refused before any upload to the bucket', async () => {
    expect((await upload(Buffer.from('<html>' + ' '.repeat(2000)))).statusCode).toBe(400)
    expect([400, 413]).toContain((await upload(jpeg(3 * 1024 * 1024 + 4096))).statusCode)
    expect(s3.commands).toHaveLength(0)
  })

  it('a storage outage is a plain 500 with no AWS text, bucket or key, and no photo row is left behind', async () => {
    s3.failWith = awsError('AccessDenied', 403, 'User arn:aws:iam::1:user/u cannot s3:PutObject on arn:aws:s3:::acme-photos-mumbai/photos/k.jpg')
    const res = await upload()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } })
    expect(res.body).not.toMatch(/arn:|acme-photos|AccessDenied|photos\//)
    expect((await pg.query('select 1 from photo')).rows).toHaveLength(0)
    s3.failWith = null
    const { id } = (await upload()).json()
    s3.failWith = awsError('InternalError', 500, 'bucket acme-photos-mumbai broke')
    const read = await app.inject({ url: `/api/photos/${id}/file`, headers: await merch() })
    expect(read.statusCode).toBe(500)
    expect(read.body).not.toMatch(/acme-photos|InternalError/)
  })

  it('a file missing from the bucket is "not found", like any missing photo', async () => {
    const { id } = (await upload()).json()
    s3.objects.clear()
    expect((await app.inject({ url: `/api/photos/${id}/file`, headers: await merch() })).statusCode).toBe(404)
  })

  it('purging rejected photos deletes their objects through the store, keeps others, and is safe to repeat', async () => {
    const rejected = (await upload()).json().id as string
    const waiting = (await upload()).json().id as string
    await app.inject({ method: 'POST', url: `/api/photos/${rejected}/reject`, headers: await merch() })
    expect(s3.objects.size).toBe(2)
    const purge = async () => (await app.inject({ method: 'POST', url: '/api/photos/purge', headers: await merch(), payload: { days: 0 } })).json().purged
    expect(await purge()).toBe(1)
    expect(s3.objects.size).toBe(1)
    const deletes = s3.commands.filter((c) => c instanceof DeleteObjectCommand) as DeleteObjectCommand[]
    expect(deletes).toHaveLength(1)
    const keyOf = async (id: string) => (await pg.query<{ storage_key: string }>('select storage_key from photo where id = $1', [id])).rows[0]!.storage_key
    expect(deletes[0]!.input).toEqual({ Bucket: CFG.bucket, Key: await keyOf(rejected) })
    expect(s3.objects.has(`${CFG.bucket}/${await keyOf(waiting)}`)).toBe(true)
    expect(await purge()).toBe(0)
    // the object being already gone (a half-finished earlier purge) is not an error
    await pg.query('update photo set purged_at = null where id = $1', [rejected])
    expect(await purge()).toBe(1)
  })
})
