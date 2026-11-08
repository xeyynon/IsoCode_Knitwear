#!/usr/bin/env node
// Refuses commits that would leak something. Runs locally and in CI.
//   - tracked files that must stay local (.env, logs, recordings, photos, real data, the private md/ folder)
//   - anything shaped like a key or a private key
//   - this project's own secrets: a database URL with a password, TOKEN_SECRET=..., S3_SECRET_ACCESS_KEY=..., a signed token
//   - commit titles with "(Build N)"
//   - tags that break the scheme (build-N below 1000, build tag with no report)
//   - the same InBul id on two commits (scripts/inbul.mjs holds the short list of legacy exceptions)
//   - a build report that still holds placeholder text. A report whose build tag exists FAILS (nothing in the history has
//     one, and a tag is never moved, so the fix is to write the report and regenerate). A report with no tag yet only
//     WARNS: that is a build still being written, and changelog.mjs --tag and release.yml refuse it later.
//   - names listed in BANNED_TERMS (comma separated; kept OUTSIDE the repo). With REQUIRE_BANNED_TERMS=1 an empty list is a
//     failure (CI sets it where the secret is available); on GitHub Actions an empty list that is not required prints a warning.
//
// Acts on the repository that holds this script, whatever the folder it was started from.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { placeholdersIn } from './buildInfo.mjs'
import { commitTitles, findDuplicateInbuls } from './inbul.mjs'
import { repoRoot } from './repoRoot.mjs'

const ROOT = repoRoot(import.meta.url, 'check_repo')
// core.quotepath=false and -z: git otherwise writes a non-ASCII name as "caf\303\251.txt" in quotes, which matches no
// path rule and names no file on disk, so such a file was neither path-checked nor read (BE-048).
/** @param {...string} a */
const gitRaw = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
/** @param {...string} a */
const git = (...a) => gitRaw(...a).trim()
/** @param {...string} a */
const lsFiles = (...a) => gitRaw('ls-files', '-z', ...a).split('\0').filter(Boolean)

const FORBIDDEN_PATHS = [
  /(^|\/)\.env(\..+)?$/, /(^|\/)local_config\./, /\.log$/, /(^|\/)node_modules\//,
  /(^|\/)data\//, /(^|\/)recordings\//, /(^|\/)(media|uploads)\//, /\.(pem|key|p12)$/,
  // .gitignore keeps these two private (budget, rates, pilot plans); a forced add must not get past this guard either.
  /^md\//, /^company-a-build-plan\.md$/,
]
const ALLOWED_PATHS = [/\.env\.example$/]
/** @type {[RegExp, string][]} */
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'API key (sk-)'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\bnpm_[A-Za-z0-9]{36}\b/, 'npm token'],
  [/\bgithub_pat_[A-Za-z0-9_]{22,}\b/, 'GitHub token'],
  [/\b[sr]k_(live|test)_[A-Za-z0-9]{16,}\b/, 'API key (sk_live_/sk_test_)'],
]

// This project's own secrets (BE-049). Placeholders must pass: CHANGE_ME in .env.example, postgres:postgres in CI, the
// fake values in tests. A value is a placeholder when it is a well-known filler word, equals its own user name, holds a
// template marker (${..}, <..>, ...), or has a whole word such as test or fake in it.
const FILLER = new Set(['postgres', 'password', 'passwd', 'secret', 'changeme', 'pass', 'p', 'x', 'xx', 'xxx', 'hunter2', 'redacted'])
/**
 * @param {string} value
 * @param {string} [user]
 */
