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
// The tag is the source of truth for a number. Numbers come from the tags, so
// run this just before committing: another session may have taken the id.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { publicBuilds } from './buildInfo.mjs'

const FIRST_BUILD = 1000
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
// Build reports are public-safe by design (what changed, not budget or client detail), so they live
// in docs/builds, which is tracked. The internal md/ folder stays private (DEC-013).
const REPORTS = path.join(ROOT, 'docs', 'builds')
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md')
const BUILD_INFO = path.join(ROOT, 'build-info.json')
const BOOKKEEPING = [/^docs\/builds\//, /^CHANGELOG\.md$/, /^build-info\.json$/]
// Text that looks like a real secret (a key, a token or a password value). --pending refuses it before
// anything is written, because the report, CHANGELOG.md and build-info.json are all public. Plain words
// such as "design tokens" or "rotate" pass.
const LOOKS_SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|\b(?:password|passwd|secret|token|api[-_ ]?key)\s*[:=]\s*\S{6,}/i
const MANUAL_START = '<!-- manual:start -->'
const MANUAL_END = '<!-- manual:end -->'

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const fail = (msg) => { console.error(`error: ${msg}`); process.exit(1) }

function tags() {
  const all = git('tag', '--list').split('\n').filter(Boolean)
  const builds = all.map((t) => /^build-(\d+)$/.exec(t)).filter(Boolean).map((m) => Number(m[1]))
  const internals = all.map((t) => /^InBul(\d{2,})$/.exec(t)).filter(Boolean).map((m) => Number(m[1]))
  return { all, builds, internals }
}
const nextBuild = () => { const { builds } = tags(); return builds.length ? Math.max(...builds) + 1 : FIRST_BUILD }
const nextInternal = () => {
  const { internals } = tags()
  return `InBul${String(internals.length ? Math.max(...internals) + 1 : 1).padStart(2, '0')}`
}

const today = () => new Date().toLocaleDateString('en-CA')
const reportPath = (n) => path.join(REPORTS, `build-${n}.md`)

function stagedFiles() {
  return git('diff', '--cached', '--name-only').split('\n').filter(Boolean)
    .filter((f) => !BOOKKEEPING.some((re) => re.test(f)))
}

const readReport = (file) => parseReport(fs.readFileSync(file, 'utf8'))

// The report as committed at HEAD, or null. The tag must not land on a commit without its report.
function committedReport(n) {
  try {
    return execFileSync('git', ['show', `HEAD:docs/builds/build-${n}.md`],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch { return null }
}

// One "## Name" section of a report, trimmed; '' when absent.
function sectionOf(text, name) {
  const m = new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |${MANUAL_END}|$(?![\\s\\S]))`, 'm').exec(text)
  return m ? m[1].trim() : ''
}

function parseReport(text) {
  const head = /^# Build (\d+): (.+)$/m.exec(text)
  if (!head) return null
  return {
    n: Number(head[1]),
    title: head[2].trim(),
    date: (/^Date: (.+)$/m.exec(text) || [])[1] || '',
    summary: sectionOf(text, 'What changed').split(/\n\s*\n/)[0],
    why: sectionOf(text, 'Why'),
  }
}

const PLACEHOLDER = {
  summary: '(write one or two plain sentences)',
  why: '(why this was done)',
  verified: '(how it was verified, honestly; say what was not checked)',
  next: '(what to improve next)',
}

// Writes the pending report. Running --pending again REPLACES the report with what was passed this time:
// the title and every text argument given win over what the file held, so a stale title can never survive
// (--tag compares the commit title with the report title). A part not passed this time is kept from the
// old report, unless it was still a placeholder. The file list is always rebuilt.
function writeReport(n, { title, summary, why, verified, next }) {
  fs.mkdirSync(REPORTS, { recursive: true })
  const file = reportPath(n)
  const files = stagedFiles()
  const filesBlock = `## Files changed\n\n${files.length ? files.map((f) => `- ${f}`).join('\n') : '- (none staged)'}\n`
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const prev = old ? parseReport(old) : null
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
    .map((f) => readReport(path.join(REPORTS, f))).filter(Boolean).sort((a, b) => b.n - a.n)
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
    latest: reports.length ? reports[0].n : null,
    builds: pub,
  }, null, 2) + '\n')
}

function tagHead() {
  const title = git('log', '-1', '--format=%s')
  const here = git('tag', '--points-at', 'HEAD').split('\n').filter((t) => /^(build-\d+|InBul\d+)$/.test(t))
  if (here.length) fail(`HEAD is already tagged ${here.join(', ')}. Tags are never moved.`)
  if (/\(Build \d+\)/i.test(title)) fail('commit title contains "(Build N)". The tag carries the number.')
  const inbul = /^(InBul\d{2,}): /.exec(title)
  if (inbul) {
    if (tags().all.includes(inbul[1])) fail(`${inbul[1]} already exists. Take the next id: --next-internal`)
    if (inbul[1] !== nextInternal()) console.warn(`warning: expected ${nextInternal()}, tagging ${inbul[1]}`)
    git('tag', inbul[1])
    return console.log(`tagged ${inbul[1]}`)
  }
  const n = nextBuild()
  const text = committedReport(n)
  if (text === null) fail(`HEAD has no docs/builds/build-${n}.md. Run --pending, commit the report with git add docs/builds, or title an InBul "InBulNN: ...".`)
  const report = parseReport(text)
  if (!report || report.title !== title) fail(`commit title does not match the report title ("${report ? report.title : '?'}").`)
  git('tag', `build-${n}`)
  console.log(`tagged build-${n}`)
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    pending: { type: 'boolean' }, tag: { type: 'boolean' }, regenerate: { type: 'boolean' }, status: { type: 'boolean' },
    'next-build': { type: 'boolean' }, 'next-internal': { type: 'boolean' },
    why: { type: 'string' }, verified: { type: 'string' }, next: { type: 'string' },
  },
})

if (values['next-build']) console.log(nextBuild())
else if (values['next-internal']) console.log(nextInternal())
else if (values.status) {
  console.log(`next build:  build-${nextBuild()}\nnext InBul:  ${nextInternal()}\nstaged:      ${stagedFiles().length} file(s)`)
} else if (values.pending) {
  const [title, summary] = positionals
  if (!title) fail('usage: --pending "<title>" "<summary>" --why .. --verified .. --next ..')
  if (/\(Build \d+\)/i.test(title)) fail('no "(Build N)" in titles.')
  if ([title, summary, values.why, values.verified, values.next].some((t) => t && LOOKS_SECRET.test(t))) {
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
