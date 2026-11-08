#!/usr/bin/env node
// Every relative link in the Markdown files must resolve, and so must its #anchor.
//
// Links read: inline [text](target) (with a "title", with <angle brackets> around a target that has spaces, with balanced
// parentheses inside the target), reference definitions "[ref]: target", and src= / href= in HTML. Links inside fenced
// code and inline code are examples and are skipped. A #fragment must be a heading of the target Markdown file (GitHub's
// rule for the id: lower-case, punctuation dropped, spaces to hyphens, a repeat gets -1, -2), or an <a name=".."> / id=".."
// in it; #top is always fine. External links (http:, mailto:, ...) are not fetched.
//
// The files checked are the ones git knows: tracked files plus new files that are not ignored. That is what a
// fresh CI checkout holds, so a local run and CI agree: an ignored folder (private notes, say) is neither read nor a
// valid link target (a link into it would break on CI). Without git it walks the disk instead. It acts on the
// repository that holds this script, whatever the folder it was started from.
//
// One more rule: every environment variable the server code (packages/server/src/*.ts) or the Vercel build script reads
// must be written down in README.md, deployment.md or packages/server/.env.example, so a reader who sets up a deployment
// is never surprised by a setting that no document names. A repository without that source skips the rule.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { repoRootOrNull, scriptDir } from './repoRoot.mjs'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist'])

/** @type {string} */
let ROOT
/** @type {Set<string> | null} */
let known = null // Set of repo-relative file paths (forward slashes), or null when git is unavailable
const gitRoot = repoRootOrNull(import.meta.url)
if (gitRoot) {
  ROOT = gitRoot
  /** @param {...string} args */
  const ls = (...args) => execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean)
  const all = [...new Set([...ls(), ...ls('--others', '--exclude-standard')])]
  // A tracked file deleted from disk is not a file any more.
  known = new Set(all.filter((f) => fs.existsSync(path.join(ROOT, f))))
} else {
  ROOT = path.resolve(scriptDir(import.meta.url), '..')
}

/**
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}

/** @param {string} rel */
const skipped = (rel) => rel.split('/').some((seg) => SKIP_DIRS.has(seg))
const files = known
  ? [...known].filter((f) => f.endsWith('.md') && !skipped(f)).sort().map((f) => path.join(ROOT, f))
  : walk(ROOT)

// Does a link target exist? With git, only what a checkout holds counts: a file git knows, or a folder holding one.
/** @param {string} abs */
const toRel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/')
/** @type {Set<string> | null} */
let dirs = null
/** @param {string} abs */
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

/** @param {string} text */
const withoutFences = (text) => text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
/** @param {string} text */
const withoutCode = (text) => withoutFences(text).replace(/(`+)[^`]*?\1/g, '')

