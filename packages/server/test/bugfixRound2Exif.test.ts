// Bug round 2: BE-068, a scripted photo upload keeps its EXIF (a GPS position would reach the buyer).
import { describe, expect, it } from 'vitest'
import { memoryMediaStore, type Ctx, type Db } from '../src/index.js'
import { stripJpegMetadata } from '../src/jpegMeta.js'
import { looksLikeJpeg, savePhoto } from '../src/photoService.js'
import { ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const seg = (marker: number, payload: Buffer): Buffer => {
  const len = payload.length + 2
  return Buffer.concat([Buffer.from([0xff, marker, len >> 8, len & 0xff]), payload])
}
const ascii = (t: string) => Buffer.from(t, 'latin1')
/** An Exif block that holds a GPS-like tag and the text of a position. */
const exif = () => seg(0xe1, Buffer.concat([ascii('Exif\0\0'), ascii('MM\0*'), ascii('GPSLatitude 11.0168 N GPSLongitude 76.9558 E')]))
const icc = () => seg(0xe2, Buffer.concat([ascii('ICC_PROFILE\0'), Buffer.from([1, 1]), Buffer.alloc(40, 7)]))
const jfif = () => seg(0xe0, Buffer.concat([ascii('JFIF\0'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]))
const xmp = () => seg(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPSLatitude</x:xmpmeta>'))
const comment = () => seg(0xfe, ascii('taken at the gate'))
const tables = () => Buffer.concat([seg(0xdb, Buffer.alloc(65, 3)), seg(0xc0, Buffer.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0])), seg(0xc4, Buffer.alloc(20, 5))])
const sosHeader = () => seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0]))
/** Scan data with stuffed FF 00 bytes and restart markers inside, which must not be read as segments. */
const scanData = (size = 1500) => {
  const b = Buffer.alloc(size, 0x41)
  b[10] = 0xff; b[11] = 0x00; b[20] = 0xff; b[21] = 0xd0; b[30] = 0xff; b[31] = 0x00; b[40] = 0xff; b[41] = 0xff; b[42] = 0x00
  return b
}
const EOI = Buffer.from([0xff, 0xd9])
const SOI = Buffer.from([0xff, 0xd8])
const build = (head: Buffer[], scan = scanData()) => Buffer.concat([SOI, ...head, tables(), sosHeader(), scan, EOI])

