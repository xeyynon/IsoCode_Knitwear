import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { KEEP_BUILDS, publicBuilds } from '../../../scripts/buildInfo.mjs'

// The release bookkeeping scripts (scripts/changelog.mjs, check_repo.mjs, check_docs.mjs) and the release
// workflow, each run against a throw-away git repository so nothing here touches the real tree.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const CHANGELOG = path.join(ROOT, 'scripts', 'changelog.mjs')
const CHECK_REPO = path.join(ROOT, 'scripts', 'check_repo.mjs')
const CHECK_DOCS = path.join(ROOT, 'scripts', 'check_docs.mjs')

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

function tmp(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  dirs.push(d)
  return d
}
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function repo(prefix = 'tooling') {
  const d = tmp(prefix)
  git(d, 'init', '-q')
  return d
}
function write(dir: string, rel: string, text: string) {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
}
const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8')
const run = (script: string, cwd: string, args: string[] = [], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, BANNED_TERMS: '', ...env } })
const changelog = (cwd: string, ...args: string[]) => run(CHANGELOG, cwd, args)

// ---------------------------------------------------------------------------------------------------
// BUG-054: --pending run again with a new title
// ---------------------------------------------------------------------------------------------------
describe('changelog --pending run again replaces the pending report', () => {
  function pendingRepo() {
    const d = repo('pending')
    write(d, 'a.txt', 'a\n')
    git(d, 'add', 'a.txt')
    git(d, 'commit', '-q', '-m', 'InBul01: start')
    git(d, 'tag', 'InBul01')
    write(d, 'b.txt', 'b\n')
    git(d, 'add', 'b.txt')
    return d
  }

  it('the new title wins everywhere, and --tag accepts the commit that carries it', () => {
    const d = pendingRepo()
    let r = changelog(d, '--pending', 'Old title', 'Old summary.', '--why', 'old why', '--verified', 'old check', '--next', 'old next')
    expect(r.status, r.stderr).toBe(0)
    r = changelog(d, '--pending', 'New title', 'New summary.', '--why', 'new why', '--verified', 'new check', '--next', 'new next')
    expect(r.status, r.stderr).toBe(0)
    expect(r.stderr).toContain('replaced with "New title"')

    const report = read(d, 'docs/builds/build-1000.md')
    expect(report).toContain('# Build 1000: New title')
    for (const stale of ['Old title', 'Old summary', 'old why', 'old check', 'old next']) {
      expect(report).not.toContain(stale)
      expect(read(d, 'CHANGELOG.md')).not.toContain(stale)
      expect(read(d, 'build-info.json')).not.toContain(stale)
    }
    expect(report).toContain('- b.txt')
    expect(JSON.parse(read(d, 'build-info.json')).builds[0]).toMatchObject({ n: 1000, title: 'New title', summary: 'New summary.' })

    git(d, 'add', 'docs/builds', 'CHANGELOG.md', 'build-info.json')
    git(d, 'commit', '-q', '-m', 'New title')
    const tag = changelog(d, '--tag')
    expect(tag.status, tag.stderr).toBe(0)
    expect(git(d, 'tag', '--list', 'build-*')).toBe('build-1000')
  })

  it('a part that is not passed again is kept, and a placeholder stays a placeholder', () => {
    const d = pendingRepo()
    changelog(d, '--pending', 'Title', 'Summary.', '--why', 'because')
    const r = changelog(d, '--pending', 'Title', 'Summary two.', '--verified', 'checked')
    expect(r.status, r.stderr).toBe(0)
    const report = read(d, 'docs/builds/build-1000.md')
    expect(report).toContain('Summary two.')
    expect(report).not.toContain('Summary.\n')
    expect(report).toContain('because')
    expect(report).toContain('checked')
    expect(report).toContain('(what to improve next)')
    expect(r.stderr).not.toContain('replaced with')
  })
})