function isPlaceholder(value, user = '') {
  const v = value.trim()
  return FILLER.has(v.toLowerCase()) || (user !== '' && v === user)
    || /^[*.x_-]+$/i.test(v) || /CHANGE_?ME/i.test(v) || /\$\{|\$\(|<[^>]*>|\{\{|%[sd]|\.\.\./.test(v)
    || /(?:^|[_-])(?:test|fake|dummy|example|sample|placeholder|changeme|redacted)(?:$|[_-])/i.test(v)
    || /^(?:process|env|import)\./.test(v)
}
const DB_URL = /\bpostgres(?:ql)?:\/\/([^\s:@/'"`<>]+):([^\s@/'"`]+)@/g
// NAME=value or NAME: value where NAME is shouted and ends like a secret; the value must look generated (8+ characters
// and a digit), so a word or code such as process.env.X is not mistaken for one.
const NAMED_SECRET = /\b[A-Z][A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY)[ \t]*[:=][ \t]*["']?([A-Za-z0-9/+_=.-]{8,})/g
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./
/** @param {string} text */
function projectSecrets(text) {
  /** @type {string[]} */
  const found = []
  for (const m of text.matchAll(DB_URL)) if (!isPlaceholder(m[2] ?? '', m[1])) { found.push('database URL with a password'); break }
  for (const m of text.matchAll(NAMED_SECRET)) if (/\d/.test(m[1] ?? '') && !isPlaceholder(m[1] ?? '')) { found.push('password, secret or token value'); break }
  if (JWT.test(text)) found.push('signed token (JWT)')
  return found
}

// Every file is read unless it looks binary (a NUL byte in its first 8 KB): .npmrc, .sh, .ps1 and
// extension-less files can hold keys too.
/** @param {Buffer} buf */
const isBinary = (buf) => buf.subarray(0, 8192).includes(0)

// A real attribution line, not a sentence that happens to say "generated by": a Co-Authored-By trailer, or the
// signature an assistant tool appends ("Generated with [Claude Code](...)", optionally after an emoji). Each must
// start its line, so "the report is generated by the engine" in a body is fine.
const ASSISTANTS = 'claude|anthropic|copilot|cursor|codex|chatgpt|openai|gemini|aider|windsurf|cline|devin|cody'
const ATTRIBUTION = new RegExp(
  String.raw`^[ \t]*co-authored-by:[ \t]*\S|^[ \t]*(?:[^\p{L}\p{N}\s]+[ \t]*)?generated (?:with|by)[ \t]+\[?(?:${ASSISTANTS})\b`,
  'imu',
)
/** @param {string} message */
const hasAttribution = (message) => ATTRIBUTION.test(message)

/** @type {string[]} */
const problems = []
const banned = (process.env.BANNED_TERMS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const requireBanned = /^(1|true|yes)$/i.test((process.env.REQUIRE_BANNED_TERMS || '').trim())
if (requireBanned && !banned.length) {
  problems.push('BANNED_TERMS is empty but REQUIRE_BANNED_TERMS is set, so the banned-terms guard would be off. Set the BANNED_TERMS secret for this run (it is not passed to pull requests from forks or from Dependabot).')
}
// Tracked files AND new files not yet added (but not ignored): a secret must be caught before git sees it.
const tracked = [...new Set([...lsFiles(), ...lsFiles('--others', '--exclude-standard')])]

for (const f of tracked) {
  if (FORBIDDEN_PATHS.some((re) => re.test(f)) && !ALLOWED_PATHS.some((re) => re.test(f))) problems.push(`${f}: must not be tracked`)
  if (banned.some((b) => f.toLowerCase().includes(b))) problems.push(`${f}: file name contains a banned term`)
  const abs = path.join(ROOT, f)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
  const buf = fs.readFileSync(abs)
  if (isBinary(buf)) continue
  const text = buf.toString('utf8')
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) problems.push(`${f}: looks like a ${label}`)
  for (const label of projectSecrets(text)) problems.push(`${f}: looks like a ${label}`)
  const lower = text.toLowerCase()
  for (const b of banned) if (lower.includes(b)) problems.push(`${f}: contains a banned term`)
}

/** @type {string[]} */
let titles = []
try { titles = git('log', '--format=%H%x09%s%x09%B%x00').split('\0').filter((s) => s.trim()) } catch { /* no commits yet */ }
for (const entry of titles) {
  const [hash = '', title = '', ...rest] = entry.trim().split('\t')
  if (/\(Build \d+\)/i.test(title)) problems.push(`commit ${hash.slice(0, 7)}: title has "(Build N)"`)
  const body = `${title} ${rest.join(' ')}`.toLowerCase()
  for (const b of banned) if (body.includes(b)) problems.push(`commit ${hash.slice(0, 7)}: message contains a banned term`)
  if (hasAttribution(`${title}\n${rest.join('\t')}`)) problems.push(`commit ${hash.slice(0, 7)}: has an attribution line`)
}

const tagNames = git('tag', '--list').split('\n').filter(Boolean)
/**
 * Is the tagged commit part of this checkout's history? A tag from another branch (a release that has not been merged here yet)
 * has its report on that branch, not on this one, and must not fail this one (BE-063). Only a definite "no" (exit status 1)
 * skips the check: when git cannot tell (a shallow clone, an error) the tag is treated as reachable, the strict way.
 */
const inHistory = (tag) => spawnSync('git', ['merge-base', '--is-ancestor', `refs/tags/${tag}`, 'HEAD'], { cwd: ROOT, stdio: 'ignore' }).status !== 1
for (const t of tagNames) {
  const b = /^build-(\d+)$/.exec(t)
  if (b) {
    if (Number(b[1]) < 1000) problems.push(`tag ${t}: builds start at 1000`)
    if (inHistory(t) && !fs.existsSync(path.join(ROOT, 'docs', 'builds', `${t}.md`))) problems.push(`tag ${t}: no report docs/builds/${t}.md`)
  } else if (!/^InBul\d{2,}$/.test(t)) problems.push(`tag ${t}: not build-N or InBulNN`)
}

// A build report that still holds placeholder text (BE-050). Tagged: a failure. Not tagged yet: a warning only.
const reportsDir = path.join(ROOT, 'docs', 'builds')
if (fs.existsSync(reportsDir)) {
  for (const f of fs.readdirSync(reportsDir).filter((n) => /^build-\d+\.md$/.test(n)).sort()) {
    const left = placeholdersIn(fs.readFileSync(path.join(reportsDir, f), 'utf8'))
    if (!left.length) continue
    const name = f.replace(/\.md$/, '')
    if (tagNames.includes(name)) problems.push(`tag ${name}: the report docs/builds/${f} still holds placeholder text ${left.map((p) => JSON.stringify(p)).join(', ')}`)
    else console.warn(`warning: docs/builds/${f} is not tagged yet and still holds placeholder text; write it before the tag (changelog.mjs --tag refuses it).`)
  }
}

// One InBul id on two commits (BE-053). History cannot be rewritten, so the ones that already happened are listed in inbul.mjs.
for (const d of findDuplicateInbuls(commitTitles(ROOT))) {
  problems.push(`${d.id} is the title of ${d.hashes.length} commits (${d.hashes.map((h) => h.slice(0, 7)).join(', ')}); take the next free id with changelog.mjs --next-internal`)
}

if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'))
  process.exit(1)
}
if (!banned.length && process.env.GITHUB_ACTIONS === 'true') {
  console.log('::warning::BANNED_TERMS is not set for this run, so the banned-terms guard did not run (secrets are not passed to pull requests from forks or from Dependabot). It runs on pushes to main and on tags.')
}
console.log(`check_repo: ok (${tracked.length} tracked files${banned.length ? ', banned terms checked' : ', no BANNED_TERMS set'})`)
