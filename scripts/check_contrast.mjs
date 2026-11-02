#!/usr/bin/env node
// Measures WCAG contrast for the colour pairs in packages/design/tokens.css.
// Text pairs need 4.5:1; marks (icons, borders, status shapes) need 3:1.
// Fails if a pair is under its threshold. Also reports how close red/amber/green
// are to each other, because status must never rely on colour alone.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'design', 'tokens.css'), 'utf8')
const vars = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]))

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// [foreground token, background token, minimum, what it is]
const PAIRS = [
  ['ink', 'surface', 4.5, 'body text'],
  ['ink', 'page', 4.5, 'body text on page'],
  ['muted', 'surface', 4.5, 'labels'],
  ['muted', 'page', 4.5, 'labels on page'],
  ['accent', 'surface', 4.5, 'buttons and links as text'],
  ['surface', 'accent', 4.5, 'white text on a button'],
  ['border', 'surface', 3, 'input borders'],
  ['status-red', 'surface', 3, 'red icon'],
  ['status-red-text', 'status-red-tint', 4.5, 'red row text'],
  ['status-amber', 'surface', 3, 'amber icon (mark only, never text)'],
  ['status-amber-text', 'status-amber-tint', 4.5, 'amber badge text'],
  ['status-green', 'surface', 3, 'green icon'],
  ['status-grey', 'surface', 4.5, 'grey badge text'],
]

let bad = 0
for (const [fg, bg, min, what] of PAIRS) {
  if (!vars[fg] || !vars[bg]) { console.error(`FAIL missing token ${!vars[fg] ? fg : bg}`); bad++; continue }
  const r = ratio(vars[fg], vars[bg])
  const ok = r >= min
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1 (min ${min})  ${fg} on ${bg}  ${what}`)
}

const sep = [['status-red', 'status-amber'], ['status-amber', 'status-green'], ['status-red', 'status-green']]
console.log('\nSeparation between status marks (near 1:1 means they merge in greyscale; icon + word are required):')
for (const [a, b] of sep) console.log(`     ${ratio(vars[a], vars[b]).toFixed(2).padStart(5)}:1  ${a} vs ${b}`)

if (bad) { console.error(`\ncheck_contrast: ${bad} pair(s) failed`); process.exit(1) }
console.log('\ncheck_contrast: ok')