describe('BE-068: stripJpegMetadata', () => {
  it('BE-068: the Exif segment (with its GPS-like tag), XMP and a comment are removed; JFIF and the colour profile stay', () => {
    const file = build([jfif(), exif(), xmp(), icc(), comment()])
    expect(file.includes(ascii('GPSLatitude'))).toBe(true)
    const out = stripJpegMetadata(file)
    expect(out.includes(ascii('GPSLatitude'))).toBe(false)
    expect(out.includes(ascii('Exif'))).toBe(false)
    expect(out.includes(ascii('taken at the gate'))).toBe(false)
    expect(out.includes(ascii('JFIF'))).toBe(true)
    expect(out.includes(ascii('ICC_PROFILE'))).toBe(true)
    expect(out.length).toBe(file.length - exif().length - xmp().length - comment().length)
    expect(looksLikeJpeg(out)).toBe(true)
    expect(out.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
  })

  it('BE-068: the picture data after the start-of-scan is identical, byte for byte', () => {
    const scan = scanData()
    const file = build([exif()], scan)
    const out = stripJpegMetadata(file)
    const at = (buf: Buffer) => buf.indexOf(sosHeader()) + sosHeader().length
    expect(out.subarray(at(out))).toEqual(file.subarray(at(file)))
    expect(out.subarray(at(out), at(out) + scan.length)).toEqual(scan)
    // and everything before the scan, apart from the removed segment, is the same
    expect(Buffer.concat([out.subarray(0, 2), exif(), out.subarray(2, at(out))])).toEqual(file.subarray(0, at(file)))
  })

  it('BE-068: a file with no metadata comes back as the very same bytes', () => {
    const file = build([jfif(), icc()])
    const out = stripJpegMetadata(file)
    expect(out).toBe(file)
    expect(out.equals(file)).toBe(true)
  })

  it('BE-068: a second pass changes nothing, and a progressive file (two scans) is walked to the end', () => {
    const once = stripJpegMetadata(build([exif(), jfif()]))
    expect(stripJpegMetadata(once)).toBe(once)
    const progressive = Buffer.concat([SOI, exif(), tables(), sosHeader(), scanData(400), seg(0xc4, Buffer.alloc(10, 9)), exif(), sosHeader(), scanData(700), EOI])
    const out = stripJpegMetadata(progressive)
    expect(out.length).toBe(progressive.length - 2 * exif().length)
    expect(out.includes(ascii('GPSLatitude'))).toBe(false)
  })

  it('BE-068: bytes after the final end-of-image (a hiding place for a second Exif) are dropped', () => {
    const file = Buffer.concat([build([jfif()]), ascii('trailer GPSLatitude'), EOI])
    const out = stripJpegMetadata(file)
    expect(out.equals(build([jfif()]))).toBe(true)
  })

  it('BE-068: a truncated, odd or non-JPEG buffer is returned unchanged', () => {
    const good = build([exif()])
    const odd: Buffer[] = [
      Buffer.alloc(0), Buffer.from([0xff]), Buffer.from([0xff, 0xd8]), ascii('not a photo at all, just text'), Buffer.alloc(2000, 0),
      good.subarray(0, 60),                                              // cut inside the Exif segment
      good.subarray(0, good.length - 2),                                 // the picture never ends
      Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0x00, 0x01]), Buffer.alloc(50)]),   // length below 2
      Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0xff, 0xff]), Buffer.alloc(50)]),   // length runs past the end
      Buffer.concat([SOI, Buffer.from([0x12, 0x34, 0x56])]),             // no marker where one must be
      Buffer.concat([SOI, Buffer.from([0xff, 0x00, 0x00, 0x04, 0x00])]), // FF 00 outside a scan
    ]
    for (const b of odd) {
      const out = stripJpegMetadata(b)
      expect(out).toBe(b)
    }
  })

  it('BE-068: random buffers, random segment lists and cut or flipped real files never throw, and never grow', () => {
    let seed = 12345
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
    const byte = () => Math.floor(rnd() * 256)
    const good = build([jfif(), exif(), xmp(), icc(), comment()])
    for (let t = 0; t < 4000; t++) {
      let b: Buffer
      const kind = t % 4
      if (kind === 0) b = Buffer.from(Array.from({ length: Math.floor(rnd() * 300) }, byte))
      else if (kind === 1) b = Buffer.concat([SOI, Buffer.from(Array.from({ length: Math.floor(rnd() * 300) }, () => (rnd() < 0.3 ? 0xff : byte())))])
      else if (kind === 2) b = good.subarray(0, Math.floor(rnd() * good.length))
      else { b = Buffer.from(good); for (let k = 0; k < 1 + Math.floor(rnd() * 6); k++) b[Math.floor(rnd() * b.length)] = rnd() < 0.5 ? 0xff : byte() }
      const out = stripJpegMetadata(b)
      expect(Buffer.isBuffer(out)).toBe(true)
      expect(out.length).toBeLessThanOrEqual(b.length)
      expect(stripJpegMetadata(out).equals(out)).toBe(true)       // stable: stripping what was stripped changes nothing
    }
  })
})

describe('BE-068: a stored photo has no Exif', () => {
  it('BE-068: savePhoto puts the stripped bytes in the store, and the repeat of the same upload is still one photo', async () => {
    const pg = await migratedDb()
    try {
      await resetAndSeed(pg)
      const db: Db = pgliteDb(pg)
      const ctx: Ctx = { role: 'supervisor', unitId: ID.unit1 }
      const mem = memoryMediaStore()
      const file = build([jfif(), exif()])
      expect(looksLikeJpeg(file)).toBe(true)
      const input = { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', bytes: file }
      const a = await savePhoto(db, ctx, mem, input, '2026-11-04')
      const key = (await pg.query<{ storage_key: string }>('select storage_key from photo where id = $1', [a.id])).rows[0]!.storage_key
      const stored = mem.files.get(key)!
      expect(stored.includes(ascii('GPSLatitude'))).toBe(false)
      expect(looksLikeJpeg(stored)).toBe(true)
      expect(stored.equals(build([jfif()]))).toBe(true)
      expect((await pg.query<{ bytes: number }>('select bytes from photo where id = $1', [a.id])).rows[0]!.bytes).toBe(stored.length)
      expect((await savePhoto(db, ctx, mem, input, '2026-11-04')).duplicate).toBe(true)
    } finally { await pg.close() }
  })
})
