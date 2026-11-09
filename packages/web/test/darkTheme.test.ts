import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Dark mode (user request, 10 Nov 2026). The rule it replaces was "light only". The new rule, which every test here protects:
//   LIGHT BY DEFAULT. DARK ONLY WHEN THE PERSON CHOOSES IT (a menu choice kept on that device). NEVER FROM THE DEVICE'S SETTING ALONE,
//   because the floor reads these screens in bright light and a phone's own "dark mode for websites" must not recolour red, amber and green.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const tokens = read('../../design/tokens.css')
const html = read('../index.html')
const viteConfig = read('../vite.config.ts')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  const s = strip(css)
  const start = s.indexOf(selector + ' {')
  if (start < 0) return ''
  const open = s.indexOf('{', start)
  return s.slice(open + 1, s.indexOf('}', open))
}
const declared = (b: string) => [...b.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map((m) => [m[1]!, m[2]!.trim()] as const)
const isColour = (v: string) => /^#[0-9a-f]{3,8}$/i.test(v) || /^rgba?\(/i.test(v)

const light = block(tokens, ':root')
const dark = block(tokens, ":root[data-theme='dark']")

describe('the dark tokens', () => {
  it('exist, behind the choice made on the page and nothing else', () => {
    expect(dark.length).toBeGreaterThan(200)
    expect(tokens).not.toMatch(/prefers-color-scheme/)
  })
  it('give every colour token of the light set a dark value (parity)', () => {
    const lightColours = declared(light).filter(([, v]) => isColour(v)).map(([n]) => n)
    const darkNames = new Set(declared(dark).map(([n]) => n))
    expect(lightColours.length).toBeGreaterThan(18)
    const missing = lightColours.filter((n) => !darkNames.has(n))
    expect(missing).toEqual([])
  })
  it('keep the status tokens, so red, amber, green and grey mean the same thing in both themes', () => {
    for (const t of ['--status-red', '--status-red-text', '--status-red-tint', '--status-amber', '--status-amber-text', '--status-amber-tint', '--status-green', '--status-grey']) {
      expect(declared(dark).some(([n]) => n === t), t).toBe(true)
    }
  })
  it('tell the browser its native controls are dark; the default stays light', () => {
    expect(dark).toMatch(/color-scheme:\s*dark\b/)
    expect(light).toMatch(/color-scheme:\s*light\b/)
  })
  it('never use a green for grey: the grey token is a blue-grey, the green token a green', () => {
    const v = Object.fromEntries(declared(dark))
    const hue = (hex: string) => { const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return g > r && g > b }
    expect(hue(v['--status-green']!)).toBe(true)
    expect(hue(v['--status-grey']!)).toBe(false)
  })
})

describe('the contrast of the dark pairs', () => {
  const run = () => execFileSync('node', [fileURLToPath(new URL('../../../scripts/check_contrast.mjs', import.meta.url))], { encoding: 'utf8' })
  const out = run()
  it('passes, and checks every light pair again for dark', () => {
    const light = out.split('\n').filter((l) => /^(ok|FAIL)\s/.test(l) && !l.includes('[dark]')).length
    const darkLines = out.split('\n').filter((l) => /^(ok|FAIL)\s/.test(l) && l.includes('[dark]')).length
    expect(light).toBeGreaterThan(20)
    expect(darkLines).toBeGreaterThanOrEqual(light)
    expect(out).not.toMatch(/^FAIL/m)
    expect(out).toContain('check_contrast: ok')
  })
})

describe('light stays the default; the device setting is not read', () => {
  const SRC = fileURLToPath(new URL('../src/', import.meta.url))
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.(css|ts|tsx)$/.test(p) ? [p] : [] })
  it('no stylesheet or source file reads prefers-color-scheme', () => {
    const offenders = files(SRC).filter((f) => /prefers-color-scheme/.test(strip(readFileSync(f, 'utf8'))))
    expect(offenders).toEqual([])
    expect(html.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/prefers-color-scheme/)
  })
  it('index.html still declares light for the first paint, and the public script is the only thing that can change it', () => {
    expect(/<meta\s+name="color-scheme"\s+content="light"\s*\/?>/.test(html)).toBe(true)
  })
})

describe('no flash of the wrong theme (the policy allows no inline script)', () => {
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
  it('a classic script from the app itself is loaded first in the head, before any style', () => {
    const tag = /<script\s+src="\/theme-init\.js"\s*><\/script>/.exec(head)
    expect(tag, 'theme-init.js is loaded').not.toBeNull()
    expect(head).not.toMatch(/<script[^>]*\b(type="module"|defer|async)\b[^>]*theme-init/)
    expect(tag!.index).toBeLessThan(head.indexOf('<style>'))
  })
  it('the first-paint ring has dark colours too, from the same tokens', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(head)?.[1] ?? ''
    expect(style).toMatch(/html\[data-theme='dark'\]/)
    const used = (style.match(/#[0-9A-Fa-f]{6}/g) ?? []).map((c) => c.toLowerCase())
    const dv = Object.fromEntries(declared(dark))
    const lv = Object.fromEntries(declared(light))
    const allowed = ['--page', '--border', '--accent'].flatMap((n) => [lv[n], dv[n]]).map((c) => c!.toLowerCase())
    for (const c of used) expect(allowed, c).toContain(c)
    expect(used).toContain(dv['--page']!.toLowerCase())
  })
  it('the service worker keeps the script, so a reload with no signal still applies the theme', () => {
    expect(viteConfig).toMatch(/files\.push\([^)]*'theme-init\.js'/)
    expect(existsPublic('theme-init.js')).toBe(true)
  })
})

function existsPublic(name: string): boolean {
  try { return statSync(fileURLToPath(new URL(`../public/${name}`, import.meta.url))).isFile() } catch { return false }
}

describe('the menu keeps a Tamil label on one line', () => {
  it('a menu item does not wrap (seen in the pictures: the Tamil theme label broke into two lines)', () => {
    expect(/\.menu__item\s*\{[^}]*white-space:\s*nowrap/.test(strip(read('../src/styles.css')))).toBe(true)
  })
})

describe('the menu offers the choice', () => {
  const appBar = read('../src/ui/AppBar.tsx')
  it('AppBar draws the theme item, and the arrow keys reach it', () => {
    expect(appBar).toContain('<ThemeMenuItem')
    // (the arrow keys are the one shared menu's: PopoverMenu moves focus over every [role="menuitem"] row, and popoverMenu.test.tsx drives it)
    expect(appBar).toContain('<PopoverMenu')
    expect(read('../src/ui/molecules/PopoverMenu.tsx')).toMatch(/\[role="menuitem"\]/)
  })
})

describe('the dev server proxy can point at a private API', () => {
  it('defaults to 8787 and reads API_TARGET', () => {
    const cfg = read('../vite.config.ts')
    expect(cfg).toContain("process.env.API_TARGET ?? 'http://localhost:8787'")
  })
})
