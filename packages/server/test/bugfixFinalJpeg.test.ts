// Final bug cycle: BE-076, the JPEG metadata strip failed OPEN. A crafted file the walker could not read (a segment length that runs past
// the end, no end-of-image) was stored unchanged, so its GPS text reached the buyer after a merchandiser approved the photo. It now fails
// CLOSED: a file that cannot be walked AND carries a metadata segment (FF E1 to FF EF, FF FE) is refused with 400 not_a_photo and nothing is stored.
// (An unreadable file with no such segment has nothing the walker would have removed, so it is stored as before.)
import { describe, expect, it } from 'vitest'
import { memoryMediaStore, type Ctx, type Db } from '../src/index.js'
import { hasMetadataMarker, stripJpegMetadata, stripJpegMetadataOrNull } from '../src/jpegMeta.js'
import { savePhoto } from '../src/photoService.js'
import { ID, migratedDb, pgliteDb, resetAndSeed } from './helpers.js'

const seg = (marker: number, payload: Buffer): Buffer => {
  const len = payload.length + 2
  return Buffer.concat([Buffer.from([0xff, marker, len >> 8, len & 0xff]), payload])
}
const ascii = (t: string) => Buffer.from(t, 'latin1')
const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])
const exif = () => seg(0xe1, Buffer.concat([ascii('Exif\0\0'), ascii('MM\0*'), ascii('GPSLatitude 11.0168 N GPSLongitude 76.9558 E')]))
const jfif = () => seg(0xe0, Buffer.concat([ascii('JFIF\0'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]))
const tables = () => Buffer.concat([seg(0xdb, Buffer.alloc(65, 3)), seg(0xc0, Buffer.from([8, 0, 16, 0, 16, 1, 1, 0x11, 0])), seg(0xc4, Buffer.alloc(20, 5))])
const sos = () => seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0]))
const scan = () => Buffer.alloc(1500, 0x41)   // the upload check wants at least 1,024 bytes, so these files reach the strip step
const good = (head: Buffer[]) => Buffer.concat([SOI, ...head, tables(), sos(), scan(), EOI])

/** The attack from the report: Exif with GPS text, then a segment whose length runs past the end of the file. */
const crafted = () => Buffer.concat([SOI, exif(), Buffer.from([0xff, 0xe6, 0xff, 0xf0]), tables(), sos(), scan(), EOI])
/** A second variant: a one-byte length. */
const crafted2 = () => Buffer.concat([SOI, exif(), Buffer.from([0xff, 0xe5, 0x00, 0x01]), tables(), sos(), scan(), EOI])
/** Walkable until the picture never ends. */
const noEnd = () => Buffer.concat([SOI, exif(), tables(), sos(), scan()])

describe('BE-076: stripJpegMetadataOrNull says when it could not walk the file', () => {
  it('BE-076: a walkable file with Exif is stripped, and a walkable file with nothing to remove comes back as the same object', () => {
    const f = good([jfif(), exif()])
    const out = stripJpegMetadataOrNull(f)!
    expect(out.includes(ascii('GPSLatitude'))).toBe(false)
    const clean = good([jfif()])
    expect(stripJpegMetadataOrNull(clean)).toBe(clean)
  })

  it('BE-076: a file that cannot be walked gives null, never the input with its Exif', () => {
    for (const b of [crafted(), crafted2(), noEnd(), Buffer.concat([SOI, Buffer.from([0x12, 0x34])]), Buffer.from('not a photo'), Buffer.alloc(0)]) {
      expect(stripJpegMetadataOrNull(b)).toBeNull()
    }
  })

  it('BE-076: the old helper still never throws and still returns an unwalkable buffer unchanged (BE-068 behaviour kept)', () => {
    const c = crafted()
    expect(stripJpegMetadata(c)).toBe(c)
  })
})

describe('BE-076: hasMetadataMarker', () => {
  it('BE-076: finds an APP1, an APPn and a comment segment start anywhere, and nothing in plain picture bytes', () => {
    expect(hasMetadataMarker(Buffer.concat([Buffer.alloc(10, 0x41), Buffer.from([0xff, 0xe1]), Buffer.alloc(5)]))).toBe(true)
    expect(hasMetadataMarker(Buffer.from([0x00, 0xff, 0xef, 0x00]))).toBe(true)
    expect(hasMetadataMarker(Buffer.from([0xff, 0xfe, 0x00, 0x04]))).toBe(true)
    expect(hasMetadataMarker(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 0x41), Buffer.from([0xff, 0x00, 0xff, 0xd0, 0xff, 0xd9])]))).toBe(false)
    expect(hasMetadataMarker(Buffer.alloc(0))).toBe(false)
  })
})

describe('BE-076: savePhoto refuses a file it cannot clean', () => {
  const run = async (bytes: Buffer) => {
    const pg = await migratedDb()
    try {
      await resetAndSeed(pg)
      const db: Db = pgliteDb(pg)
      const ctx: Ctx = { role: 'supervisor', unitId: ID.unit1 }
      const mem = memoryMediaStore()
      const input = { clientUuid: crypto.randomUUID(), orderId: ID.orderRed, stage: 'sewing', date: '2026-11-04', bytes }
      const err = await savePhoto(db, ctx, mem, input, '2026-11-04').then(() => null, (e: unknown) => e as { status?: number; statusCode?: number; code?: string; message?: string })
      const rows = (await pg.query<{ n: number }>('select count(*)::int as n from photo')).rows[0]!.n
      return { err, stored: mem.files.size, rows }
    } finally { await pg.close() }
  }

  it('BE-076: the crafted file (GPS text, then a segment that runs past the end) is a 400 not_a_photo and nothing is stored', async () => {
    for (const b of [crafted(), crafted2()]) {
      const r = await run(b)
      expect(r.err).not.toBeNull()
      expect(r.err!.code).toBe('not_a_photo')
      expect(r.err!.status ?? r.err!.statusCode).toBe(400)
      expect(r.stored).toBe(0)
      expect(r.rows).toBe(0)
    }
  })

  it('BE-076: an unreadable file with no metadata segment at all is still stored as before (nothing for the walker to remove)', async () => {
    const plain = Buffer.alloc(2000, 0x41); plain[0] = 0xff; plain[1] = 0xd8; plain[2] = 0xff; plain[1998] = 0xff; plain[1999] = 0xd9
    const r = await run(plain)
    expect(r.err).toBeNull()
    expect(r.stored).toBe(1)
  })

  it('BE-076: an ordinary walkable JPEG, with or without Exif, is still accepted', async () => {
    for (const b of [good([jfif()]), good([jfif(), exif()])]) {
      const r = await run(b)
      expect(r.err).toBeNull()
      expect(r.stored).toBe(1)
      expect(r.rows).toBe(1)
    }
  })
})
