import { describe, expect, it } from 'vitest'
import { createQueueController } from '../src/queue/controller'
import { BATCH_SIZE, classifyError, memoryStore, syncQueue } from '../src/queue/sync'
import type { BatchItemResult, QueuedEvent, SendBatch } from '../src/queue/types'

let seq = 0
const item = (over: Partial<QueuedEvent> = {}): QueuedEvent => ({
  clientUuid: `id-${++seq}`, orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 100,
  createdAt: seq, status: 'pending', attempts: 0, ...over,
})
const fill = async (store: ReturnType<typeof memoryStore>, n: number) => { for (let i = 0; i < n; i++) await store.add(item()) }
const httpError = (status: number) => Object.assign(new Error(`http ${status}`), { status })

/** A fake server with the real server's idempotency: the first send of an id is accepted, repeats are duplicates. */
function fakeServer(rules: { reject?: (id: string) => string | null } = {}) {
  const have = new Map<string, number>()
  const send: SendBatch = async (events) => {
    const results: BatchItemResult[] = events.map((e) => {
      const why = rules.reject?.(e.clientUuid)
      if (why) return { clientUuid: e.clientUuid, result: 'rejected', code: 'bad_request', message: why }
      if (have.has(e.clientUuid)) return { clientUuid: e.clientUuid, result: 'duplicate' }
      have.set(e.clientUuid, e.qty)
      return { clientUuid: e.clientUuid, result: 'accepted' }
    })
    return { results }
  }
  return { have, send }
}

