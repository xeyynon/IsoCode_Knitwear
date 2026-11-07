// Phones with little space can clear a site's data. The supervisor must hear about it BEFORE
// an update is lost, in plain words, not find out later.
import { translate, type Key } from '../i18n'

export interface StorageFacts {
  /** Is the queue kept in durable storage at all? */
  durable: boolean
  /** Did the browser agree to keep our data even when space runs low? null = unknown/unsupported. */
  persisted: boolean | null
  usage?: number
  quota?: number
}

export const LOW_SPACE_BYTES = 50 * 1024 * 1024

/**
 * One short sentence, or null when everything is fine. The most serious problem wins.
 * A warning about data that MIGHT be cleared is only worth a supervisor's attention when
 * there is something waiting to be lost; otherwise it is noise they learn to ignore.
 */
export function storageWarningKey(f: StorageFacts, pending = 0): Key | null {
  if (!f.durable) return 'store.notDurable'
  if (f.quota !== undefined && f.usage !== undefined && f.quota - f.usage < LOW_SPACE_BYTES) return 'store.lowSpace'
  if (f.persisted === false && pending > 0) return 'store.homeScreen'
  return null
}

/** Why an update could not be stored on the phone: out of room, or some other failure. */
export function saveFailedKey(err: unknown): Key {
  return err instanceof Error && err.name === 'QuotaExceededError' ? 'update.saveFailedFull' : 'update.saveFailed'
}

/** The warning in words: English unless a translator is passed. */
export function storageWarning(f: StorageFacts, pending = 0, t: (k: Key) => string = (k) => translate('en', k)): string | null {
  const key = storageWarningKey(f, pending)
  return key && t(key)
}

/** Ask the browser to keep our data, then read how much room is left. Never throws. */
export async function readStorageFacts(durable: boolean): Promise<StorageFacts> {
  const facts: StorageFacts = { durable, persisted: null }
  try {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined
    if (s?.persisted) facts.persisted = (await s.persisted()) || (s.persist ? await s.persist() : false)
    if (s?.estimate) { const e = await s.estimate(); facts.usage = e.usage; facts.quota = e.quota }
  } catch { /* unknown: say nothing rather than guess */ }
  return facts
}
