#!/usr/bin/env node
// Refuses commits that would leak something. Runs locally and in CI.
//   - tracked files that must stay local (.env, logs, recordings, real data)
//   - anything shaped like a key or a private key
//   - commit titles with "(Build N)"
//   - tags that break the scheme (build-N below 1000, build tag with no report)
//   - names listed in BANNED_TERMS (comma separated; kept OUTSIDE the repo)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

const FORBIDDEN_PATHS = [
  /(^|\/)\.env(\..+)?$/, /(^|\/)local_config\./, /\.log$/, /(^|\/)node_modules\//,
  /(^|\/)data\//, /(^|\/)recordings\//, /\.(pem|key|p12)$/,
]
const ALLOWED_PATHS = [/\.env\.example$/]
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'API key (sk-)'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
]
const TEXT = /\.(md|mjs|js|jsx|ts|tsx|json|css|html|yml|yaml|sql|txt|toml|env\.example)$/i

const problems = []
const banned = (process.env.BANNED_TERMS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
// Tracked files AND new files not yet added (but not ignored): a secret must be caught before git sees it.
const tracked = [...new Set([...git('ls-files').split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')])].filter(Boolean)

for (const f of tracked) {
  if (FORBIDDEN_PATHS.some((re) => re.test(f)) && !ALLOWED_PATHS.some((re) => re.test(f))) problems.push(`${f}: must not be tracked`)
  if (banned.some((b) => f.toLowerCase().includes(b))) problems.push(`${f}: file name contains a banned term`)
  if (!TEXT.test(f)) continue
  const abs = path.join(ROOT, f)
  if (!fs.existsSync(abs)) continue
  const text = fs.readFileSync(abs, 'utf8')
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) problems.push(`${f}: looks like a ${label}`)
  const lower = text.toLowerCase()
  for (const b of banned) if (lower.includes(b)) problems.push(`${f}: contains a banned term`)
}

let titles = []
try { titles = git('log', '--format=%H%x09%s%x09%B%x00').split('\0').filter((s) => s.trim()) } catch { /* no commits yet */ }
for (const entry of titles) {
  const [hash, title, ...rest] = entry.trim().split('\t')
  if (/\(Build \d+\)/i.test(title)) problems.push(`commit ${hash.slice(0, 7)}: title has "(Build N)"`)
  const body = `${title} ${rest.join(' ')}`.toLowerCase()
  for (const b of banned) if (body.includes(b)) problems.push(`commit ${hash.slice(0, 7)}: message contains a banned term`)
  if (/co-authored-by:|generated (by|with)/i.test(body)) problems.push(`commit ${hash.slice(0, 7)}: has an attribution line`)
}

for (const t of git('tag', '--list').split('\n').filter(Boolean)) {
  const b = /^build-(\d+)$/.exec(t)
  if (b) {
    if (Number(b[1]) < 1000) problems.push(`tag ${t}: builds start at 1000`)
    if (!fs.existsSync(path.join(ROOT, 'md', 'builds', `${t}.md`))) problems.push(`tag ${t}: no report md/builds/${t}.md`)
  } else if (!/^InBul\d{2,}$/.test(t)) problems.push(`tag ${t}: not build-N or InBulNN`)
}

if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'))
  process.exit(1)
}
console.log(`check_repo: ok (${tracked.length} tracked files${banned.length ? ', banned terms checked' : ', no BANNED_TERMS set'})`)
