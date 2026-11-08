#!/usr/bin/env node
// Bookkeeping for builds and InBuls. See the versioning notes in the internal docs (md/version_control.md, kept private).
//
//   node scripts/changelog.mjs --next-build          print the next build number
//   node scripts/changelog.mjs --next-internal       print the next InBul id
//   node scripts/changelog.mjs --status              print the next ids and what is staged
//   node scripts/changelog.mjs --pending "<title>" "<summary>" --why .. --verified .. --next ..
//                                                    write docs/builds/build-N.md, CHANGELOG.md, build-info.json
//   node scripts/changelog.mjs --regenerate         rebuild CHANGELOG.md and build-info.json from docs/builds (no new build)
//   node scripts/changelog.mjs --tag                 pin the tag on HEAD (changes no files)
//
// The tag is the source of truth for a number, but a tag exists only in the clones that hold it, so the next InBul id is
// the highest one in any tag OR any commit title on ANY branch (scripts/inbul.mjs): another session may have taken the id
// without tagging it yet. Run this just before committing.
//
// It acts on the repository that holds this script, not the folder it was started from. --tag refuses a build whose
// report still holds placeholder text (the report is the public release note), and an InBul id another commit already uses.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PLACEHOLDER, placeholdersIn, publicBuilds } from './buildInfo.mjs'
import { commitTitles, inbulNumberOfTitle, nextInbul } from './inbul.mjs'
import { repoRoot } from './repoRoot.mjs'

const FIRST_BUILD = 1000
const ROOT = repoRoot(import.meta.url, 'changelog')
// Build reports are public-safe by design (what changed, not budget or client detail), so they live
// in docs/builds, which is tracked. The internal md/ folder stays private (DEC-013).
const REPORTS = path.join(ROOT, 'docs', 'builds')
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md')
const BUILD_INFO = path.join(ROOT, 'build-info.json')
const BOOKKEEPING = [/^docs\/builds\//, /^CHANGELOG\.md$/, /^build-info\.json$/]
const MANUAL_START = '<!-- manual:start -->'
const MANUAL_END = '<!-- manual:end -->'

// Text that looks like a real secret (a key, a token or a password value). --pending refuses it before anything is
// written, because the report, CHANGELOG.md and build-info.json are all public. Plain words such as "design tokens"
// or "rotate" pass, and so does ordinary prose that uses the words ("the buyer token: cancelled links stop working"):
// after "password:", "token=" and the like, only a value that looks generated counts (see valueLooksGenerated).
const KEY_SHAPES = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./i
const ASSIGNED = /\b(?:password|passwd|secret|token|api[-_ ]?key)\s*[:=]\s*["']?([^\s"']+)/gi
/**
 * 8+ characters and a digit, or mixed case inside the word. A plain English word ("cancelled", "refused") is not a secret.
 * @param {string} raw
 */
function valueLooksGenerated(raw) {
  const v = raw.replace(/[.,;:)\]]+$/, '')
  if (v.length < 8 || /^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  return /\d/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v.slice(1)))
}
/** @param {string} text */
const looksSecret = (text) => KEY_SHAPES.test(text) || [...text.matchAll(ASSIGNED)].some((m) => valueLooksGenerated(m[1] ?? ''))

// core.quotepath=false and -z: git writes a non-ASCII file name as "\340\256..." in quotes otherwise (BE-058).
/** @param {...string} args */
const gitRaw = (...args) => execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
/** @param {...string} args */
const git = (...args) => gitRaw(...args).trim()
/**
 * The first line of what went wrong: git's own message for a failed git call, otherwise the error's message.
 * @param {unknown} e
 */
function firstLine(e) {
  const err = /** @type {{ stderr?: unknown, message?: unknown }} */ (e ?? {})
  const text = String(err.stderr || err.message || e)
  return text.split('\n').find((l) => l.trim()) ?? 'unexpected error'
}

/**
 * @param {string} msg
 * @returns {never}
 */
function fail(msg) { console.error(`error: ${msg}`); process.exit(1) }

function tags() {
  const all = git('tag', '--list').split('\n').filter(Boolean)
  const builds = all.flatMap((t) => { const m = /^build-(\d+)$/.exec(t); return m ? [Number(m[1])] : [] })
  return { all, builds }
}
const nextBuild = () => { const { builds } = tags(); return builds.length ? Math.max(...builds) + 1 : FIRST_BUILD }
const nextInternal = (entries = commitTitles(ROOT)) => nextInbul(tags().all, entries)

const today = () => new Date().toLocaleDateString('en-CA')
/** @param {number} n */
const reportPath = (n) => path.join(REPORTS, `build-${n}.md`)

