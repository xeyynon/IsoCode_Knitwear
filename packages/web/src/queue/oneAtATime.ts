// A save that is still running must not be started again: a quick double tap on Send would
// otherwise queue the same count twice, each with its own client id, and the server would
// count both. The flag is a plain object (a React ref in the screen) so two taps in the same
// tick, before any re-render, are caught too.

/** Runs `fn` unless a previous run under the same flag is still going; then it does nothing and returns false. */
export async function oneAtATime(flag: { current: boolean }, fn: () => Promise<void>): Promise<boolean> {
  if (flag.current) return false
  flag.current = true
  try { await fn() } finally { flag.current = false }
  return true
}
