// Removing the metadata a JPEG carries beside its picture (BE-068).
//
// The phone app draws the photo onto a canvas, which drops the camera's EXIF (location, time, device). A scripted upload does not go through
// that step, so its EXIF (a GPS position) would reach the buyer unchanged. The server therefore strips it again before the file is stored.
//
// A JPEG is a list of segments: FF, a marker byte, a two-byte length that counts itself, the payload. The picture itself is the scan that
// follows a "start of scan" segment (marker DA); inside a scan an FF is followed by 00 (a stuffed byte) or by D0-D7 (a restart marker), and
// any other FF xx ends the scan. The walk below follows that, so it also covers progressive files (several scans) and finds the true end of
// the picture (marker D9).
//
// What is kept: SOI, every table and frame segment, every scan byte for byte, APP0 "JFIF", APP2 "ICC_PROFILE" (the colour profile: without it the
// colours shift) and APP14 "Adobe" (it says how a CMYK or YCCK picture must be decoded). What is dropped: APP1 (Exif and XMP), the other APPn
// (Photoshop IRB, MPF, Ducky, JFXX thumbnails and so on) and COM comments. Anything after the final EOI is dropped too: it is not part of the
// picture, and a trailer is a place to hide a second copy of the metadata.
//
// It never throws and refuses nothing: a buffer it cannot walk (not a JPEG, truncated, a length that runs past the end, no EOI) is returned
// unchanged, and so is one with nothing to remove (the very same object).

const APP0 = 0xe0, APP2 = 0xe2, APP14 = 0xee, COM = 0xfe, SOS = 0xda, EOI = 0xd9, SOI = 0xd8

const startsWith = (b: Buffer, at: number, end: number, text: string): boolean => {
  if (at + text.length > end) return false
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false
  return true
}

/** Does the segment whose marker is `m` and payload is b[at, end) belong to the picture's decoding (so it stays)? */
function keepSegment(m: number, b: Buffer, at: number, end: number): boolean {
  if (m === APP0) return startsWith(b, at, end, 'JFIF\0')
  if (m === APP2) return startsWith(b, at, end, 'ICC_PROFILE\0')
  if (m === APP14) return startsWith(b, at, end, 'Adobe')
  if (m === COM) return false
  return !(m >= 0xe1 && m <= 0xef)    // APP1 and every other APPn go; all other segments stay
}

export function stripJpegMetadata(input: Buffer): Buffer {
  try {
    return strip(input)
  } catch {
    return input
  }
}

function strip(b: Buffer): Buffer {
  const n = b.length
  if (n < 4 || b[0] !== 0xff || b[1] !== SOI) return b
  const kept: Buffer[] = []
  let from = 0            // start of the bytes not yet copied to `kept`
  let changed = false
  let i = 2
  for (;;) {
    // at a marker: FF, then any number of FF fill bytes, then the marker code
    if (i >= n || b[i] !== 0xff) return b
    let j = i + 1
    while (j < n && b[j] === 0xff) j++
    if (j >= n) return b
    const m = b[j]!
    if (m === 0x00) return b                       // FF 00 outside a scan is not a marker
    if (m === EOI) {
      const end = j + 1
      if (end < n) { kept.push(b.subarray(from, end)); changed = true; from = n }   // a trailer after the picture is dropped
      break
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === SOI) { i = j + 1; continue }  // markers with no length
    if (j + 2 >= n) return b
    const len = (b[j + 1]! << 8) | b[j + 2]!
    const segEnd = j + 1 + len                     // the length counts its own two bytes
    if (len < 2 || segEnd > n) return b
    if (!keepSegment(m, b, j + 3, segEnd)) {
      kept.push(b.subarray(from, i))
      from = segEnd
      changed = true
    }
    i = segEnd
    if (m === SOS) {
      // the scan: entropy-coded bytes up to the next real marker
      for (;;) {
        if (i >= n) return b                        // the picture never ended
        if (b[i] !== 0xff) { i++; continue }
        let k = i + 1
        while (k < n && b[k] === 0xff) k++
        if (k >= n) return b
        const c = b[k]!
        if (c === 0x00 || (c >= 0xd0 && c <= 0xd7)) { i = k + 1; continue }
        i = k - 1                                   // the FF just before the marker code
        break
      }
    }
  }
  if (!changed) return b
  kept.push(b.subarray(from))
  return Buffer.concat(kept)
}
