// Bug round 2: BE-073, database dumps and local database files could be committed, a source folder named data/ was hidden,
// and the Node version the README requires was not stated in package.json.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ROOT, git, removeDirs, run, scriptIn, scriptRepo, write } from './scriptHelpers'

const dirs: string[] = []
let dir = ''
afterEach(() => { removeDirs(dirs); dir = '' })
function scratchRepo() {
  dir = scriptRepo(dirs, 'repoguard2')
  fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(dir, '.gitignore'))
}
const ignored = (rel: string) => spawnSync('git', ['check-ignore', '-q', rel], { cwd: dir }).status === 0
const check = () => run(scriptIn(dir, 'check_repo.mjs'), dir, [], {})

describe('BE-073: database files stay out of git', () => {
  it.each(['backup.dump', 'packages/server/local.sqlite', 'local.sqlite3', 'packages/server/app.db'])('BE-073: .gitignore hides %s', (rel) => {
    scratchRepo()
    expect(ignored(rel)).toBe(true)
  })

  it('BE-073: .gitignore hides a data/ folder at the top (pilot data) and the local assistant settings, but not source in a data/ folder deeper down', () => {
    scratchRepo()
    expect(ignored('data/orders.csv')).toBe(true)
    expect(ignored('.claude/settings.local.json')).toBe(true)
    expect(ignored('packages/server/src/data/seed.ts')).toBe(false)
    expect(ignored('.claude/worktrees/x/file.ts')).toBe(true)    // the whole .claude/ folder is local tooling (final cycle, R-24)
  })

  it.each(['backup.dump', 'packages/server/local.sqlite', 'local.sqlite3', 'packages/server/app.db'])('BE-073: check_repo refuses %s once force-added', (rel) => {
    scratchRepo()
    write(dir, rel, 'SQLite format 3\0')
    git(dir, 'add', '-f', rel)
    const r = check()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`${rel}: must not be tracked`)
  })

  it('BE-073: an ordinary file named like a database word is not refused', () => {
    scratchRepo()
    write(dir, 'docs/dumpster.md', 'plain words\n')
    write(dir, 'packages/server/db/seed.sql', 'select 1;\n')
    expect(check().status).toBe(0)
  })

  it('BE-073: package.json states the Node version the README asks for', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { engines?: { node?: string } }
    expect(pkg.engines?.node).toBe('>=20.19')
    expect(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')).toContain('Node 20.19 also works')
  })
})
