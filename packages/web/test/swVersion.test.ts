import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import configFn from '../vite.config'

// A browser installs a new service worker only when the bytes of /sw.js change, and only an
// install precaches the screens. So every build must ship an sw.js of its own.
type Emitted = { fileName: string; source: string }
const build = (bundle: string[]): Emitted[] => {
  const config = (configFn as unknown as (e: { mode: string; command: string }) => { plugins: { name?: string; generateBundle?: Function }[] })({ mode: 'test', command: 'build' })
  const plugin = config.plugins.find((p) => p?.name === 'precache-list')!
  const out: Emitted[] = []
  plugin.generateBundle!.call({ emitFile: (f: Emitted) => out.push(f) }, {}, Object.fromEntries(bundle.map((f) => [f, {}])))
  return out
}
const sw = (out: Emitted[]) => out.find((f) => f.fileName === 'sw.js')?.source

describe('the service worker each build ships', () => {
  const a = build(['assets/index-aaa.js', 'assets/Update-111.js', 'assets/index-aaa.css'])
  const b = build(['assets/index-bbb.js', 'assets/Update-222.js', 'assets/index-aaa.css'])

  it('changes when the build changes, so the browser installs it and precaches the new screens', () => {
    expect(sw(a)).toBeTruthy()
    expect(sw(b)).toBeTruthy()
    expect(sw(a)).not.toBe(sw(b))
  })

  it('is the same for the same build', () => {
    expect(sw(build(['assets/index-aaa.js', 'assets/Update-111.js', 'assets/index-aaa.css']))).toBe(sw(a))
  })

  it('keeps each build in a cache of its own, so activate removes the old build', () => {
    const name = (s: string | undefined) => /const CACHE = '([^']+)'/.exec(s ?? '')?.[1]
    expect(name(sw(a))).toBeTruthy()
    expect(name(sw(a))).not.toBe(name(sw(b)))
    // Everything else is the hand-written worker, unchanged.
    const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
    expect(sw(a)!.replace(/const CACHE = '[^']+'/, '')).toBe(src.replace(/const CACHE = '[^']+'/, ''))
  })

  it('still lists every script and stylesheet for the install step', () => {
    // The manifest and the home-screen icons from public/ come after the bundle's own files (test/finalF4Pwa.test.ts covers them).
    const list = JSON.parse(a.find((f) => f.fileName === 'precache.json')!.source) as string[]
    expect(list.filter((f) => f.startsWith('assets/'))).toEqual(['assets/index-aaa.js', 'assets/Update-111.js', 'assets/index-aaa.css'])
  })

  it('lists the bundled fonts (woff2), so Tamil still has a font with no signal; the old woff fallback is left out', () => {
    const files = ['assets/index-aaa.js', 'assets/noto-sans-latin-400-normal-x1.woff2', 'assets/noto-sans-latin-400-normal-x2.woff', 'assets/noto-sans-tamil-tamil-700-normal-x3.woff2']
    const list = JSON.parse(build(files).find((f) => f.fileName === 'precache.json')!.source) as string[]
    expect(list).toContain('assets/noto-sans-latin-400-normal-x1.woff2')
    expect(list).toContain('assets/noto-sans-tamil-tamil-700-normal-x3.woff2')
    expect(list).not.toContain('assets/noto-sans-latin-400-normal-x2.woff')
  })
})
