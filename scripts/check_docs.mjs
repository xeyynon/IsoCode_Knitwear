#!/usr/bin/env node
// Every relative link in the Markdown files must resolve.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist'])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}

const LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const problems = []
const files = walk(ROOT)
for (const file of files) {
  // Ignore fenced code so examples are not treated as links.
  const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '')
  for (const m of text.matchAll(LINK)) {
    const target = m[1]
    if (/^(https?:|mailto:|#)/i.test(target)) continue
    const rel = decodeURIComponent(target.split('#')[0])
    if (!rel) continue
    if (!fs.existsSync(path.resolve(path.dirname(file), rel))) {
      problems.push(`${path.relative(ROOT, file)}: broken link ${target}`)
    }
  }
}

if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join('\n'))
  process.exit(1)
}
console.log(`check_docs: ok (${files.length} Markdown files)`)
