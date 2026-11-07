import { describe, expect, it } from 'vitest'
import { decodeClaims } from '../src/api/sessionRules'
import { createQueueController } from '../src/queue/controller'
import { isMine, memoryStore, syncQueue } from '../src/queue/sync'
import type { BatchItemResult, QueuedEvent, SendBatch } from '../src/queue/types'

let seq = 0
const item = (over: Partial<QueuedEvent> = {}): QueuedEvent => ({
  clientUuid: `o-${++seq}`, orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 100, createdAt: seq, status: 'pending', attempts: 0, ...over,
})
const server = () => {
  const seen: string[] = []
  const send: SendBatch = async (b) => { seen.push(...b.map((e) => e.clientUuid)); return { results: b.map((e): BatchItemResult => ({ clientUuid: e.clientUuid, result: 'accepted' })) } }
  return { seen, send }
}

describe('who may send an update', () => {
  it('the author, anyone for an update with no recorded author, and anyone when nobody is known', () => {
    expect(isMine(item({ owner: 'A' }), 'A')).toBe(true)
    expect(isMine(item({ owner: 'A' }), 'B')).toBe(false)
    expect(isMine(item({}), 'B')).toBe(true)                    // from before authors were recorded
    expect(isMine(item({ owner: 'A' }), null)).toBe(true)       // no sign-in known (a test, or a failed decode): do not strand it
  })

  it("only the signed-in person's updates are sent; another person's stay queued untouched", async () => {
    const store = memoryStore(); const s = server()
    await store.add(item({ clientUuid: 'a1', owner: 'A' })); await store.add(item({ clientUuid: 'b1', owner: 'B' })); await store.add(item({ clientUuid: 'old' }))
    const out = await syncQueue(store, s.send, undefined, 'A')
    expect(s.seen.sort()).toEqual(['a1', 'old'])
    expect(out).toMatchObject({ sent: 2, remaining: 0, error: null })
    expect(store.items.map((e) => e.clientUuid)).toEqual(['b1'])
    expect(store.items[0]).toMatchObject({ status: 'pending', attempts: 0 })    // not even counted as an attempt
  })

  it('and they go out when their author signs in', async () => {
    const store = memoryStore(); const s = server()
    await store.add(item({ clientUuid: 'b1', owner: 'B' }))
    await syncQueue(store, s.send, undefined, 'A')
    expect(s.seen).toEqual([])
    await syncQueue(store, s.send, undefined, 'B')
    expect(s.seen).toEqual(['b1'])
    expect(store.items).toHaveLength(0)
  })

  it('photos too: the uploader is not called for another person\'s update', async () => {
    const store = memoryStore(); const s = server(); const uploaded: string[] = []
    await store.add(item({ clientUuid: 'b1', owner: 'B', photo: new Blob([new Uint8Array(2000)]), photoUuid: 'pb' }))
    await syncQueue(store, s.send, async (p) => { uploaded.push(p.photoUuid); return { id: 'x' } }, 'A')
    expect(uploaded).toEqual([])
    expect(store.items[0]!.photo).toBeInstanceOf(Blob)
  })

  it('a sign-in that changes while a sync is running stops it: nothing goes out under the next person, and the updates stay waiting', async () => {
    const store = memoryStore(); let who: string | null = 'A'; const sentAs: (string | null)[] = []
    await store.add(item({ clientUuid: 'a1', owner: 'A', photo: new Blob([new Uint8Array(2000)]), photoUuid: 'pa' }))
    await store.add(item({ clientUuid: 'a2', owner: 'A' }))
    const send: SendBatch = async (b) => { sentAs.push(who); return { results: b.map((e): BatchItemResult => ({ clientUuid: e.clientUuid, result: who === 'A' ? 'accepted' : 'rejected', message: 'No such stage for your unit' })) } }
    // A signs out and B signs in while A's photo is uploading
    const out = await syncQueue(store, send, async () => { who = null; who = 'B'; return { id: 'p1' } }, 'A', () => who)
    expect(sentAs).toEqual([])
    expect(out).toMatchObject({ sent: 0, rejected: 0, remaining: 2, error: 'auth' })
    expect(store.items.map((e) => e.status)).toEqual(['pending', 'pending'])
    // when A signs back in, they go
    who = 'A'
    await syncQueue(store, send, async () => ({ id: 'p1' }), 'A', () => who)
    expect(sentAs).toEqual(['A'])
    expect(store.items).toHaveLength(0)
  })

  it('the controller checks who is signed in before each request, not only when the sync starts', async () => {
    const store = memoryStore(true); let who: string | null = 'A'; const sentAs: (string | null)[] = []
    const send: SendBatch = async (b) => { sentAs.push(who); return { results: b.map((e): BatchItemResult => ({ clientUuid: e.clientUuid, result: 'accepted' })) } }
    const ctl = createQueueController({ store, isOnline: () => true, send, uploadPhoto: async () => { who = 'B'; return { id: 'p1' } }, getOwner: () => who })
    await store.add(item({ clientUuid: 'a1', owner: 'A', photo: new Blob([new Uint8Array(2000)]), photoUuid: 'pa' }))
    await ctl.syncNow()
    expect(sentAs).toEqual([])
    expect(store.items[0]).toMatchObject({ owner: 'A', status: 'pending' })
    expect(ctl.getState()).toMatchObject({ pending: 0, foreign: 1, rejected: [], error: null })
  })
})

