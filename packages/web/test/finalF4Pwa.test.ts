import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import configFn from '../vite.config'

// Final cycle W-7: the app can be put on a phone's home screen. A manifest (name, colours, 192 and 512 icons, one maskable), an apple-touch-icon,
// and the build precaches them so the icon and the name are there with no signal. The icons are plain: a flat rounded square in the action colour.
const here = (p: string) => new URL(p, import.meta.url)
const text = (p: string) => readFileSync(here(p), 'utf8')
const tokens = text('../../design/tokens.css')
const token = (name: string) => new RegExp(`${name}:[ ]*(#[0-9A-Fa-f]{6})`).exec(tokens)?.[1]
const manifest = JSON.parse(text('../public/manifest.webmanifest')) as {
  name: string; short_name: string; start_url: string; display: string; theme_color: string; background_color: string; lang?: string
  icons: { src: string; sizes: string; type: string; purpose?: string }[]
}
const pngSize = (p: string) => { const b = readFileSync(here(p)); return { sig: b.subarray(1, 4).toString('latin1'), w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length } }

describe('W-7: the web app manifest', () => {
  it('W-7: names the app and opens it full screen at its start', () => {
    expect(manifest.name).toBe('Order tracking')
    expect(manifest.short_name.length).toBeGreaterThan(0)
    expect(manifest.short_name.length).toBeLessThanOrEqual(12)
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
  })
  it('W-7: takes its colours from the design tokens', () => {
    expect(manifest.theme_color.toLowerCase()).toBe(token('--page')!.toLowerCase())
    expect(manifest.background_color.toLowerCase()).toBe(token('--page')!.toLowerCase())
  })
  it('W-7: has a 192 and a 512 icon and a maskable one, and every file is a real PNG of the size it says', () => {
    const find = (sizes: string, purpose: string) => manifest.icons.find((i) => i.sizes === sizes && (i.purpose ?? 'any') === purpose)
    expect(find('192x192', 'any')).toBeTruthy()
    expect(find('512x512', 'any')).toBeTruthy()
    expect(find('512x512', 'maskable')).toBeTruthy()
    for (const i of manifest.icons) {
      expect(i.type).toBe('image/png')
      expect(existsSync(here(`../public${i.src}`)), i.src).toBe(true)
      const { sig, w, h, bytes } = pngSize(`../public${i.src}`)
      expect(sig).toBe('PNG')
      expect(`${w}x${h}`).toBe(i.sizes)
      expect(bytes).toBeLessThan(40_000)
    }
  })
  it('W-7: an iPhone gets its own 180 icon, linked from the page along with the manifest and the tab icon', () => {
    const html = text('../index.html').replace(/<!--[\s\S]*?-->/g, '')
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/)
    expect(html).toMatch(/<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"/)
    expect(html).toMatch(/<link rel="icon" type="image\/png"[^>]*href="\/icons\//)
    expect(html).not.toContain('href="data:,"')
    expect(pngSize('../public/icons/apple-touch-icon.png')).toMatchObject({ w: 180, h: 180 })
  })
})

describe('W-7: the build keeps them for offline use', () => {
  type Emitted = { fileName: string; source: string }
  const out: Emitted[] = []
  const config = (configFn as unknown as (e: { mode: string; command: string }) => { plugins: { name?: string; generateBundle?: Function }[] })({ mode: 'test', command: 'build' })
  config.plugins.find((p) => p?.name === 'precache-list')!.generateBundle!.call({ emitFile: (f: Emitted) => out.push(f) }, {}, { 'assets/index-a.js': {} })
  const list = JSON.parse(out.find((f) => f.fileName === 'precache.json')!.source) as string[]

  it('W-7: precache.json lists the manifest and every icon the manifest names', () => {
    expect(list).toContain('manifest.webmanifest')
    for (const i of manifest.icons) expect(list, i.src).toContain(i.src.replace(/^\//, ''))
    expect(list).toContain('icons/apple-touch-icon.png')
  })
  it('W-7: the worker serves them from its cache and still never touches the API', () => {
    const sw = text('../public/sw.js')
    expect(sw).toMatch(/startsWith\('\/api\/'\)\) return/)
    expect(sw).toMatch(/\/icons\//)
    expect(sw).toMatch(/manifest\.webmanifest/)
    expect(sw).not.toMatch(/cache\.(put|add)\([^)]*\/api/)
  })
})
