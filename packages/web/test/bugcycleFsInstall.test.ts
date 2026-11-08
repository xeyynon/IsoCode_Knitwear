import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

// Final bug cycle (9 Nov 2026): FE-D-01 and FE-D-09. The technical document calls the app installable, so it needs a web app manifest and
// icons; the page also had a blank favicon and no description. The icons and manifest are the ones from finalF4Pwa.test.ts (public/icons/);
// this file keeps the promises that the document relies on: the manifest's fields, the page's links, a description, and small icons.
const url = (p: string) => new URL(p, import.meta.url)
const html = readFileSync(url('../index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const tokens = readFileSync(url('../../design/tokens.css'), 'utf8')
const token = (name: string) => new RegExp(`${name}:[ ]*(#[0-9A-Fa-f]{6})`).exec(tokens)?.[1]?.toLowerCase()
const png = (src: string) => {
  const b = readFileSync(url(`../public/${src.replace(/^\//, '')}`))
  expect(b.subarray(0, 8).toString('hex'), `${src} is a PNG`).toBe('89504e470d0a1a0a')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length }
}

describe('FE-D-01: the app can be installed', () => {
  const manifest = JSON.parse(readFileSync(url('../public/manifest.webmanifest'), 'utf8'))
  it('FE-D-01: the manifest names the app and opens it standalone at its start page', () => {
    expect(manifest.name).toBe('Order tracking')
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.display).toBe('standalone')
  })
  it('FE-D-01: its colours are the design tokens (the page colour)', () => {
    expect(manifest.background_color.toLowerCase()).toBe(token('--page'))
    expect(manifest.theme_color.toLowerCase()).toBe(token('--page'))
  })
  it('FE-D-01: it has the 192 and 512 px icons and a maskable one, all real PNGs of that size', () => {
    const icons = manifest.icons as { src: string; sizes: string; type: string; purpose?: string }[]
    for (const [size, purpose] of [[192, 'any'], [512, 'any'], [512, 'maskable']] as const) {
      const ic = icons.find((i) => i.sizes === `${size}x${size}` && (i.purpose ?? 'any') === purpose)
      expect(ic, `${size} ${purpose}`).toBeTruthy()
      expect(ic!.type).toBe('image/png')
      expect(existsSync(url(`../public/${ic!.src.replace(/^\//, '')}`))).toBe(true)
      expect(png(ic!.src)).toMatchObject({ w: size, h: size })
    }
  })
  it('FE-D-01: the page links the manifest, and the colour of the browser bar is the same page colour', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/)
    expect(html).toMatch(new RegExp(`<meta name="theme-color" content="${token('--page')}"`, 'i'))
  })
})

describe('FE-D-09: a favicon, an iPhone icon and a description', () => {
  it('FE-D-09: the page has a real icon (not the empty data: one) and an apple-touch-icon of 180 px', () => {
    expect(html).not.toContain('href="data:,"')
    expect(html).toMatch(/<link rel="icon"[^>]*href="\/icons\/icon-192\.png"/)
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/)
    expect(png('/icons/apple-touch-icon.png')).toMatchObject({ w: 180, h: 180 })
  })
  it('FE-D-09: the page has a plain description of what it is', () => {
    const d = /<meta name="description" content="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(d.length).toBeGreaterThan(40)
    expect(d.length).toBeLessThan(200)
  })
  it('FE-D-09: the icons stay small (a phone downloads them on its first visit)', () => {
    for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) expect(png(`/icons/${f}`).bytes).toBeLessThan(30_000)
  })
})