// GitHub's id for a heading.
/** @param {string} raw */
function slugOf(raw) {
  const t = raw.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[`*~]/g, '').trim().toLowerCase()
  return t.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\s-]/gu, '').replace(/\s/g, '-')
}

/** @type {Map<string, Set<string>>} */
const anchorCache = new Map()
/** @param {string} abs */
function anchorsOf(abs) {
  let set = anchorCache.get(abs)
  if (set) return set
  set = new Set(['top'])
  const text = withoutFences(fs.readFileSync(abs, 'utf8'))
  const seen = new Map()
  for (const m of text.matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/gm)) {
    const base = slugOf(m[1] ?? '')
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    set.add(n === 0 ? base : `${base}-${n}`)
  }
  for (const m of text.matchAll(/<a\s[^>]*?\b(?:name|id)\s*=\s*["']([^"']+)["']/gi)) set.add((m[1] ?? '').toLowerCase())
  anchorCache.set(abs, set)
  return set
}

// The target of each inline link: after "](", up to the first space, or the ")" that closes it (parentheses inside the
// target may nest), or the ">" when it starts with "<".
/** @param {string} text */
function inlineTargets(text) {
  /** @type {string[]} */
  const out = []
  for (let i = text.indexOf(']('); i !== -1; i = text.indexOf('](', i + 2)) {
    let j = i + 2
    while (text[j] === ' ') j++
    if (text[j] === '<') {
      const end = text.indexOf('>', j)
      if (end !== -1 && !text.slice(j, end).includes('\n')) out.push(text.slice(j + 1, end))
      continue
    }
    let depth = 0
    let k = j
    for (; k < text.length; k++) {
      const c = text[k] ?? ''
      if (c === '(') depth++
      else if (c === ')') { if (depth === 0) break; depth-- } else if (/\s/.test(c)) break
    }
    if (k > j) out.push(text.slice(j, k))
  }
  return out
}

/** @param {string} text */
function targetsOf(text) {
  const out = inlineTargets(text)
  for (const m of text.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]+>|\S+)/gm)) out.push((m[1] ?? '').replace(/^<|>$/g, ''))
  for (const m of text.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) out.push(m[1] ?? m[2] ?? '')
  return out
}

/** @param {string} s */
const decode = (s) => { try { return decodeURIComponent(s) } catch { return s } }

/** @type {string[]} */
const problems = []
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  for (const target of targetsOf(withoutCode(text))) {
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue
    const hash = target.indexOf('#')
    const pathPart = decode((hash === -1 ? target : target.slice(0, hash)).split('?')[0] ?? '')
    const fragment = hash === -1 ? '' : decode(target.slice(hash + 1))
    const abs = pathPart === '' ? file : pathPart.startsWith('/') ? path.join(ROOT, pathPart) : path.resolve(path.dirname(file), pathPart)
    if (pathPart !== '' && !exists(abs)) {
      problems.push(`${path.relative(ROOT, file)}: broken link ${target}`)
      continue
    }
    if (fragment && abs.endsWith('.md') && fs.existsSync(abs) && fs.statSync(abs).isFile() && !anchorsOf(abs).has(fragment.toLowerCase())) {
      problems.push(`${path.relative(ROOT, file)}: broken anchor ${target}`)
    }
  }
}

// ---- environment variables the code reads must be documented
// Variables that are read but deliberately not described for a reader (internal switches). Keep this short; say why.
const INTERNAL_ENV = new Set(/** @type {string[]} */ ([]))
const ENV_READS = [
  /\b(?:process\.env|env)\.([A-Z][A-Z0-9_]*)\b/g,                 // process.env.NAME, env.NAME
  /\benv\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,                    // env['NAME']
  /\b(?:need|get)\(\s*(?:\w+\s*,\s*)?['"]([A-Z][A-Z0-9_]+)['"]/g, // need('NAME'), need(env, 'NAME')
  /\bconst\s+\w*ENV\w*\s*=\s*['"]([A-Z][A-Z0-9_]+)['"]/g,         // const UNSAFE_ROLE_ENV = 'NAME'
]
/** @param {string} rel */
const inRepo = (rel) => (known ? known.has(rel) : fs.existsSync(path.join(ROOT, rel)))
const serverSources = known
  ? [...known].filter((f) => /^packages\/server\/src\/[^/]+\.ts$/.test(f))
  : fs.existsSync(path.join(ROOT, 'packages/server/src')) ? fs.readdirSync(path.join(ROOT, 'packages/server/src')).filter((f) => f.endsWith('.ts')).map((f) => `packages/server/src/${f}`) : []
const envSources = [...serverSources, ...(inRepo('scripts/vercel_build.mjs') ? ['scripts/vercel_build.mjs'] : [])].sort()
if (serverSources.length) {
  const docText = ['README.md', 'deployment.md', 'packages/server/.env.example']
    .filter(inRepo)
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n')
  /** @type {Map<string, string>} variable -> the first file that reads it */
  const reads = new Map()
  for (const rel of envSources) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    for (const re of ENV_READS) for (const m of text.matchAll(re)) if (m[1] && !reads.has(m[1])) reads.set(m[1], rel)
  }
  for (const [name, rel] of [...reads].sort()) {
    if (INTERNAL_ENV.has(name)) continue
    if (!new RegExp(`(?<![A-Z0-9_])${name}(?![A-Z0-9_])`).test(docText)) {
      problems.push(`${rel}: reads the environment variable ${name}, which README.md, deployment.md and packages/server/.env.example never mention`)
    }
  }
}

if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'))
  process.exit(1)
}
console.log(`check_docs: ok (${files.length} Markdown files)`)
