import { describe, expect, it } from 'vitest'
import { createQueueController } from '../src/queue/controller'
import { memoryStore, syncQueue } from '../src/queue/sync'
import { checkPrepared, fitWithin, MIN_PHOTO_BYTES, sizeText } from '../src/photo/resize'
import type { BatchItemResult, QueuedEvent, SendBatch, UploadPhoto } from '../src/queue/types'

let seq = 0
const blob = () => new Blob([new Uint8Array(2000)], { type: 'image/jpeg' })
const item = (over: Partial<QueuedEvent> = {}): QueuedEvent => ({
  clientUuid: `e-${++seq}`, orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 100, createdAt: seq, status: 'pending', attempts: 0, ...over,
})
const withPhoto = (over: Partial<QueuedEvent> = {}) => item({ photo: blob(), photoUuid: `p-${seq}`, ...over })
const httpError = (status: number, message = `http ${status}`) => Object.assign(new Error(message), { status })

/** A fake server with the real idempotency: one photo per photoUuid, one event per clientUuid. */
function fakeServer() {
  const photos = new Map<string, string>()       // photoUuid -> id
  const events = new Map<string, { qty: number; photoId?: string }>()
  const calls: string[] = []
  const upload: UploadPhoto = async (p) => {
    calls.push(`upload:${p.photoUuid}`)
    if (!photos.has(p.photoUuid)) photos.set(p.photoUuid, `photo-${photos.size + 1}`)
    return { id: photos.get(p.photoUuid)! }
  }
  const send: SendBatch = async (batch) => {
    calls.push(`send:${batch.map((b) => b.clientUuid).join(',')}`)
    const results: BatchItemResult[] = batch.map((e) => {
      if (events.has(e.clientUuid)) return { clientUuid: e.clientUuid, result: 'duplicate' }
      events.set(e.clientUuid, { qty: e.qty, ...(e.photoId ? { photoId: e.photoId } : {}) })
      return { clientUuid: e.clientUuid, result: 'accepted' }
    })
    return { results }
  }
  return { photos, events, calls, upload, send }
}

