#!/usr/bin/env node
// Every relative link in the Markdown files must resolve.
//
// The files checked are the ones git knows: tracked files plus new files that are not ignored. That is what a
// fresh CI checkout holds, so a local run and CI agree: an ignored folder such as md/ is neither read nor a valid
// link target (a link into it would break on CI). Without git it walks the disk instead.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist'])

let ROOT
let known = null // Set of repo-relative file paths (forward slashes), or null when git is unavailable
try {
  ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  const ls = (...args) => execFileSync('git', ['ls-files', '-z', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)
  const all = [...new Set([...ls(), ...ls('--others', '--exclude-standard')])]
  // A tracked file deleted from disk is not a file any more.
  known = new Set(all.filter((f) => fs.existsSync(path.join(ROOT, f))))
} catch {
  ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  known = null
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}

const skipped = (rel) => rel.split('/').some((seg) => SKIP_DIRS.has(seg))
const files = known
  ? [...known].filter((f) => f.endsWith('.md') && !skipped(f)).sort().map((f) => path.join(ROOT, f))
  : walk(ROOT)

// Does a link target exist? With git, only what a checkout holds counts: a file git knows, or a folder holding one.
const toRel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')
let dirs = null
function exists(abs) {
  if (!known) return fs.existsSync(abs)
  const rel = toRel(abs)
  if (rel === '') return true
  if (rel.startsWith('..')) return false
  if (known.has(rel)) return true
  if (!dirs) {
    dirs = new Set()
    for (const f of known) for (let d = path.posix.dirname(f); d !== '.'; d = path.posix.dirname(d)) dirs.add(d)
  }
  return dirs.has(rel)
}

const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const problems = []
for (const file of files) {
  // Ignore fenced code so examples are not treated as links.
  const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '')
  for (const m of text.matchAll(LINK)) {
    const target = m[1]
    if (/^(https?:|mailto:|#)/i.test(target)) continue
    let rel
    try { rel = decodeURIComponent(target.split('#')[0].split('?')[0]) } catch { rel = target.split('#')[0] }
    if (!rel) continue
    if (!exists(path.resolve(path.dirname(file), rel))) {
      problems.push(`${path.relative(ROOT, file)}: broken link ${target}`)
    }
  }
}

if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'))
  process.exit(1)
}
console.log(`check_docs: ok (${files.length} Markdown files)`)
