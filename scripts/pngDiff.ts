// Compares two sets of screenshots, with no dependency (Node's zlib is enough for the 8-bit PNGs a browser writes). UI/UX plan, slice 0.9.
//
// Why: a refactor that should change nothing visible (phase 2: the atoms) must change no picture, and "I looked and it seems the same"
// is not proof. Run the snapshots, then compare with the set kept before (npm run snapshots does it by itself and writes CHANGES.md).
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export interface Png { width: number; height: number; data: Uint8Array }   // data is RGBA, 4 bytes a pixel
export interface Box { x: number; y: number; w: number; h: number }
export interface PicDiff { same: boolean; sizeChanged: boolean; changedPixels: number; changedPct: number; bbox: Box | null }

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Reads an 8-bit RGB or RGBA PNG that is not interlaced (what a browser screenshot is). Anything else is refused in words. */
export function decodePng(buf: Buffer): Png {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG')
  let pos = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0
  const idat: Buffer[] = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const body = buf.subarray(pos + 8, pos + 8 + len)
    pos += 12 + len
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]! }
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) {
    throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${color}, interlace ${interlace}): only 8-bit RGB or RGBA, not interlaced`)
  }
  const bpp = color === 6 ? 4 : 3
  const stride = width * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const out = new Uint8Array(width * height * 4)
  let prev = new Uint8Array(stride)
  let cur = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const x = line[i]!
      const a = i >= bpp ? cur[i - bpp]! : 0
      const b = prev[i]!
      const c = i >= bpp ? prev[i - bpp]! : 0
      let v: number
      switch (filter) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break }
        default: throw new Error(`bad PNG filter ${filter}`)
      }
      cur[i] = v & 255
    }
    for (let px = 0; px < width; px++) {
      const o = (y * width + px) * 4, s = px * bpp
      out[o] = cur[s]!; out[o + 1] = cur[s + 1]!; out[o + 2] = cur[s + 2]!; out[o + 3] = bpp === 4 ? cur[s + 3]! : 255
    }
    ;[prev, cur] = [cur, prev]
  }
  return { width, height, data: out }
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type: string, body: Buffer): Buffer => {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1')
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, tail])
}

/** Writes an RGBA PNG. Only used by the tests, to build small pictures. */
export function encodePng(p: Png): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(p.width, 0); ihdr.writeUInt32BE(p.height, 4); ihdr[8] = 8; ihdr[9] = 6
  const rows = Buffer.alloc(p.height * (p.width * 4 + 1))
  for (let y = 0; y < p.height; y++) { rows[y * (p.width * 4 + 1)] = 0; Buffer.from(p.data.buffer, p.data.byteOffset + y * p.width * 4, p.width * 4).copy(rows, y * (p.width * 4 + 1) + 1) }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

/** How two pictures of the same size differ: pixels where any channel is more than `tolerance` apart, and the box round them. */
export function comparePng(a: Png, b: Png, tolerance = 0): PicDiff {
  if (a.width !== b.width || a.height !== b.height) return { same: false, sizeChanged: true, changedPixels: 0, changedPct: 0, bbox: null }
  let changed = 0, minX = a.width, minY = a.height, maxX = -1, maxY = -1
  for (let i = 0, p = 0; i < a.data.length; i += 4, p++) {
    if (Math.abs(a.data[i]! - b.data[i]!) > tolerance || Math.abs(a.data[i + 1]! - b.data[i + 1]!) > tolerance
      || Math.abs(a.data[i + 2]! - b.data[i + 2]!) > tolerance || Math.abs(a.data[i + 3]! - b.data[i + 3]!) > tolerance) {
      changed++
      const x = p % a.width, y = Math.floor(p / a.width)
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  return {
    same: changed === 0, sizeChanged: false, changedPixels: changed, changedPct: (changed / (a.width * a.height)) * 100,
    bbox: changed ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  }
}

export type Status = 'same' | 'changed' | 'resized' | 'new' | 'removed'
export interface Row { file: string; status: Status; changedPct: number; bbox: Box | null }

const pngs = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [])

/** Compares every picture by name in two folders. Nothing is written or deleted. */
export function diffSets(beforeDir: string, afterDir: string, tolerance = 0): Row[] {
  const before = new Set(pngs(beforeDir)), after = new Set(pngs(afterDir))
  const rows: Row[] = []
  for (const file of [...new Set([...before, ...after])].sort()) {
    if (!before.has(file)) { rows.push({ file, status: 'new', changedPct: 0, bbox: null }); continue }
    if (!after.has(file)) { rows.push({ file, status: 'removed', changedPct: 0, bbox: null }); continue }
    const d = comparePng(decodePng(fs.readFileSync(path.join(beforeDir, file))), decodePng(fs.readFileSync(path.join(afterDir, file))), tolerance)
    rows.push({ file, status: d.sizeChanged ? 'resized' : d.same ? 'same' : 'changed', changedPct: d.changedPct, bbox: d.bbox })
  }
  return rows
}

/** A short Markdown report: the summary line, then one row for every picture that is not the same. */
export function changesMarkdown(rows: Row[], beforeLabel: string, afterLabel: string): string {
  const count = (s: Status) => rows.filter((r) => r.status === s).length
  const moved = rows.filter((r) => r.status !== 'same')
  let md = `# What changed in the pictures\n\nCompared \`${beforeLabel}\` (before) with \`${afterLabel}\` (after), by name, pixel by pixel.\n\n`
  md += `${rows.length} pictures: **${count('same')} the same**, ${count('changed')} changed, ${count('resized')} resized, ${count('new')} new, ${count('removed')} removed.\n\n`
  if (moved.length === 0) return md + 'No picture changed.\n'
  md += '| Picture | What happened | Pixels changed | Where (x, y, width x height) |\n| --- | --- | --- | --- |\n'
  for (const r of moved) {
    md += `| ${r.file} | ${r.status} | ${r.status === 'changed' ? `${r.changedPct.toFixed(2)}%` : ''} | ${r.bbox ? `${r.bbox.x}, ${r.bbox.y}, ${r.bbox.w} x ${r.bbox.h}` : ''} |\n`
  }
  return md
}
