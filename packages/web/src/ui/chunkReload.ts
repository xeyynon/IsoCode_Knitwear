// After a deploy, an open tab asks for old file names that no longer exist and a lazy screen
// fails to load. Reload once to fetch the new index, but never in a loop.
export const RELOAD_WINDOW_MS = 60_000

export function shouldReload(lastReloadAt: number | null, nowMs: number): boolean {
  return lastReloadAt === null || nowMs - lastReloadAt > RELOAD_WINDOW_MS
}

export const isChunkError = (e: unknown): boolean =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(
    String((e as Error)?.message ?? e),
  )
