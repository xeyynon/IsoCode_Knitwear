#!/usr/bin/env node
// The bug log and the fix log must agree, and every fix must name a test that exists.
//
//   node scripts/check_bugs.mjs [folder]      (default: the repository that holds this script)
//
// bug.md      a table; each row starts "| BE-nnn |" and ends with the status (open, fixed or deferred).
// bugfixed.md one entry per fixed bug. An entry starts at a line that begins with the id (a heading "## BE-048 title", a list
//             item "- BE-048 ..." or "**BE-048**") and runs to the next such line. Inside it, any number of lines
//                 Test: <path from the repository root> :: <start of the test's name>
//             (the path and the name may be wrapped in backticks). Each is checked: the file exists and holds a test whose
//             title starts with that name, written as the start of a quoted string ('BE-048: ...', "...", or `...`), so a
//             comment that happens to repeat the words does not count.
//
// Fails when
//   - a Test line names a file that does not exist, or a name that is not in it;
//   - an id marked fixed in bug.md has no entry in bugfixed.md;
//   - an id in bugfixed.md is not in bug.md.
// A missing bugfixed.md is fine only while no row of bug.md is fixed. No bug.md and no bugfixed.md: nothing to check.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { repoRootOrNull, scriptDir } from './repoRoot.mjs'

const ID = /BE-\d{3,}/
/** @param {string} s */
const strip = (s) => s.trim().replace(/^`+|`+$/g, '').trim()

/**
 * [{ id, status }] from the rows of the bug table. The status is the last cell, first word, lower-case, without markup.
 * @param {string} text
 * @returns {{ id: string, status: string }[]}
 */
export function parseBugLog(text) {
  /** @type {{ id: string, status: string }[]} */
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\|\s*(BE-\d{3,})\s*\|/.exec(line)
    if (!m) continue
    const cells = line.split('|').map((c) => c.trim()).filter((c, i, all) => !(c === '' && (i === 0 || i === all.length - 1)))
    const last = cells[cells.length - 1] ?? ''
    rows.push({ id: m[1] ?? '', status: (/[A-Za-z]+/.exec(last.replace(/[`*_]/g, '')) ?? [''])[0].toLowerCase() })
  }
  return rows
}

/**
 * The entries of bugfixed.md.
 * @param {string} text
 * @returns {{ id: string, tests: { file: string, name: string }[] }[]}
 */
export function parseFixLog(text) {
  /** @type {{ id: string, tests: { file: string, name: string }[] }[]} */
  const entries = []
  /** @type {{ id: string, tests: { file: string, name: string }[] } | null} */
  let cur = null
  for (const line of text.split(/\r?\n/)) {
    const start = new RegExp(`^\\s*(?:#{1,6}\\s*|[-*+]\\s+)?\\**\\s*(${ID.source})\\b`).exec(line)
    if (start) { cur = { id: start[1] ?? '', tests: [] }; entries.push(cur); continue }
    const t = /^\s*(?:[-*+]\s+)?Test:\s*(.+?)\s*::\s*(.+?)\s*$/.exec(line)
    if (t && cur) cur.tests.push({ file: strip(t[1] ?? ''), name: strip(t[2] ?? '') })
  }
  return entries
}

/**
 * The problems found in a folder holding bug.md, bugfixed.md and the test files they name.
 * @param {string} root
 * @returns {{ problems: string[], fixed: number, entries: number }}
 */
export function checkBugs(root) {
  /** @type {string[]} */
  const problems = []
  const bugPath = path.join(root, 'bug.md')
  const fixPath = path.join(root, 'bugfixed.md')
  const hasBugs = fs.existsSync(bugPath)
  const hasFixes = fs.existsSync(fixPath)
  if (!hasBugs) {
    if (hasFixes) problems.push('bugfixed.md exists but bug.md does not')
    return { problems, fixed: 0, entries: 0 }
  }
  const bugs = parseBugLog(fs.readFileSync(bugPath, 'utf8'))
  const fixed = bugs.filter((b) => b.status === 'fixed')
  const entries = hasFixes ? parseFixLog(fs.readFileSync(fixPath, 'utf8')) : []
  if (!hasFixes && fixed.length) problems.push(`bugfixed.md does not exist, but bug.md marks ${fixed.map((b) => b.id).join(', ')} as fixed`)

  const known = new Set(bugs.map((b) => b.id))
  const entered = new Set(entries.map((e) => e.id))
  for (const b of fixed) if (hasFixes && !entered.has(b.id)) problems.push(`${b.id} is marked fixed in bug.md but has no entry in bugfixed.md`)
  for (const e of entries) if (!known.has(e.id)) problems.push(`${e.id} is in bugfixed.md but not in bug.md`)

  for (const e of entries) {
    for (const { file, name } of e.tests) {
      const abs = path.resolve(root, file)
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { problems.push(`${e.id}: the test file ${file} does not exist`); continue }
      const text = fs.readFileSync(abs, 'utf8')
      if (!['\'', '"', '`'].some((q) => text.includes(q + name))) problems.push(`${e.id}: the test "${name}" is not in ${file} (a test title must start with it)`)
    }
  }
  return { problems, fixed: fixed.length, entries: entries.length }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : (repoRootOrNull(import.meta.url) ?? path.resolve(scriptDir(import.meta.url), '..'))
  const { problems, fixed, entries } = checkBugs(root)
  if (problems.length) {
    console.error(problems.map((p) => `FAIL ${p}`).join('\n'))
    process.exit(1)
  }
  console.log(`check_bugs: ok (${fixed} fixed in bug.md, ${entries} entries in bugfixed.md)`)
}