describe('syncQueue', () => {
  it('sends oldest first and forgets what the server has', async () => {
    const store = memoryStore()
    await store.add(item({ clientUuid: 'b', createdAt: 2 }))
    await store.add(item({ clientUuid: 'a', createdAt: 1 }))
    const order: string[] = []
    const out = await syncQueue(store, async (ev) => { order.push(...ev.map((e) => e.clientUuid)); return { results: ev.map((e) => ({ clientUuid: e.clientUuid, result: 'accepted' as const })) } })
    expect(order).toEqual(['a', 'b'])
    expect(out).toEqual({ sent: 2, rejected: 0, remaining: 0, error: null })
    expect(store.items).toHaveLength(0)
  })

  it('treats "duplicate" as sent: the server already has it', async () => {
    const store = memoryStore()
    await fill(store, 1)
    const out = await syncQueue(store, async (ev) => ({ results: ev.map((e) => ({ clientUuid: e.clientUuid, result: 'duplicate' as const })) }))
    expect(out.sent).toBe(1)
    expect(store.items).toHaveLength(0)
  })

  it('keeps a rejected update, flagged with the reason, and never retries it by itself', async () => {
    const store = memoryStore()
    await store.add(item({ clientUuid: 'bad' }))
    await store.add(item({ clientUuid: 'good' }))
    const srv = fakeServer({ reject: (id) => (id === 'bad' ? 'No such stage for your unit' : null) })
    const first = await syncQueue(store, srv.send)
    expect(first).toMatchObject({ sent: 1, rejected: 1, remaining: 0 })
    expect(store.items).toHaveLength(1)
    expect(store.items[0]).toMatchObject({ clientUuid: 'bad', status: 'rejected', reason: 'No such stage for your unit' })
    let calls = 0
    await syncQueue(store, async (ev) => { calls++; return srv.send(ev) })
    expect(calls).toBe(0)   // a rejected item is not pending, so nothing is sent
  })

  it.each([
    [0, 'network'], [undefined, 'network'], [401, 'auth'], [500, 'server'], [503, 'server'], [429, 'server'],
  ] as const)('a failure with status %s is "%s" and leaves the queue untouched', async (status, kind) => {
    const store = memoryStore()
    await fill(store, 3)
    const out = await syncQueue(store, async () => { throw status === undefined ? new Error('offline') : httpError(status) })
    expect(out).toMatchObject({ sent: 0, remaining: 3, error: kind })
    expect(store.items).toHaveLength(3)
    expect(store.items.every((e) => e.attempts === 1 && e.status === 'pending')).toBe(true)
  })
  it('classifies errors', () => {
    expect(classifyError(httpError(401))).toBe('auth')
    expect(classifyError(httpError(0))).toBe('network')
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('network')
  })

  it('sends in batches of at most 200', async () => {
    const store = memoryStore()
    await fill(store, 450)
    const sizes: number[] = []
    const srv = fakeServer()
    await syncQueue(store, async (ev) => { sizes.push(ev.length); return srv.send(ev) })
    expect(sizes).toEqual([BATCH_SIZE, BATCH_SIZE, 50])
    expect(srv.have.size).toBe(450)
  })

  it('if a later batch fails, earlier batches are already forgotten and the rest stay queued', async () => {
    const store = memoryStore()
    await fill(store, 250)
    const srv = fakeServer()
    let n = 0
    const out = await syncQueue(store, async (ev) => { if (++n === 2) throw httpError(0); return srv.send(ev) })
    expect(out).toMatchObject({ sent: 200, remaining: 50, error: 'network' })
    expect(store.items).toHaveLength(50)
  })

  it('an item the server says nothing about stays queued', async () => {
    const store = memoryStore()
    await fill(store, 2)
    const out = await syncQueue(store, async (ev) => ({ results: [{ clientUuid: ev[0]!.clientUuid, result: 'accepted' as const }] }))
    expect(out).toMatchObject({ sent: 1, remaining: 1 })
  })

  it('EXACTLY ONCE under random failures, including a processed batch whose reply is lost', async () => {
    const store = memoryStore()
    const N = 120
    await fill(store, N)
    const srv = fakeServer()
    let tick = 0
    // deterministic pseudo-random failures: before processing, after processing (lost reply), or fine
    const flaky: SendBatch = async (ev) => {
      const mode = (tick++ * 7) % 5
      if (mode === 0) throw httpError(0)                  // never reached the server
      const r = await srv.send(ev)                        // the server processed it...
      if (mode === 1) throw httpError(0)                  // ...but the reply was lost
      if (mode === 2) throw httpError(503)
      return r
    }
    for (let i = 0; i < 200 && store.items.some((e) => e.status === 'pending'); i++) {
      // a tiny batch size would exercise more splits; shrink by syncing the head only
      const head = store.items.slice(0, 7)
      const sub = memoryStore()
      for (const h of head) await sub.add(h)
      await syncQueue(sub, flaky).then(async () => { await store.remove(head.filter((h) => !sub.items.find((s) => s.clientUuid === h.clientUuid)).map((h) => h.clientUuid)) })
    }
    expect(store.items).toHaveLength(0)       // everything was eventually confirmed
    expect(srv.have.size).toBe(N)             // and the server holds each id exactly once
    expect([...srv.have.values()].reduce((a, b) => a + b, 0)).toBe(N * 100)
  })
})