describe('sending an update that has a photo', () => {
  it('uploads the photo first, then sends the update pointing at it, and forgets the copy', async () => {
    const store = memoryStore(); const srv = fakeServer()
    await store.add(withPhoto({ clientUuid: 'a', photoUuid: 'pa' }))
    const out = await syncQueue(store, srv.send, srv.upload)
    expect(srv.calls).toEqual(['upload:pa', 'send:a'])                 // the photo first
    expect(srv.events.get('a')).toEqual({ qty: 100, photoId: 'photo-1' })
    expect(out).toMatchObject({ sent: 1, remaining: 0, error: null })
    expect(store.items).toHaveLength(0)
  })

  it('an update without a photo needs no upload, and works with no uploader at all', async () => {
    const store = memoryStore(); const srv = fakeServer()
    await store.add(item({ clientUuid: 'plain' }))
    await syncQueue(store, srv.send)                                    // no uploader supplied
    expect(srv.calls).toEqual(['send:plain'])
  })

  it('if the update fails to send after the photo is up, the retry does NOT upload again and the id is the same', async () => {
    const store = memoryStore(); const srv = fakeServer()
    await store.add(withPhoto({ clientUuid: 'a', photoUuid: 'pa' }))
    let fail = true
    const flaky: SendBatch = async (b) => { if (fail) { fail = false; throw httpError(0) } return srv.send(b) }
    const first = await syncQueue(store, flaky, srv.upload)
    expect(first).toMatchObject({ sent: 0, remaining: 1, error: 'network' })
    expect(store.items[0]).toMatchObject({ photoId: 'photo-1' })
    expect(store.items[0]!.photo).toBeUndefined()                       // the heavy copy is freed once the server has it
    await syncQueue(store, flaky, srv.upload)
    expect(srv.calls.filter((c) => c.startsWith('upload'))).toEqual(['upload:pa'])   // uploaded once in total
    expect(srv.events.get('a')?.photoId).toBe('photo-1')
  })

  it('a photo upload that cannot reach the server leaves everything untouched, photo included', async () => {
    const store = memoryStore(); const srv = fakeServer()
    await store.add(withPhoto({ clientUuid: 'a' }))
    const out = await syncQueue(store, srv.send, async () => { throw httpError(0) })
    expect(out).toMatchObject({ sent: 0, remaining: 1, error: 'network' })
    expect(srv.calls).toEqual([])                                       // the update was not sent without its photo
    expect(store.items[0]!.photo).toBeInstanceOf(Blob)
    expect(store.items[0]!.attempts).toBe(1)
  })

  it.each([[401, 'auth'], [500, 'server'], [503, 'server'], [429, 'server']] as const)('upload status %i stops the sync (%s) and keeps the photo', async (status, kind) => {
    const store = memoryStore(); const srv = fakeServer()
    await store.add(withPhoto({ clientUuid: 'a' }))
    const out = await syncQueue(store, srv.send, async () => { throw httpError(status) })
    expect(out.error).toBe(kind)
    expect(store.items[0]!.photo).toBeInstanceOf(Blob)
    expect(srv.events.size).toBe(0)
  })

  it('if the server REFUSES the photo for good, the pieces are still sent and the photo is dropped with a note', async () => {
    const store = memoryStore(); const srv = fakeServer()
    await store.add(withPhoto({ clientUuid: 'a', qty: 350 }))
    const out = await syncQueue(store, srv.send, async () => { throw httpError(400, 'That file is not a JPEG photo') })
    expect(out).toMatchObject({ sent: 1, remaining: 0, error: null })
    expect(srv.events.get('a')).toEqual({ qty: 350 })                   // the count arrived, without a photo
    expect(store.items).toHaveLength(0)
  })

  it('records why a refused photo was dropped (until the update is sent)', async () => {
    const store = memoryStore()
    await store.add(withPhoto({ clientUuid: 'a' }))
    await syncQueue(store, async () => { throw httpError(0) }, async () => { throw httpError(404, 'No such stage for your unit') })
    expect(store.items[0]).toMatchObject({ photoNote: 'No such stage for your unit' })
    expect(store.items[0]!.photo).toBeUndefined()
  })

  it('says which updates went without their refused photo, and why, so the phone can show it', async () => {
    const store = memoryStore(); const srv = fakeServer()
    await store.add(withPhoto({ clientUuid: 'a', qty: 350 }))
    const out = await syncQueue(store, srv.send, async () => { throw httpError(400, 'That file is not a JPEG photo') })
    expect(out.droppedPhotos).toEqual([{ clientUuid: 'a', orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 350, note: 'That file is not a JPEG photo' }])
  })

  it('a photo refused in one sync is still reported when its pieces go out in a later one', async () => {
    const store = memoryStore(); const srv = fakeServer()
    await store.add(withPhoto({ clientUuid: 'a' }))
    const first = await syncQueue(store, async () => { throw httpError(0) }, async () => { throw httpError(400, 'Too small') })
    expect(first.droppedPhotos).toBeUndefined()                         // not sent yet: the note stays on the item
    const second = await syncQueue(store, srv.send, srv.upload)
    expect(second.droppedPhotos?.map((d) => [d.clientUuid, d.note])).toEqual([['a', 'Too small']])
  })

  it('EXACTLY ONCE for photos too, under random failures including a lost reply to the upload itself', async () => {
    const store = memoryStore(); const srv = fakeServer()
    const N = 40
    for (let i = 0; i < N; i++) await store.add(withPhoto({ clientUuid: `e${i}`, photoUuid: `p${i}`, qty: 10 }))
    let tick = 0
    const flakyUpload: UploadPhoto = async (p) => {
      const mode = (tick++ * 3) % 5
      if (mode === 0) throw httpError(0)                                // never arrived
      const r = await srv.upload(p)                                     // arrived...
      if (mode === 1) throw httpError(0)                                // ...but the reply was lost
      return r
    }
    const flakySend: SendBatch = async (b) => {
      const mode = (tick++ * 7) % 5
      if (mode === 0) throw httpError(0)
      const r = await srv.send(b)
      if (mode === 1) throw httpError(0)
      return r
    }
    for (let i = 0; i < 400 && store.items.some((e) => e.status === 'pending'); i++) await syncQueue(store, flakySend, flakyUpload)
    expect(store.items).toHaveLength(0)
    expect(srv.events.size).toBe(N)                                     // every update arrived exactly once
    expect(srv.photos.size).toBe(N)                                     // and exactly one photo per update, never two
    expect([...srv.events.values()].every((e) => e.photoId && e.qty === 10)).toBe(true)
    expect(new Set([...srv.events.values()].map((e) => e.photoId)).size).toBe(N)   // each update points at its OWN photo
  })
})

