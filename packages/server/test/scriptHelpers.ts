import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Shared by toolingScripts.test.ts and repoGuard.test.ts: throw-away git repositories in the OS temp folder, each
// holding its own copy of the scripts, because the scripts act on the repository that holds them (BE-059), not on
// the folder they are started from.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
// SCRIPTS_UNDER_TEST=<folder> runs the tests against another copy of the scripts (for example the ones from before a fix,
// to see a new test fail first). Unset, the repository's own scripts are used.
export const SCRIPTS_DIR = process.env.SCRIPTS_UNDER_TEST ?? path.join(ROOT, 'scripts')

export const tmpDir = (prefix: string): string => fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
export const removeDirs = (dirs: string[]): void => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) }

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** Copies every .mjs script into <dir>/scripts and hides the copy from git (so file counts and scans see only the test's own files). */
export function installScripts(dir: string): void {
  const to = path.join(dir, 'scripts')
  fs.mkdirSync(to, { recursive: true })
  for (const f of fs.readdirSync(SCRIPTS_DIR)) {
    if (f.endsWith('.mjs') || f.endsWith('.d.mts')) fs.copyFileSync(path.join(SCRIPTS_DIR, f), path.join(to, f))
  }
  const exclude = path.join(dir, '.git', 'info', 'exclude')
  if (fs.existsSync(path.dirname(exclude))) fs.appendFileSync(exclude, '\n/scripts/\n')
}

/** An empty git repository holding its own copy of the scripts. */
export function scriptRepo(dirs: string[], prefix = 'tooling'): string {
  const d = tmpDir(prefix)
  dirs.push(d)
  git(d, 'init', '-q')
  installScripts(d)
  return d
}

export function write(dir: string, rel: string, text: string | Uint8Array): void {
  const abs = path.join(dir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
}

export const scriptIn = (dir: string, name: string): string => path.join(dir, 'scripts', name)

export function run(script: string, cwd: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, BANNED_TERMS: '', REQUIRE_BANNED_TERMS: '', GITHUB_ACTIONS: '', ...env } })
}

/**
 * Loads one of the scripts as a module (the scripts are plain .mjs with no type declarations, so the result is untyped).
 * A plain path with forward slashes, not a file:// URL: Vite does not decode the URL, so a checkout in a folder with a space
 * ("New folder" becomes "New%20folder") could not find the file.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const loadScript = (name: string): Promise<any> => import(/* @vite-ignore */ path.join(SCRIPTS_DIR, name).split(path.sep).join('/'))
