import { describe, expect, it } from 'vitest'
import { comparePng, decodePng, encodePng, type Png } from '../../../scripts/pngDiff'

// UI/UX plan, slice 0.9. A refactor that should change nothing visible (phase 2: the atoms) must change no picture. This is the
// comparison that proves it, written without a dependency (Node's zlib), so these tests build tiny PNGs and check what it finds.
const solid = (w: number, h: number, rgba: [number, number, number, number] = [255, 255, 255, 255]): Png => {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4)
  return { width: w, height: h, data }
}
const paint = (p: Png, x0: number, y0: number, w: number, h: number, rgba: [number, number, number, number]): Png => {
  const data = p.data.slice()
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.set(rgba, (y * p.width + x) * 4)
  return { ...p, data }
}

describe('reading and writing a PNG', () => {
  it('gets back exactly what was written', () => {
    const p = paint(solid(7, 5), 2, 1, 3, 2, [10, 20, 30, 255])
    const back = decodePng(encodePng(p))
    expect([back.width, back.height]).toEqual([7, 5])
    expect([...back.data]).toEqual([...p.data])
  })
  it('refuses something that is not a PNG, in words', () => {
    expect(() => decodePng(Buffer.from('not a picture'))).toThrow(/not a PNG/)
  })
})

describe('comparing two pictures', () => {
  it('finds identical pictures identical', () => {
    const d = comparePng(solid(20, 10), solid(20, 10))
    expect(d).toMatchObject({ same: true, changedPixels: 0, changedPct: 0, bbox: null, sizeChanged: false })
  })
  it('counts the changed pixels and boxes them', () => {
    const a = solid(20, 10)
    const b = paint(a, 4, 2, 5, 3, [0, 0, 0, 255])
    const d = comparePng(a, b)
    expect(d.same).toBe(false)
    expect(d.changedPixels).toBe(15)
    expect(d.changedPct).toBeCloseTo((15 / 200) * 100, 5)
    expect(d.bbox).toEqual({ x: 4, y: 2, w: 5, h: 3 })
  })
  it('ignores a difference inside the tolerance, and no more', () => {
    const a = solid(4, 4, [100, 100, 100, 255])
    const b = solid(4, 4, [105, 100, 100, 255])
    expect(comparePng(a, b, 5).same).toBe(true)
    expect(comparePng(a, b, 4).same).toBe(false)
  })
  it('says so when the size changed, instead of comparing different shapes', () => {
    const d = comparePng(solid(20, 10), solid(20, 12))
    expect(d.sizeChanged).toBe(true)
    expect(d.same).toBe(false)
  })
  it('notices a change in one channel and in transparency', () => {
    expect(comparePng(solid(3, 3, [1, 2, 3, 255]), solid(3, 3, [1, 2, 9, 255])).same).toBe(false)
    expect(comparePng(solid(3, 3, [1, 2, 3, 255]), solid(3, 3, [1, 2, 3, 128])).same).toBe(false)
  })
})