describe('the controller with photos', () => {
  it('saves the photo with the update, gives it its own id, and sends the update only after the photo is up', async () => {
    const srv = fakeServer(); const store = memoryStore(true); let n = 0
    const ctl = createQueueController({ store, uuid: () => `u${++n}`, isOnline: () => true, send: srv.send, uploadPhoto: srv.upload })
    await ctl.enqueue({ orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 80, photo: blob() })
    await ctl.syncNow()
    expect(srv.calls[0]).toMatch(/^upload:/)
    expect(srv.calls[1]).toMatch(/^send:/)
    const [id, e] = [...srv.events.entries()][0]!
    expect(e.photoId).toBe('photo-1')
    expect(id).not.toBe([...srv.photos.keys()][0])                      // the photo's id differs from the update's id
  })

  it('offline: the photo waits on the phone with the update, and survives a restart', async () => {
    const srv = fakeServer(); const store = memoryStore(true)
    const offline = createQueueController({ store, isOnline: () => false, send: srv.send, uploadPhoto: srv.upload })
    await offline.enqueue({ orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 80, photo: blob() })
    expect(srv.calls).toEqual([])
    const reborn = createQueueController({ store, isOnline: () => true, send: srv.send, uploadPhoto: srv.upload })
    await reborn.refresh(); await reborn.syncNow()
    expect(srv.photos.size).toBe(1)
    expect(srv.events.size).toBe(1)
  })

  it('remembers a photo the server refused, so the screen can say so instead of "sent with a photo"', async () => {
    const srv = fakeServer(); const store = memoryStore(true); let n = 0
    const ctl = createQueueController({ store, uuid: () => `u${++n}`, isOnline: () => true, send: srv.send, uploadPhoto: async () => { throw httpError(400, 'That file is not a JPEG photo') } })
    const it1 = await ctl.enqueue({ orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 80, photo: blob() })
    await ctl.syncNow()
    expect(ctl.statusOf(it1.clientUuid)).toBe('sent')                   // the pieces arrived
    expect(ctl.photoNoteOf(it1.clientUuid)).toBe('That file is not a JPEG photo')
    expect(ctl.droppedPhotos()).toMatchObject([{ clientUuid: it1.clientUuid, qty: 80, note: 'That file is not a JPEG photo' }])
    ctl.clearDroppedPhotos()
    expect(ctl.droppedPhotos()).toEqual([])
  })
})

describe('preparing a photo', () => {
  it('shrinks a big camera picture to at most 1280 on the long side, keeping its shape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1280, height: 960 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 960, height: 1280 })
    expect(fitWithin(6000, 1000)).toEqual({ width: 1280, height: 213 })
  })
  it('never enlarges a small picture', () => {
    expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 })
    expect(fitWithin(1280, 1280)).toEqual({ width: 1280, height: 1280 })
  })
  it('refuses a picture with no size, and never makes a zero-pixel side', () => {
    expect(() => fitWithin(0, 100)).toThrow()
    expect(() => fitWithin(NaN, 100)).toThrow()
    expect(fitWithin(10000, 1)).toEqual({ width: 1280, height: 1 })
  })
  it('refuses a prepared picture under 1 KB up front: the server would only refuse it later', () => {
    expect(() => checkPrepared(null)).toThrow(/could not prepare/)
    expect(() => checkPrepared(new Blob([new Uint8Array(500)], { type: 'image/jpeg' }))).toThrow(/too small/)
    const ok = new Blob([new Uint8Array(MIN_PHOTO_BYTES)], { type: 'image/jpeg' })
    expect(checkPrepared(ok)).toBe(ok)
  })
  it('says the size in plain units', () => {
    expect(sizeText(900)).toBe('1 KB')
    expect(sizeText(182 * 1024)).toBe('182 KB')
    expect(sizeText(1.4 * 1024 * 1024)).toBe('1.4 MB')
  })
})
