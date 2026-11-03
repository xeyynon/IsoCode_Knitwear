// The supervisor's offline queue. An update is written here first and sent later, so a dead
// signal, a killed app or a full battery never loses it. Every item has a client id: the
// server treats a repeat of the same id as a duplicate, so retrying is always safe.

export interface QueuedEvent {
  clientUuid: string
  orderId: string
  stage: string
  /** The date the supervisor sees (India), YYYY-MM-DD. */
  date: string
  qty: number
  createdAt: number
  /** pending: still to send. rejected: the server refused it for good; needs a person. */
  status: 'pending' | 'rejected'
  reason?: string
  attempts: number
  /** A photo waiting to be uploaded (already resized). Removed as soon as the server has it. */
  photo?: Blob
  /** The photo's own id, so a retried upload returns the same photo and never makes a second. */
  photoUuid?: string
  /** Set once the server holds the photo; the update is then sent pointing at it. */
  photoId?: string
  /** Why a photo was left out when the pieces were still sent. */
  photoNote?: string
  /** Who wrote it (the signed-in account). An update is only ever sent under its own author's sign-in. */
  owner?: string
  /** A reason and/or a few words about why the stage is slow. Sent with the update in the same request. */
  note?: { text?: string; category?: string }
}

export type NewEvent = Pick<QueuedEvent, 'orderId' | 'stage' | 'date' | 'qty' | 'note'> & { photo?: Blob }

/** Where the queue is kept. IndexedDB in the browser; a plain array in tests. */
export interface QueueStore {
  list(): Promise<QueuedEvent[]>
  add(e: QueuedEvent): Promise<void>
  remove(clientUuids: string[]): Promise<void>
  update(clientUuid: string, patch: Partial<QueuedEvent>): Promise<void>
  /** False when the browser would not give us durable storage and we are keeping the queue in memory only. */
  readonly durable: boolean
}

export interface BatchItemResult { clientUuid?: unknown; result: 'accepted' | 'duplicate' | 'rejected'; code?: string; message?: string }
export type SendBatch = (events: (Pick<QueuedEvent, 'clientUuid' | 'orderId' | 'stage' | 'date' | 'qty' | 'note'> & { photoId?: string })[]) => Promise<{ results: BatchItemResult[] }>

export interface PhotoUpload { photoUuid: string; orderId: string; stage: string; date: string; blob: Blob }
/** Sends one photo; resolves to the server's id for it. Throws like a failed request (with a status). */
export type UploadPhoto = (p: PhotoUpload) => Promise<{ id: string }>

/** Why a sync stopped early. The queue is left untouched in every case. */
export type SyncError = 'network' | 'auth' | 'server' | null

export interface SyncOutcome {
  sent: number          // accepted or already-known by the server: safe to forget
  rejected: number      // refused for good: kept, flagged for a person
  remaining: number     // still pending
  error: SyncError
}