describe('the queue on a shared phone', () => {
  const make = () => {
    let who: string | null = 'A'
    const s = server(); const store = memoryStore(true); let n = 0
    const ctl = createQueueController({ store, isOnline: () => false, send: s.send, uuid: () => `u${++n}`, getOwner: () => who })
    return { ctl, store, s, as: (w: string | null) => { who = w }, goOnline: () => createQueueController({ store, isOnline: () => true, send: s.send, getOwner: () => who }) }
  }
  const e = { orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 50 }

  it('stamps each update with its author', async () => {
    const t = make()
    await t.ctl.enqueue(e)
    t.as('B'); await t.ctl.enqueue(e)
    expect(t.store.items.map((i) => i.owner)).toEqual(['A', 'B'])
  })

  it("shows another person's waiting updates separately, so \"all sent\" is never claimed falsely", async () => {
    const t = make()
    await t.ctl.enqueue(e); await t.ctl.enqueue(e)                 // two from A
    t.as('B')
    await t.ctl.refresh()
    expect(t.ctl.getState()).toMatchObject({ pending: 0, foreign: 2 })
    await t.ctl.enqueue(e)
    expect(t.ctl.getState()).toMatchObject({ pending: 1, foreign: 2 })
  })

  it("lists only the signed-in person's refused updates; another person's are only counted, and cannot be removed", async () => {
    const t = make()
    await t.store.add(item({ clientUuid: 'ra', owner: 'A', status: 'rejected', reason: 'No such stage for your unit' }))
    await t.ctl.refresh()
    expect(t.ctl.getState().rejected.map((r) => r.clientUuid)).toEqual(['ra'])
    t.as('B'); await t.ctl.refresh()
    expect(t.ctl.getState()).toMatchObject({ rejected: [], foreignRejected: 1 })
    await t.ctl.discard('ra')
    expect(t.store.items.map((i) => i.clientUuid)).toEqual(['ra'])  // still there for A
    t.as('A'); await t.ctl.refresh()
    expect(t.ctl.getState()).toMatchObject({ foreignRejected: 0 })
    expect(t.ctl.getState().rejected.map((r) => r.clientUuid)).toEqual(['ra'])
  })

  it("\"today so far\" counts only the signed-in person's waiting pieces", async () => {
    const t = make()
    await t.ctl.enqueue({ ...e, qty: 70 })
    t.as('B'); await t.ctl.enqueue({ ...e, qty: 30 })
    expect(t.ctl.waitingQty('o1', 'sewing', '2026-11-04')).toBe(30)
    t.as('A'); await t.ctl.refresh()
    expect(t.ctl.waitingQty('o1', 'sewing', '2026-11-04')).toBe(70)
  })

  it('when the first person signs back in on a connected phone, their updates are sent and the other\'s still wait', async () => {
    const t = make()
    await t.ctl.enqueue(e)                                         // A, offline
    t.as('B'); await t.ctl.enqueue(e)                              // B, offline
    t.as('A')
    const online = t.goOnline()
    await online.refresh(); await online.syncNow()
    expect(t.s.seen).toEqual(['u1'])
    expect(online.getState()).toMatchObject({ pending: 0, foreign: 1 })
    expect(t.store.items.map((i) => i.owner)).toEqual(['B'])
  })

  it('an update saved just as the sign-in expires still belongs to its author, not to whoever signs in next', async () => {
    const t = make()
    await t.ctl.refresh()                                          // A's screen is open
    t.as(null); await t.ctl.enqueue(e)                             // the token expired: the send itself finds no sign-in
    expect(t.store.items.map((i) => i.owner)).toEqual(['A'])
    t.as('B')
    const online = t.goOnline()
    await online.refresh(); await online.syncNow()
    expect(t.s.seen).toEqual([])
    expect(online.getState()).toMatchObject({ pending: 0, foreign: 1 })
  })
})

describe('reading who is signed in', () => {
  const token = (c: object) => `${Buffer.from(JSON.stringify(c)).toString('base64url')}.sig`
  it('reads the account id, and copes with a token that has none', () => {
    expect(decodeClaims(token({ sub: 'acc-1', role: 'supervisor', exp: 9 }))).toEqual({ sub: 'acc-1', role: 'supervisor', exp: 9 })
    expect(decodeClaims(token({ role: 'supervisor', exp: 9 }))).toEqual({ role: 'supervisor', exp: 9 })
    expect(decodeClaims(token({ sub: 5, role: 'supervisor', exp: 9 }))).toEqual({ role: 'supervisor', exp: 9 })
  })
})
