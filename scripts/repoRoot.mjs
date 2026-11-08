// Which repository a script acts on: the one that HOLDS the script, not the folder it was started from (BE-059).
// Running `node <repo A>/scripts/changelog.mjs` from inside repo B used to write into B. Outside git there is
// no repository to act on, so the caller gets one plain line and exit code 1, not a stack trace.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The script's own folder, from its `import.meta.url`.
 * @param {string} metaUrl
 */
export const scriptDir = (metaUrl) => path.dirname(fileURLToPath(metaUrl))

/**
 * The top of the git repository that holds the script, or null when the script is not inside one.
 * @param {string} metaUrl
 * @returns {string | null}
 */
export function repoRootOrNull(metaUrl) {
  try {
    return execFileSync('git', ['-C', scriptDir(metaUrl), 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch { return null }
}

/**
 * As repoRootOrNull, but prints one line and exits 1 when there is no repository.
 * @param {string} metaUrl
 * @param {string} who  the script's name, for the message
 * @returns {string}
 */
export function repoRoot(metaUrl, who) {
  const root = repoRootOrNull(metaUrl)
  if (!root) {
    console.error(`${who}: ${scriptDir(metaUrl)} is not inside a git repository, so there is nothing to check or change.`)
    process.exit(1)
  }
  return root
}
