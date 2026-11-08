// A vitest reporter that prints the slowest tests at the end of a run (BE-055), so drift towards the timeout is seen
// before it turns into a flaky failure. vitest.config.ts adds it when CI is set (or SLOWEST_TESTS=1).
// SLOWEST_TESTS=<n> (n above 1) changes how many are listed (default 10).

/**
 * @typedef {{ type?: string, name: string, result?: { duration?: number }, tasks?: Task[] }} Task
 * @typedef {{ file: string, name: string, duration: number }} Timed
 */

/**
 * The n slowest tests across all files, slowest first. Skipped tests have no duration and are left out.
 * @param {{ name: string, tasks?: Task[] }[]} files
 * @param {number} [n]
 * @returns {Timed[]}
 */
export function slowestTests(files, n = 10) {
  /** @type {Timed[]} */
  const out = []
  /**
   * @param {Task} task
   * @param {string} file
   * @param {string[]} prefix
   */
  const visit = (task, file, prefix) => {
    if (task.type === 'test' || task.type === 'custom') {
      const duration = task.result?.duration
      if (typeof duration === 'number') out.push({ file, name: [...prefix, task.name].join(' > '), duration })
    } else for (const t of task.tasks ?? []) visit(t, file, [...prefix, task.name])
  }
  for (const f of files) for (const t of f.tasks ?? []) visit(t, f.name, [])
  return out.sort((a, b) => b.duration - a.duration).slice(0, n)
}

/** @param {Timed[]} list */
export const formatSlowest = (list) =>
  list.map((t) => `${(t.duration / 1000).toFixed(1).padStart(6)} s  ${t.file}  ${t.name}`).join('\n')

export default class SlowestReporter {
  /** @param {{ name: string, tasks?: Task[] }[]} [files] */
  onFinished(files = []) {
    const n = Number(process.env.SLOWEST_TESTS) > 1 ? Number(process.env.SLOWEST_TESTS) : 10
    const list = slowestTests(files, n)
    if (list.length) console.log(`\nThe ${list.length} slowest tests:\n${formatSlowest(list)}\n`)
  }
}