// ---------------------------------------------------------------------------------------------------
// BUG-068: the attribution check
// ---------------------------------------------------------------------------------------------------
describe('check_repo attribution check reads real attribution lines only', () => {
  function commitWith(message: string) {
    const d = repo('attrib')
    write(d, 'README.md', '# x\n')
    git(d, 'add', 'README.md')
    write(d, 'msg.txt', message)
    // msg.txt is outside the index; -F reads it from the work tree
    git(d, 'commit', '-q', '-F', 'msg.txt')
    fs.rmSync(path.join(d, 'msg.txt'))
    return run(CHECK_REPO, d)
  }

  it.each([
    'Add the report\n\nThe totals are generated by the engine, not typed by hand.\nGenerated by hand before, now by code.',
    'Fix it\n\nThe file is generated with a script that we wrote.\nThe word co-authored-by: only appears mid-line here.',
    'Generated by the engine: new report totals',
  ])('passes ordinary prose: %j', (message) => {
    const r = commitWith(message)
    expect(r.status, r.stderr).toBe(0)
  })

  it.each([
    'Add it\n\nCo-Authored-By: Someone <someone@example.com>',
    'Add it\n\nco-authored-by: Someone <someone@example.com>\n',
    'Add it\n\n\u{1F916} Generated with [Claude Code](https://claude.com/claude-code)',
    'Add it\n\nGenerated with Claude Code',
    'Add it\n\nGenerated by Copilot',
  ])('refuses an attribution line: %j', (message) => {
    const r = commitWith(message)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('has an attribution line')
  })
})

// ---------------------------------------------------------------------------------------------------
// BUG-069: build-info.json summaries
// ---------------------------------------------------------------------------------------------------
describe('build-info.json keeps whole summaries and a short list', () => {
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') + '.' // about 400 characters

  it('publicBuilds keeps the whole summary, only the four public fields, newest first, KEEP_BUILDS of them', () => {
    const reports = Array.from({ length: 14 }, (_, i) => ({ n: 1000 + i, date: '2026-11-03', title: `T${i}`, summary: long, why: 'private', extra: 1 }))
    const pub = publicBuilds(reports)
    expect(KEEP_BUILDS).toBe(10)
    expect(pub).toHaveLength(10)
    expect(pub.map((b: { n: number }) => b.n)).toEqual([1013, 1012, 1011, 1010, 1009, 1008, 1007, 1006, 1005, 1004])
    expect(Object.keys(pub[0]!)).toEqual(['n', 'date', 'title', 'summary'])
    expect(pub[0]!.summary).toBe(long)
    expect(long.length).toBeGreaterThan(240)
  })

  function reportText(n: number, summary: string) {
    return `# Build ${n}: Title ${n}\n\nDate: 2026-11-0${(n % 9) + 1}\nTag: build-${n}\n\n<!-- manual:start -->\n## What changed\n\n${summary}\n\nA second paragraph that stays in the report only.\n\n## Why\n\nWhy.\n<!-- manual:end -->\n\n## Files changed\n\n- x\n`
  }

  it('--regenerate is deterministic, keeps the last 10 whole, and matches the shape the web reader uses', () => {
    const d = repo('regen')
    write(d, 'a.txt', 'a')
    git(d, 'add', 'a.txt'); git(d, 'commit', '-q', '-m', 'InBul01: start')
    for (let n = 1000; n < 1012; n++) write(d, `docs/builds/build-${n}.md`, reportText(n, long))
    expect(changelog(d, '--regenerate').status).toBe(0)
    const first = [read(d, 'build-info.json'), read(d, 'CHANGELOG.md')]
    expect(changelog(d, '--regenerate').status).toBe(0)
    expect([read(d, 'build-info.json'), read(d, 'CHANGELOG.md')]).toEqual(first)

    const info = JSON.parse(first[0]!)
    expect(Object.keys(info)).toEqual(['_note', 'latest', 'builds'])
    expect(info.latest).toBe(1011)
    expect(info.builds).toHaveLength(10)
    expect(info.builds[0]).toEqual({ n: 1011, date: '2026-11-04', title: 'Title 1011', summary: long })
    expect(info.builds[9].n).toBe(1002)
    expect(first[0]!).not.toContain('second paragraph')
  })

  it('--pending writes a long summary to build-info.json without cutting it', () => {
    const d = repo('pendlong')
    write(d, 'a.txt', 'a')
    git(d, 'add', 'a.txt'); git(d, 'commit', '-q', '-m', 'InBul01: start'); git(d, 'tag', 'InBul01')
    const r = changelog(d, '--pending', 'A title', long, '--why', 'w', '--verified', 'v', '--next', 'n')
    expect(r.status, r.stderr).toBe(0)
    expect(JSON.parse(read(d, 'build-info.json')).builds[0].summary).toBe(long)
  })

  it('the committed build-info.json is exactly what --regenerate builds from docs/builds', () => {
    const d = repo('realregen')
    fs.cpSync(path.join(ROOT, 'docs', 'builds'), path.join(d, 'docs', 'builds'), { recursive: true })
    expect(changelog(d, '--regenerate').status).toBe(0)
    expect(JSON.parse(read(d, 'build-info.json'))).toEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'build-info.json'), 'utf8')))
    expect(read(d, 'CHANGELOG.md')).toBe(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'))
  })
})

