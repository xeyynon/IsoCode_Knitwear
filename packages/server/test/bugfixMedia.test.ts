import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { diskStore } from '../src/mediaStore.js'
import { MediaConfigError, s3ConfigFromEnv } from '../src/mediaFromEnv.js'
import { s3Store, type S3Config } from '../src/s3Store.js'

// Fixes BE-018 (a missing bucket is not a missing photo), BE-019 (disk read errors) and BE-020 (S3_ENDPOINT with a path).
const awsError = (name: string, status: number, message = 'x') => Object.assign(new Error(message), { name, $metadata: { httpStatusCode: status } })
const CFG: S3Config = { bucket: 'acme-photos-mumbai', region: 'ap-south-1', accessKeyId: 'AKIAFAKEKEYID', secretAccessKey: 'fake-secret-do-not-print' }

describe('BE-018: only a missing key is "not found"', () => {
  it('BE-018: a missing bucket is a failure with the fixed message, and the operator hook hears about it once per call', async () => {
    const seen: unknown[] = []
    const client = { send: async () => { throw awsError('NoSuchBucket', 404, 'The specified bucket does not exist: acme-photos-mumbai') } }
    const store = s3Store(CFG, { client, onError: (op, info) => seen.push([op, info]) })
    await expect(store.get('photos/a.jpg')).rejects.toThrow('media store unavailable')
    await expect(store.delete('photos/a.jpg')).rejects.toThrow('media store unavailable')
    expect(seen).toEqual([['get', { name: 'NoSuchBucket', status: 404 }], ['delete', { name: 'NoSuchBucket', status: 404 }]])
    expect(JSON.stringify(seen)).not.toMatch(/acme|mumbai/)
  })
  it('BE-018: a missing key is still null on get and a success on delete', async () => {
    for (const e of [awsError('NoSuchKey', 404), awsError('NotFound', 404), awsError('Whatever', 404)]) {
      const seen: unknown[] = []
      const store = s3Store(CFG, { client: { send: async () => { throw e } }, onError: (...a) => seen.push(a) })
      expect(await store.get('photos/gone.jpg')).toBeNull()
      await expect(store.delete('photos/gone.jpg')).resolves.toBeUndefined()
      expect(seen).toEqual([])
    }
  })
})

describe('BE-019: the disk store says "not found" only for a file that is not there', () => {
  const withDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'media-'))
    try { await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
  }
  it('BE-019: a key that is a folder is an error, not "not found"', async () => {
    await withDir(async (dir) => {
      await mkdir(path.join(dir, 'photos', 'a.jpg'), { recursive: true })
      await expect(diskStore(dir).get('photos/a.jpg')).rejects.toBeInstanceOf(Error)
    })
  })
  it('BE-019: a file that is not there, and a folder that is not there, are null', async () => {
    await withDir(async (dir) => {
      const s = diskStore(dir)
      expect(await s.get('photos/missing.jpg')).toBeNull()
      expect(await s.get('nowhere/at/all.jpg')).toBeNull()
      await s.put('photos/file.jpg', Buffer.from('x'))
      expect(await s.get('photos/file.jpg/inside.jpg')).toBeNull()     // a file used as a folder
    })
  })
})

describe('BE-020: an S3 endpoint with a path is refused, not cut', () => {
  const ENV = { S3_BUCKET: 'acme-photos-mumbai', S3_REGION: 'ap-south-1', S3_ACCESS_KEY_ID: 'AKIAFAKEKEYID', S3_SECRET_ACCESS_KEY: 'fake-secret-do-not-print' }
  it.each(['https://gateway.example.com/s3/v1', 'https://gateway.example.com/s3', 'https://gateway.example.com/?x=1', 'https://gateway.example.com/#frag'])(
    'BE-020: %s is a MediaConfigError that names the variable and no value', (endpoint) => {
      let thrown: unknown
      try { s3ConfigFromEnv({ ...ENV, S3_ENDPOINT: endpoint }) } catch (e) { thrown = e }
      expect(thrown).toBeInstanceOf(MediaConfigError)
      expect((thrown as Error).message).toBe('S3_ENDPOINT must be only the address (scheme, host and port), with no path')
      expect((thrown as Error).message).not.toMatch(/gateway|s3\/v1/)
    })
  it('BE-020: a bare address, with or without the trailing slash, still works', () => {
    expect(s3ConfigFromEnv({ ...ENV, S3_ENDPOINT: 'https://abc.r2.cloudflarestorage.com' }).endpoint).toBe('https://abc.r2.cloudflarestorage.com')
    expect(s3ConfigFromEnv({ ...ENV, S3_ENDPOINT: 'https://abc.r2.cloudflarestorage.com/' }).endpoint).toBe('https://abc.r2.cloudflarestorage.com')
    expect(s3ConfigFromEnv({ ...ENV, S3_ENDPOINT: 'http://localhost:9000' }).endpoint).toBe('http://localhost:9000')
  })
})
