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
}

export type NewEvent = Pick<QueuedEvent, 'orderId' | 'stage' | 'date' | 'qty'>

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
export type SendBatch = (events: Pick<QueuedEvent, 'clientUuid' | 'orderId' | 'stage' | 'date' | 'qty'>[]) => Promise<{ results: BatchItemResult[] }>

/** Why a sync stopped early. The queue is left untouched in every case. */
export type SyncError = 'network' | 'auth' | 'server' | null

export interface SyncOutcome {
  sent: number          // accepted or already-known by the server: safe to forget
  rejected: number      // refused for good: kept, flagged for a person
  remaining: number     // still pending
  error: SyncError
}
