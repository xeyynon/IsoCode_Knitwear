// Which way up a camera photo is. A phone held upright still stores the picture sideways and notes
// "turn it a quarter" in a small hidden tag (EXIF orientation, 1 to 8). Drawing the raw pixels and
// dropping that tag sends the photo sideways. Pure functions, so the maths is tested without a browser.

export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

const isOrientation = (n: number): n is Orientation => n >= 1 && n <= 8

/**
 * The orientation tag of a JPEG (1 when there is none, or the file is not a JPEG, or it is damaged).
 * Reads only the header segments, never the picture, and never throws or reads past the end.
 */
export function readExifOrientation(bytes: Uint8Array): Orientation {
  const len = bytes.length
  if (len < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  let pos = 2
  while (pos + 4 <= len) {
    if (bytes[pos] !== 0xff) return 1
    const marker = bytes[pos + 1]!
    if (marker === 0xff) { pos += 1; continue }                      // padding before a marker
    if (marker === 0xda || marker === 0xd9) return 1                 // picture data or end: no tag was found
    const size = (bytes[pos + 2]! << 8) | bytes[pos + 3]!
    if (size < 2) return 1
    if (marker === 0xe1) {
      const found = orientationInApp1(bytes, pos + 4, Math.min(len, pos + 2 + size))
      if (found) return found
    }
    pos += 2 + size
  }
  return 1
}

function orientationInApp1(b: Uint8Array, start: number, end: number): Orientation | null {
  // "Exif\0\0", then a TIFF header: byte order, 42, offset of the first directory.
  if (end - start < 14) return null
  if (b[start] !== 0x45 || b[start + 1] !== 0x78 || b[start + 2] !== 0x69 || b[start + 3] !== 0x66 || b[start + 4] !== 0 || b[start + 5] !== 0) return null
  const tiff = start + 6
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49
  const big = b[tiff] === 0x4d && b[tiff + 1] === 0x4d
  if (!little && !big) return null
  const u16 = (at: number) => (at + 2 > end ? -1 : little ? b[at]! | (b[at + 1]! << 8) : (b[at]! << 8) | b[at + 1]!)
  const u32 = (at: number) => (at + 4 > end ? -1 : little
    ? (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0
    : ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0)
  if (u16(tiff + 2) !== 42) return null
  const dir = tiff + u32(tiff + 4)
  const count = u16(dir)
  if (count < 0) return null
  for (let i = 0; i < count; i++) {
    const entry = dir + 2 + i * 12
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)                                   // a SHORT stored in the entry itself
      return value > 0 && isOrientation(value) ? value : null
    }
  }
  return null
}

/** The size of the picture once turned the right way up: a quarter turn (5 to 8) swaps width and height. */
export function orientedSize(orientation: Orientation, width: number, height: number): { width: number; height: number } {
  return orientation >= 5 ? { width: height, height: width } : { width, height }
}

/**
 * The canvas matrix [a, b, c, d, e, f] (for `setTransform`) that draws a raw `width` x `height`
 * picture the right way up on a canvas of `orientedSize(...)`.
 */
export function orientationMatrix(orientation: Orientation, width: number, height: number): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2: return [-1, 0, 0, 1, width, 0]
    case 3: return [-1, 0, 0, -1, width, height]
    case 4: return [1, 0, 0, -1, 0, height]
    case 5: return [0, 1, 1, 0, 0, 0]
    case 6: return [0, 1, -1, 0, height, 0]
    case 7: return [0, -1, -1, 0, height, width]
    case 8: return [0, -1, 1, 0, 0, width]
    default: return [1, 0, 0, 1, 0, 0]
  }
}