// ---------------------------------------------------------------------------------------------------
// BUG-070: check_docs looks at the files git knows, so a local run equals CI
// ---------------------------------------------------------------------------------------------------
describe('check_docs checks tracked and new-but-not-ignored Markdown only', () => {
  const docs = (cwd: string) => run(CHECK_DOCS, cwd)

  it('ignores a broken link in an ignored folder', () => {
    const d = repo('docs')
    write(d, '.gitignore', '/md/\n')
    write(d, 'md/private.md', '[gone](missing.md)\n')
    write(d, 'README.md', '[ok](docs/a.md)\n')
    write(d, 'docs/a.md', 'fine\n')
    const r = docs(d)
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('2 Markdown files')
  })

  it('checks a new file that is not ignored, even before git add', () => {
    const d = repo('docs')
    write(d, 'README.md', '[x](nowhere.md)\n')
    const r = docs(d)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('README.md: broken link nowhere.md')
  })

  it('a link into an ignored folder is broken, as it is on a fresh CI checkout', () => {
    const d = repo('docs')
    write(d, '.gitignore', '/md/\n')
    write(d, 'md/notes.md', 'private\n')
    write(d, 'README.md', '[n](md/notes.md)\n')
    const r = docs(d)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('broken link md/notes.md')
  })

  it('accepts links to a folder, an anchor and a non-Markdown file, and skips fenced examples', () => {
    const d = repo('docs')
    write(d, 'README.md', '[a](docs/) [b](docs/a.md#top) [c](pic.png) [e](https://example.com)\n```\n[fake](nope.md)\n```\n')
    write(d, 'docs/a.md', 'x\n')
    write(d, 'pic.png', 'x')
    const r = docs(d)
    expect(r.status, r.stderr).toBe(0)
  })

  it('a tracked file deleted from disk is not a link target', () => {
    const d = repo('docs')
    write(d, 'README.md', '[a](old.md)\n')
    write(d, 'old.md', 'x\n')
    git(d, 'add', '.'); git(d, 'commit', '-q', '-m', 'InBul01: x')
    fs.rmSync(path.join(d, 'old.md'))
    expect(docs(d).status).toBe(1)
  })

  it('without git it falls back to walking the folder', () => {
    const d = tmp('nogit')
    fs.mkdirSync(path.join(d, 'scripts'))
    fs.copyFileSync(CHECK_DOCS, path.join(d, 'scripts', 'check_docs.mjs'))
    write(d, 'README.md', '[a](docs/a.md)\n')
    write(d, 'docs/a.md', 'x\n')
    const script = path.join(d, 'scripts', 'check_docs.mjs')
    const env = { GIT_CEILING_DIRECTORIES: path.dirname(d) }
    let r = run(script, d, [], env)
    expect(r.status, r.stderr).toBe(0)
    write(d, 'docs/b.md', '[c](missing.md)\n')
    r = run(script, d, [], env)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('docs/b.md'.split('/').join(path.sep))
  })
})

