import { describe, expect, it } from 'vitest'
import { orientationMatrix, orientedSize, readExifOrientation, type Orientation } from '../src/photo/orientation'
import { drawPlan } from '../src/photo/resize'

/** A tiny JPEG header: start of image, then an EXIF segment holding one orientation entry, then start of scan. */
function jpegWithOrientation(value: number, order: 'II' | 'MM' = 'MM', extraSegmentFirst = false): Uint8Array {
  const little = order === 'II'
  const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255])
  const u32 = (n: number) => (little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255])
  const entry = [...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0]
  const tiff = [order.charCodeAt(0), order.charCodeAt(1), ...u16(42), ...u32(8), ...u16(1), ...entry, ...u32(0)]
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const size = exif.length + 2
  const app0 = [0xff, 0xe0, 0, 6, 1, 2, 3, 4]                       // a JFIF-like segment before the EXIF one
  return Uint8Array.from([0xff, 0xd8, ...(extraSegmentFirst ? app0 : []), 0xff, 0xe1, size >> 8, size & 255, ...exif, 0xff, 0xda, 0, 2])
}

describe('reading the camera\'s "turn it" tag', () => {
  it('reads every orientation, in both byte orders', () => {
    for (const order of ['II', 'MM'] as const) {
      for (let v = 1; v <= 8; v++) expect(readExifOrientation(jpegWithOrientation(v, order))).toBe(v)
    }
  })
  it('finds it after another header segment', () => {
    expect(readExifOrientation(jpegWithOrientation(6, 'MM', true))).toBe(6)
  })
  it('says "upright" when there is no tag, no JPEG, or the file is cut short or damaged', () => {
    expect(readExifOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1)
    expect(readExifOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(1)
    expect(readExifOrientation(new Uint8Array())).toBe(1)
    const whole = jpegWithOrientation(6)
    for (let cut = 0; cut < whole.length; cut++) {
      const o = readExifOrientation(whole.slice(0, cut))
      expect(o === 1 || o === 6).toBe(true)                          // never throws, never invents another turn
    }
    expect(readExifOrientation(jpegWithOrientation(9))).toBe(1)      // not one of the eight
    expect(readExifOrientation(jpegWithOrientation(0))).toBe(1)
  })
})

describe('turning a picture the right way up', () => {
  it('a quarter turn swaps width and height; the others keep them', () => {
    for (const o of [1, 2, 3, 4] as Orientation[]) expect(orientedSize(o, 400, 300)).toEqual({ width: 400, height: 300 })
    for (const o of [5, 6, 7, 8] as Orientation[]) expect(orientedSize(o, 400, 300)).toEqual({ width: 300, height: 400 })
  })

  // Where the raw picture's top-left pixel must land, per the EXIF standard (in the upright box).
  it('puts the raw top-left corner where the standard says, and keeps every corner inside the upright picture', () => {
    const w = 400, h = 300
    const topLeftGoesTo: Record<Orientation, [number, number]> = {
      1: [0, 0], 2: [w, 0], 3: [w, h], 4: [0, h], 5: [0, 0], 6: [h, 0], 7: [h, w], 8: [0, w],
    }
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8] as Orientation[]) {
      const [a, b, c, d, e, f] = orientationMatrix(o, w, h)
      const at = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f]
      expect(at(0, 0)).toEqual(topLeftGoesTo[o])
      const box = orientedSize(o, w, h)
      for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
        const [px, py] = at(x, y)
        expect(px).toBeGreaterThanOrEqual(0); expect(px).toBeLessThanOrEqual(box.width)
        expect(py).toBeGreaterThanOrEqual(0); expect(py).toBeLessThanOrEqual(box.height)
      }
    }
  })

  it('a portrait phone photo (stored sideways, tag 6) comes out taller than wide', () => {
    expect(orientedSize(readExifOrientation(jpegWithOrientation(6)), 1600, 1200)).toEqual({ width: 1200, height: 1600 })
  })
})

describe('the drawing plan for a shrunk, upright photo', () => {
  it('a sideways 4000x3000 photo (tag 6) becomes a 960x1280 canvas drawn from a 1280x960 source rectangle', () => {
    const plan = drawPlan(6, 4000, 3000)
    expect(plan.canvas).toEqual({ width: 960, height: 1280 })
    expect(plan.draw).toEqual({ width: 1280, height: 960 })
    expect(plan.matrix).toEqual([0, 1, -1, 0, 960, 0])
  })
  it('an upright photo is only shrunk, and a small one is never enlarged', () => {
    expect(drawPlan(1, 4000, 3000).canvas).toEqual({ width: 1280, height: 960 })
    expect(drawPlan(1, 640, 480).canvas).toEqual({ width: 640, height: 480 })
    expect(drawPlan(1, 640, 480).matrix).toEqual([1, 0, 0, 1, 0, 0])
  })
  it('the longest side stays within the limit for every orientation', () => {
    for (let o = 1; o <= 8; o++) {
      const { canvas } = drawPlan(o as Orientation, 5000, 2000)
      expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(1280)
    }
  })
})
