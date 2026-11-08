import type { Db } from './db.js'
import { assertMediaKey, type MediaStore } from './mediaStore.js'

/**
 * Photo bytes in Postgres (migration 019), for a host with no disk and no bucket. Every call is its own short transaction acting as
 * 'system': the photo routes have already checked who is asking before they reach the store. The same key rule as the other stores.
 */
export function dbMediaStore(db: Db): MediaStore {
  const sys = { role: 'system' } as const
  return {
    async put(key, bytes) {
      assertMediaKey(key)
      await db.tx(sys, (tx) => tx.query('insert into media_object (key, bytes) values ($1, $2) on conflict (key) do update set bytes = excluded.bytes', [key, bytes]))
    },
    async get(key) {
      assertMediaKey(key)
      const row = (await db.tx(sys, (tx) => tx.query<{ bytes: Uint8Array }>('select bytes from media_object where key = $1', [key])))[0]
      return row ? Buffer.from(row.bytes) : null
    },
    async delete(key) {
      assertMediaKey(key)
      await db.tx(sys, (tx) => tx.query('delete from media_object where key = $1', [key]))
    },
  }
}