// ---------------------------------------------------------------------------------------------------
// release.yml: the notes come from the report, and a missing or empty one fails the step
// ---------------------------------------------------------------------------------------------------
describe('release workflow extracts the notes and refuses to publish empty ones', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8').split(/\r?\n/)
  function runBlock() {
    const start = yml.findIndex((l) => /^\s+run: \|\s*$/.test(l))
    expect(start).toBeGreaterThan(-1)
    const indent = /^(\s*)/.exec(yml[start + 1]!)![1]!.length
    const out: string[] = []
    for (const l of yml.slice(start + 1)) {
      if (l.trim() !== '' && !(/^\s*/.exec(l)![0].length >= indent)) break
      out.push(l.slice(indent))
    }
    return out.join('\n').trim() + '\n'
  }
  const bash = (() => {
    const candidates = process.platform === 'win32'
      ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'].filter((p) => fs.existsSync(p))
      : ['bash']
    for (const c of candidates) {
      if (spawnSync(c, ['-c', 'command -v awk sed'], { encoding: 'utf8' }).status === 0) return c
    }
    return null
  })()

  it('the step runs under bash with pipefail so a missing report fails', () => {
    const text = yml.join('\n')
    expect(text).toMatch(/shell: bash/)
    expect(text).toContain('test -s notes.txt')
  })

  const exec = (cwd: string, tag: string) => {
    const bin = path.join(cwd, 'bin')
    fs.mkdirSync(bin, { recursive: true })
    // A stand-in for the gh CLI that records the notes it was asked to publish.
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\ncp "$7" published.txt\necho "$@" > gh-args.txt\n', { mode: 0o755 })
    fs.writeFileSync(path.join(cwd, 'step.sh'), runBlock())
    const posix = (p: string) => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, '/$1').split('\\').join('/') : p)
    return spawnSync(bash!, ['-e', '-o', 'pipefail', 'step.sh'], {
      cwd, encoding: 'utf8',
      env: { ...process.env, GITHUB_REF_NAME: tag, PATH: `${posix(bin)}${process.platform === 'win32' ? ':' : path.delimiter}${process.env.PATH}` },
    })
  }

  it.skipIf(!bash)('publishes only the "What changed" paragraph', () => {
    const d = tmp('release')
    write(d, 'docs/builds/build-1000.md', '# Build 1000: T\n\n<!-- manual:start -->\n## What changed\n\nThe public words.\n\n## Why\n\nPrivate why.\n<!-- manual:end -->\n\n## Files changed\n\n- secret/file.ts\n')
    const r = exec(d, 'build-1000')
    expect(r.status, r.stderr).toBe(0)
    const notes = fs.readFileSync(path.join(d, 'published.txt'), 'utf8')
    expect(notes).toContain('The public words.')
    expect(notes).not.toMatch(/Private why|secret\/file/)
  })

  it.skipIf(!bash)('fails, and publishes nothing, when the report is missing', () => {
    const d = tmp('release')
    const r = exec(d, 'build-1000')
    expect(r.status).not.toBe(0)
    expect(fs.existsSync(path.join(d, 'gh-args.txt'))).toBe(false)
  })

  it.skipIf(!bash)('fails, and publishes nothing, when the report has no "What changed" text', () => {
    const d = tmp('release')
    write(d, 'docs/builds/build-1000.md', '# Build 1000: T\n\n## What changed\n\n## Why\n\nx\n')
    const r = exec(d, 'build-1000')
    expect(r.status).not.toBe(0)
    expect(r.stdout + r.stderr).toContain("no 'What changed' text")
    expect(fs.existsSync(path.join(d, 'gh-args.txt'))).toBe(false)
  })
})