function stagedFiles() {
  return gitRaw('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean)
    .filter((f) => !BOOKKEEPING.some((re) => re.test(f)))
}

/** @param {string} file */
const readReport = (file) => parseReport(fs.readFileSync(file, 'utf8'))

// The report as committed at HEAD, or null. The tag must not land on a commit without its report.
/**
 * @param {number} n
 * @returns {string | null}
 */
function committedReport(n) {
  try {
    return execFileSync('git', ['show', `HEAD:docs/builds/build-${n}.md`],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch { return null }
}

// One "## Name" section of a report, trimmed; '' when absent.
/**
 * @param {string} text
 * @param {string} name
 */
function sectionOf(text, name) {
  const m = new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |${MANUAL_END}|$(?![\\s\\S]))`, 'm').exec(text)
  return m ? (m[1] ?? '').trim() : ''
}

/**
 * @typedef {{ n: number, title: string, date: string, summary: string, why: string }} Report
 * @param {string} text
 * @returns {Report | null}
 */
function parseReport(text) {
  const head = /^# Build (\d+): (.+)$/m.exec(text)
  if (!head) return null
  return {
    n: Number(head[1]),
    title: (head[2] ?? '').trim(),
    date: (/^Date: (.+)$/m.exec(text) || [])[1] || '',
    summary: sectionOf(text, 'What changed').split(/\n\s*\n/)[0] ?? '',
    why: sectionOf(text, 'Why'),
  }
}

// Writes the pending report. Running --pending again REPLACES the report with what was passed this time:
// the title and every text argument given win over what the file held, so a stale title can never survive
// (--tag compares the commit title with the report title). A part not passed this time is kept from the
// old report, unless it was still a placeholder. The file list is always rebuilt.
/**
 * @param {number} n
 * @param {{ title: string, summary?: string, why?: string, verified?: string, next?: string }} parts
 */
function writeReport(n, { title, summary, why, verified, next }) {
  fs.mkdirSync(REPORTS, { recursive: true })
  const file = reportPath(n)
  const files = stagedFiles()
  const filesBlock = `## Files changed\n\n${files.length ? files.map((f) => `- ${f}`).join('\n') : '- (none staged)'}\n`
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const prev = old ? parseReport(old) : null
  /**
   * @param {string | undefined} given
   * @param {'summary' | 'why' | 'verified' | 'next'} name
   * @param {string} heading
   */
  const keep = (given, name, heading) => {
    if (given) return given
    const was = old ? sectionOf(old, heading) : ''
    return was && was !== PLACEHOLDER[name] ? was : PLACEHOLDER[name]
  }
  if (prev && prev.title !== title) {
    console.warn(`warning: ${path.relative(ROOT, file)} had the title "${prev.title}"; replaced with "${title}".`)
  }
  const body = [
    `# Build ${n}: ${title}`,
    '',
    `Date: ${today()}`,
    `Tag: build-${n}`,
    '',
    MANUAL_START,
    '## What changed',
    '',
    keep(summary, 'summary', 'What changed'),
    '',
    '## Why',
    '',
    keep(why, 'why', 'Why'),
    '',
    '## How it was checked',
    '',
    keep(verified, 'verified', 'How it was checked'),
    '',
    '## Next improvement',
    '',
    keep(next, 'next', 'Next improvement'),
    MANUAL_END,
    '',
    filesBlock,
  ].join('\n')
  fs.writeFileSync(file, body)
  return file
}

function allReports() {
  if (!fs.existsSync(REPORTS)) return []
  return fs.readdirSync(REPORTS).filter((f) => /^build-\d+\.md$/.test(f))
    .flatMap((f) => { const r = readReport(path.join(REPORTS, f)); return r ? [r] : [] }).sort((a, b) => b.n - a.n)
}

function regenerate() {
  const reports = allReports()
  const lines = ['# Changelog', '', 'Generated by `scripts/changelog.mjs`. Do not edit by hand. Newest first.', '']
  for (const r of reports) {
    lines.push(`## Build ${r.n}: ${r.title}`, '', r.date, '', r.summary, '')
  }
  if (!reports.length) lines.push('No builds yet.', '')
  fs.writeFileSync(CHANGELOG, lines.join('\n'))

  const pub = publicBuilds(reports)
  fs.writeFileSync(BUILD_INFO, JSON.stringify({
    _note: 'Generated by scripts/changelog.mjs. Do not edit.',
    latest: reports[0]?.n ?? null,
    builds: pub,
  }, null, 2) + '\n')
}

function tagHead() {
  // GitHub's squash merge appends the pull request number to the title ("Title (#23)"); the report's title is the one without it.
  const title = git('log', '-1', '--format=%s').replace(/\s*\(#\d+\)$/, '')
  const here = git('tag', '--points-at', 'HEAD').split('\n').filter((t) => /^(build-\d+|InBul\d+)$/.test(t))
  if (here.length) fail(`HEAD is already tagged ${here.join(', ')}. Tags are never moved.`)
  if (/\(Build \d+\)/i.test(title)) fail('commit title contains "(Build N)". The tag carries the number.')
  const inbul = /^(InBul\d{2,}): /.exec(title)
  if (inbul) {
    const id = inbul[1] ?? ''
    if (tags().all.includes(id)) fail(`${id} already exists. Take the next id: --next-internal`)
    // The other commits on every branch: HEAD's own title would otherwise make the next id look one too high.
    const head = git('rev-parse', 'HEAD')
    const others = commitTitles(ROOT).filter((e) => e.hash !== head)
    const taken = others.filter((e) => inbulNumberOfTitle(e.title) === inbulNumberOfTitle(title))
    if (taken.length) fail(`${id} is already the title of another commit (${taken.map((e) => e.hash.slice(0, 7)).join(', ')}). Take the next id: --next-internal`)
    const expected = nextInbul(tags().all, others)
    if (id !== expected) console.warn(`warning: expected ${expected}, tagging ${id}`)
    git('tag', id)
    return console.log(`tagged ${id}`)
  }
  const n = nextBuild()
  const text = committedReport(n)
  if (text === null) fail(`HEAD has no docs/builds/build-${n}.md. Run --pending, commit the report with git add docs/builds, or title an InBul "InBulNN: ...".`)
  const report = parseReport(text)
  if (!report || report.title !== title) fail(`commit title does not match the report title ("${report ? report.title : '?'}").`)
  // The report is the public release note (CHANGELOG.md, the "What's new" dialog, the GitHub Release): never tag it unwritten.
  const left = placeholdersIn(text)
  if (left.length) fail(`docs/builds/build-${n}.md still holds placeholder text ${left.map((p) => JSON.stringify(p)).join(', ')}. Run --pending again with the summary, --why, --verified and --next, commit, then tag.`)
  git('tag', `build-${n}`)
  console.log(`tagged build-${n}`)
}

const OPTIONS = /** @type {const} */ ({
  pending: { type: 'boolean' }, tag: { type: 'boolean' }, regenerate: { type: 'boolean' }, status: { type: 'boolean' },
  'next-build': { type: 'boolean' }, 'next-internal': { type: 'boolean' },
  why: { type: 'string' }, verified: { type: 'string' }, next: { type: 'string' },
})
let parsed
try {
  parsed = parseArgs({ allowPositionals: true, options: OPTIONS })
} catch (e) {
  fail(`${firstLine(e)}. See the header of scripts/changelog.mjs for usage`)
}
const { values, positionals } = parsed

const MODES = /** @type {const} */ (['next-build', 'next-internal', 'status', 'pending', 'regenerate', 'tag'])
const chosen = MODES.filter((m) => values[m])
if (chosen.length > 1) fail(`use one of --${MODES.join(', --')} at a time (got --${chosen.join(' and --')})`)

try {
  if (values['next-build']) console.log(nextBuild())
  else if (values['next-internal']) console.log(nextInternal())
  else if (values.status) {
    console.log(`next build:  build-${nextBuild()}\nnext InBul:  ${nextInternal()}\nstaged:      ${stagedFiles().length} file(s)`)
  } else if (values.pending) {
    const [title, summary] = positionals
    if (!title) fail('usage: --pending "<title>" "<summary>" --why .. --verified .. --next ..')
    if (/\(Build \d+\)/i.test(title)) fail('no "(Build N)" in titles.')
    if ([title, summary, values.why, values.verified, values.next].some((t) => t && looksSecret(t))) {
      fail('the text looks like it holds a secret (a key, token or password value). Build reports are public.')
    }
    const n = nextBuild()
    const file = writeReport(n, { title, summary, why: values.why, verified: values.verified, next: values.next })
    regenerate()
    console.log(`wrote ${path.relative(ROOT, file)}, CHANGELOG.md and build-info.json for build-${n}`)
    console.log('next: git add docs/builds CHANGELOG.md build-info.json; git commit -m "<same title>"; node scripts/changelog.mjs --tag')
  } else if (values.regenerate) {
    regenerate()
    console.log('rewrote CHANGELOG.md and build-info.json from docs/builds')
  } else if (values.tag) tagHead()
  else fail('see the header of scripts/changelog.mjs for usage')
} catch (e) {
  // A git failure (for example a repository with no commits yet) is one plain line, not a stack trace.
  fail(firstLine(e))
}
