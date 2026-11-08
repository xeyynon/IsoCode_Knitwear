// InBul ids (internal builds): reading them from tags AND from commit titles on every ref (BE-053).
//
// A tag is the source of truth for a number, but a tag exists only in the clones that hold it, and two sessions
// working at once can take the same id before either has tagged. So the next id is the highest one seen in any
// tag or any commit title on any branch, and one id used by two commits is an error.
import { execFileSync } from 'node:child_process'

/** @typedef {{ hash: string, title: string }} CommitTitle */

/**
 * Commits that already share an InBul id (found by the re-audit; the history cannot be changed and tags are never
 * moved). Each id lists the commits allowed to share it, by the start of their hash. A third commit with the same
 * id, or any other id used twice, is still an error.
 * @type {Record<string, string[]>}
 */
export const LEGACY_DUPLICATES = {
  InBul17: ['d77dc1f', 'd85a545'],
  InBul18: ['3f085a7', '4d7999a'],
  InBul21: ['f40c758', 'aee6d6e'],   // the UI session's and the README pull request's, numbered at the same time
}

/**
 * "InBul17: something" gives 17; any other title gives null.
 * @param {string} title
 * @returns {number | null}
 */
export function inbulNumberOfTitle(title) {
  const m = /^InBul(\d+):/.exec(title)
  return m ? Number(m[1]) : null
}

/** @param {number} n */
export const inbulName = (n) => `InBul${String(n).padStart(2, '0')}`

/**
 * Every commit on every ref. Empty in a repository with no commits yet.
 * @param {string} cwd
 * @returns {CommitTitle[]}
 */
export function commitTitles(cwd) {
  try {
    return execFileSync('git', ['log', '--all', '--format=%H%x09%s'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter(Boolean).map((l) => { const i = l.indexOf('\t'); return { hash: l.slice(0, i), title: l.slice(i + 1) } })
  } catch { return [] }
}

/**
 * The next free id: the highest in any tag name or commit title, plus one (InBul01 in an empty history).
 * @param {string[]} tagNames
 * @param {CommitTitle[]} entries
 */
export function nextInbul(tagNames, entries) {
  /** @type {number[]} */
  const seen = []
  for (const t of tagNames) { const m = /^InBul(\d{2,})$/.exec(t); if (m) seen.push(Number(m[1])) }
  for (const e of entries) { const n = inbulNumberOfTitle(e.title); if (n !== null) seen.push(n) }
  return inbulName(seen.length ? Math.max(...seen) + 1 : 1)
}

/**
 * Ids used by more than one commit, minus the legacy ones.
 * @param {CommitTitle[]} entries
 * @param {Record<string, string[]>} [legacy]
 * @returns {{ id: string, hashes: string[] }[]}
 */
export function findDuplicateInbuls(entries, legacy = LEGACY_DUPLICATES) {
  /** @type {Map<string, string[]>} */
  const byId = new Map()
  for (const e of entries) {
    const n = inbulNumberOfTitle(e.title)
    if (n === null) continue
    const id = inbulName(n)
    byId.set(id, [...(byId.get(id) ?? []), e.hash])
  }
  /** @type {{ id: string, hashes: string[] }[]} */
  const out = []
  for (const [id, hashes] of byId) {
    if (hashes.length < 2) continue
    const allowed = legacy[id] ?? []
    if (hashes.every((h) => allowed.some((p) => h.startsWith(p)))) continue
    out.push({ id, hashes })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}
