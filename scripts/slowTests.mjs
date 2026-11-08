// Per-file test timeouts (BE-055). Most tests are quick; these files start PGlite (Postgres in WebAssembly), spawn git or
// migrate many databases, and used 50 to 70 percent of the old 30 s limit on an idle machine, so a busy one (CI, a virus
// scan) pushed them over and the failure was a timeout, not an assertion. They get a longer limit of their own; every other
// file keeps the default in vitest.config.ts. vitest.setup.ts applies this per file.
export const SLOW_TIMEOUT_MS = 120_000

/**
 * File name (no folder) -> its timeout in ms.
 * @type {Record<string, number>}
 */
export const SLOW_FILES = {
  'migrate.test.ts': SLOW_TIMEOUT_MS,
  'rls.test.ts': SLOW_TIMEOUT_MS,
  'ordering.test.ts': SLOW_TIMEOUT_MS,
  'templateCalendar.test.ts': SLOW_TIMEOUT_MS,
  'buyerExport.test.ts': SLOW_TIMEOUT_MS,
  'undoDismiss.test.ts': SLOW_TIMEOUT_MS,
  'fuzz.test.ts': SLOW_TIMEOUT_MS,
  'toolingScripts.test.ts': SLOW_TIMEOUT_MS,
  'repoGuard.test.ts': SLOW_TIMEOUT_MS,
}

/**
 * The timeout for a test file path (either slash), or null when the file keeps the default.
 * @param {string} testPath
 * @returns {number | null}
 */
export function slowTimeoutFor(testPath) {
  const name = String(testPath).split(/[\\/]/).pop() ?? ''
  return Object.prototype.hasOwnProperty.call(SLOW_FILES, name) ? (SLOW_FILES[name] ?? null) : null
}
