import type { QueuedEvent, QueueStore } from './types'

const DB = 'orders-offline'
const EVENTS = 'events'
const META = 'meta'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { keyPath: 'clientUuid' })
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the offline store'))
    req.onblocked = () => reject(new Error('The offline store is blocked by another tab'))
  })
}

const done = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('aborted')) })

export interface IdbStore extends QueueStore {
  getMeta<T>(key: string): Promise<T | undefined>
  setMeta(key: string, value: unknown): Promise<void>
}

/** The durable queue. Throws if the browser will not open IndexedDB; the caller then falls back to memory and says so. */
export async function createIdbStore(): Promise<IdbStore> {
  const db = await open()
  // Another tab upgrading the schema must not leave this one holding the old version open.
  db.onversionchange = () => db.close()
  return {
    durable: true,
    async list() {
      return (await done(db.transaction(EVENTS, 'readonly').objectStore(EVENTS).getAll())) as QueuedEvent[]
    },
    async add(e) {
      const tx = db.transaction(EVENTS, 'readwrite')
      tx.objectStore(EVENTS).add(e)   // add, not put: a repeated id must fail loudly, never overwrite
      await finished(tx)
    },
    async remove(ids) {
      if (!ids.length) return
      const tx = db.transaction(EVENTS, 'readwrite')
      for (const id of ids) tx.objectStore(EVENTS).delete(id)
      await finished(tx)
    },
    async update(id, patch) {
      const tx = db.transaction(EVENTS, 'readwrite')
      const store = tx.objectStore(EVENTS)
      const cur = (await done(store.get(id))) as QueuedEvent | undefined
      if (cur) store.put({ ...cur, ...patch })
      await finished(tx)
    },
    async getMeta<T>(key: string) {
      return (await done(db.transaction(META, 'readonly').objectStore(META).get(key))) as T | undefined
    },
    async setMeta(key, value) {
      const tx = db.transaction(META, 'readwrite')
      tx.objectStore(META).put(value, key)
      await finished(tx)
    },
  }
}
