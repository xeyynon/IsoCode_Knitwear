// Compares two sets of screenshots and says which pictures changed (UI/UX plan, slice 0.9). Reads only; nothing is written or deleted.
//
//   npm run diff                          the current uiux/2.0 against the newest set kept in uiux/2.0/previous (else against uiux/1.0)
//   npm run diff -- <before> <after>      any two folders of PNGs
//   npm run diff -- --tolerance 8         ignore a colour difference of up to 8 in any channel (default 0: exact)
//
// Exit code 1 when any picture differs, so a script can use it to prove that a refactor changed nothing visible.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { changesMarkdown, diffSets } from './pngDiff'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const tolAt = args.indexOf('--tolerance')
const tolerance = tolAt >= 0 ? Number(args[tolAt + 1]) : 0
const valueAt = tolAt >= 0 ? tolAt + 1 : -1   // the number after --tolerance is not a folder
const folders = args.filter((a, i) => !a.startsWith('--') && i !== valueAt)

function newestPrevious(): string | null {
  const dir = path.join(ROOT, 'uiux', '2.0', 'previous')
  if (!fs.existsSync(dir)) return null
  const sets = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort()
  return sets.length ? path.join(dir, sets[sets.length - 1]!) : null
}

const after = path.resolve(folders[1] ?? path.join(ROOT, 'uiux', '2.0'))
const before = path.resolve(folders[0] ?? newestPrevious() ?? path.join(ROOT, 'uiux', '1.0'))
if (!fs.existsSync(before) || !fs.existsSync(after)) { console.error(`A folder is missing:\n  before: ${before}\n  after:  ${after}`); process.exit(2) }

const rows = diffSets(before, after, tolerance)
console.log(changesMarkdown(rows, path.relative(ROOT, before) || before, path.relative(ROOT, after) || after))
process.exit(rows.some((r) => r.status !== 'same') ? 1 : 0)
