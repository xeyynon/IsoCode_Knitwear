import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// Worker photos land in MEDIA_DIR (./media in .env.example). They are real worker data and the repo is
// public, so .gitignore must hide them and scripts/check_repo.mjs must refuse them if they are added anyway.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const CHECK = path.join(ROOT, 'scripts', 'check_repo.mjs')

let dir = ''
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = '' })

function scratchRepo() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repoguard-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(dir, '.gitignore'))
  return dir
}
function put(rel: string) {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))
}
const ignored = (rel: string) => spawnSync('git', ['check-ignore', '-q', rel], { cwd: dir }).status === 0
const check = () => spawnSync(process.execPath, [CHECK], { cwd: dir, encoding: 'utf8', env: { ...process.env, BANNED_TERMS: '' } })

describe('repo guards keep worker photos out of git', () => {
  it('.gitignore hides photos under media/ and uploads/', () => {
    scratchRepo()
    expect(ignored('packages/server/media/ab/x.jpg')).toBe(true)
    expect(ignored('packages/server/uploads/x.jpg')).toBe(true)
  })

  it.each(['packages/server/media/ab/x.jpg', 'packages/server/uploads/x.jpg'])('check_repo refuses %s once added', (rel) => {
    scratchRepo()
    put(rel)
    execFileSync('git', ['add', '-f', rel], { cwd: dir })
    const r = check()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`${rel}: must not be tracked`)
  })

  it('check_repo still passes a clean repo', () => {
    scratchRepo()
    put('packages/web/public/icon.png')
    expect(check().status).toBe(0)
  })
})

// Keys are split in two so this file never looks like a key itself.
const AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP'
const TOKENS: [string, string][] = [
  ['.npmrc', `//registry.npmjs.org/:_authToken=npm_${'a1B2c3D4e5'.repeat(3)}abcdef\n`],
  ['deploy.sh', `export AWS_KEY=${AWS}\n`],
  ['notes.ps1', `$k = '${AWS}'\n`],
  ['config.cjs', `module.exports = '${AWS}'\n`],
  ['tool.mts', `export const k = '${AWS}'\n`],
  ['Dockerfile', `ENV KEY=${AWS}\n`],
  ['gh.txt', `token=github_pat_${'A1b2C3d4E5'.repeat(3)}_xyz\n`],
  ['stripe.txt', `key=sk_live_${'A1b2C3d4E5'.repeat(2)}\n`],
]

describe('check_repo reads every text file for key-shaped strings', () => {
  it.each(TOKENS)('refuses a key in %s', (rel, body) => {
    scratchRepo()
    fs.writeFileSync(path.join(dir, rel), body)
    const r = check()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`FAIL ${rel}: looks like a`)
  })
})