describe('the controller', () => {
  const make = (online = true, srv = fakeServer()) => {
    let isOnline = online
    const sends: number[] = []
    const store = memoryStore(true)
    let id = 0
    const ctl = createQueueController({
      store, uuid: () => `u${++id}`, now: () => 1000 + id, isOnline: () => isOnline,
      send: async (ev) => { sends.push(ev.length); return srv.send(ev) },
    })
    return { ctl, store, sends, srv, setOnline: (v: boolean) => { isOnline = v } }
  }
  const e = { orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 120 }

  it('saves first: offline, nothing is sent and the update waits', async () => {
    const t = make(false)
    await t.ctl.enqueue(e)
    expect(t.sends).toEqual([])
    expect(t.store.items).toHaveLength(1)
    expect(t.ctl.getState()).toMatchObject({ pending: 1, online: false })
  })

  it('sends when the signal returns, and the count goes back to zero', async () => {
    const t = make(false)
    await t.ctl.enqueue(e); await t.ctl.enqueue(e)
    expect(t.ctl.getState().pending).toBe(2)
    t.setOnline(true)
    await t.ctl.syncNow()
    expect(t.ctl.getState()).toMatchObject({ pending: 0, error: null, online: true })
    expect(t.srv.have.size).toBe(2)
  })

  it('online: an update is sent straight away', async () => {
    const t = make(true)
    await t.ctl.enqueue(e)
    await t.ctl.syncNow()
    expect(t.srv.have.size).toBe(1)
    expect(t.ctl.getState().pending).toBe(0)
  })

  it('only one sync runs at a time; a second call joins it', async () => {
    const t = make(false)
    for (let i = 0; i < 5; i++) await t.ctl.enqueue(e)
    t.setOnline(true)
    await Promise.all([t.ctl.syncNow(), t.ctl.syncNow(), t.ctl.syncNow()])
    expect(t.sends).toEqual([5])
    expect(t.srv.have.size).toBe(5)
  })

  it('a failed sync keeps everything and reports why', async () => {
    const store = memoryStore(true)
    const ctl = createQueueController({ store, isOnline: () => true, send: async () => { throw httpError(0) } })
    await ctl.enqueue(e)
    await ctl.syncNow()
    expect(ctl.getState()).toMatchObject({ pending: 1, error: 'network', syncing: false })
    expect(store.items).toHaveLength(1)
  })

  it('exposes rejected updates and lets a person discard them', async () => {
    const t = make(true, fakeServer({ reject: () => 'No such stage for your unit' }))
    await t.ctl.enqueue(e)
    await t.ctl.syncNow()
    const s = t.ctl.getState()
    expect(s.pending).toBe(0)
    expect(s.rejected).toHaveLength(1)
    expect(s.rejected[0]!.reason).toMatch(/No such stage/)
    await t.ctl.discard(s.rejected[0]!.clientUuid)
    expect(t.ctl.getState().rejected).toHaveLength(0)
  })

  it('totals what is waiting for one stage and day, so "today so far" includes unsent pieces', async () => {
    const t = make(false)
    await t.ctl.enqueue({ ...e, qty: 100 }); await t.ctl.enqueue({ ...e, qty: 50 })
    await t.ctl.enqueue({ ...e, stage: 'cutting', qty: 999 }); await t.ctl.enqueue({ ...e, date: '2026-11-03', qty: 999 })
    expect(t.ctl.waitingQty('o1', 'sewing', '2026-11-04')).toBe(150)
  })

  it('remembers what was just sent, until a fresher list from the server covers it', async () => {
    const t = make(true)
    await t.ctl.enqueue({ ...e, qty: 70 })
    await t.ctl.syncNow()
    expect(t.ctl.waitingQty('o1', 'sewing', '2026-11-04')).toBe(0)
    expect(t.ctl.sentSince('o1', 'sewing', '2026-11-04', 0)).toBe(70)          // a list fetched before the send misses it
    expect(t.ctl.sentSince('o1', 'sewing', '2026-11-04', 10_000_000)).toBe(0)  // a list fetched after already has it
  })

  it('says so when the queue is memory-only (updates would be lost on close)', async () => {
    const ctl = createQueueController({ store: memoryStore(false), isOnline: () => true, send: async () => ({ results: [] }) })
    expect(ctl.getState().durable).toBe(false)
  })

  it('a restart does not lose waiting updates: a new controller over the same store sees them', async () => {
    const t = make(false)
    await t.ctl.enqueue(e); await t.ctl.enqueue(e); await t.ctl.enqueue(e)
    const reborn = createQueueController({ store: t.store, isOnline: () => true, send: t.srv.send })
    await reborn.refresh()
    expect(reborn.getState().pending).toBe(3)
    await reborn.syncNow()
    expect(t.srv.have.size).toBe(3)
  })
})
