import { afterAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_ACCESS, DEMO_BUYER_LINKS } from '../src/demo/demoAccess'

// The hosted demo's logins and buyer-link tokens are public on purpose, but only in the build made for the demo
// (VITE_DEMO_ACCESS=1). A normal build must not contain them in any file. This builds the real app twice into a temp folder
// (a second or two each) and reads every output file: once without the flag (nothing may be found) and once with it
// (the same search must find them, so a pass above means something).
const webDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const viteBin = resolve(webDir, '../../node_modules/vite/bin/vite.js')
const made: string[] = []

function build(demo: boolean): string {
  const out = mkdtempSync(join(tmpdir(), 'isocode-web-build-'))
  made.push(out)
  const r = spawnSync(process.execPath, [viteBin, 'build', '--outDir', out, '--emptyOutDir'], {
    cwd: webDir, encoding: 'utf8',
    env: { ...process.env, VITE_API_BASE: 'same-origin', VITE_DEMO_ACCESS: demo ? '1' : '' },
  })
  if (r.status !== 0) throw new Error(`vite build failed: ${r.stderr || r.stdout}`)
  return out
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? filesUnder(p) : [p] })
}

function filesContaining(dir: string, needles: string[]): string[] {
  return filesUnder(dir).filter((f) => { const text = readFileSync(f, 'utf8'); return needles.some((n) => text.includes(n)) })
}

const secrets = [
  ...Object.values(DEMO_ACCESS).flat().map((l) => l.secret).filter((s) => s.length > 4),   // the merchandiser password
  ...DEMO_BUYER_LINKS.map((b) => b.token),
]

describe('the demo logins are not in a normal build', () => {
  afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })

  it('a build without VITE_DEMO_ACCESS contains no demo password and no buyer-link token', () => {
    expect(secrets.length).toBeGreaterThan(2)
    expect(filesContaining(build(false), secrets)).toEqual([])
  })

  it('a build with VITE_DEMO_ACCESS=1 keeps them in their own file', () => {
    const found = filesContaining(build(true), secrets)
    expect(found.length).toBe(1)
    expect(found[0]).toMatch(/EvaluatorAccess-.*\.js$/)
  })
})
