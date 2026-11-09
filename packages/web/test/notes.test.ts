import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createQueueController } from '../src/queue/controller'
import { memoryStore, syncQueue } from '../src/queue/sync'
import type { BatchItemResult, QueuedEvent, SendBatch } from '../src/queue/types'
import { DEFAULT_REASONS, MAX_NOTE, noteToSend, reasonById, reasonLabel, usableReasons } from '../src/notes/reasons'

describe('the built-in reason list', () => {
  it('has seven reasons with unique ids, each with English and Tamil words', () => {
    expect(DEFAULT_REASONS.map((r) => r.id)).toEqual(['labour', 'absence', 'machine', 'material', 'power', 'quality', 'other'])
    expect(new Set(DEFAULT_REASONS.map((r) => r.id)).size).toBe(DEFAULT_REASONS.length)
    expect(DEFAULT_REASONS.every((r) => r.en && r.ta)).toBe(true)
  })

  it('matches the list the server starts with, so the phone and the server cannot drift apart', () => {
    const sql = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'db', 'migrations', '006_notes.sql'), 'utf8')
    const server = [...sql.matchAll(/"id":\s*"([a-z]+)",\s*"en":\s*"([^"]+)"/g)].map((m) => ({ id: m[1], en: m[2] }))
    expect(server.map((r) => r.id)).toEqual(DEFAULT_REASONS.map((r) => r.id))
    expect(server.map((r) => r.en)).toEqual(DEFAULT_REASONS.map((r) => r.en))
  })

  it('shows Tamil words in Tamil and falls back to English, never to nothing', () => {
    const r = { id: 'x', en: 'English only' }
    expect(reasonLabel(DEFAULT_REASONS[0]!, 'ta')).toBe('ஆட்கள் பற்றாக்குறை')
    expect(reasonLabel(DEFAULT_REASONS[0]!, 'en')).toBe('Not enough workers')
    expect(reasonLabel(r, 'ta')).toBe('English only')
  })

  it('an id the list does not know shows as itself (an old note, a changed list)', () => {
    expect(reasonById(DEFAULT_REASONS, 'machine')?.en).toBe('Machine problem')
    expect(reasonById(DEFAULT_REASONS, 'retired-reason')).toEqual({ id: 'retired-reason', en: 'retired-reason' })
    expect(reasonById(DEFAULT_REASONS, null)).toBeNull()
  })

  it('only trusts a well-formed cached or fetched list', () => {
    expect(usableReasons(null)).toBe(DEFAULT_REASONS)
    expect(usableReasons('nope')).toBe(DEFAULT_REASONS)
    expect(usableReasons([])).toBe(DEFAULT_REASONS)
    expect(usableReasons([{ id: 'a' }, null, 5, { id: '', en: 'x' }])).toBe(DEFAULT_REASONS)
    expect(usableReasons([{ id: 'a', en: 'A' }, { bad: true }])).toEqual([{ id: 'a', en: 'A' }])
  })
})

describe('what is sent for a note', () => {
  it('sends nothing for an empty note, which is the common case', () => {
    expect(noteToSend('', [])).toBeUndefined()
    expect(noteToSend('   \t ', [])).toBeUndefined()
  })
  it('sends a reason alone, words alone, or both (the reasons travel as a list, the first being the main one)', () => {
    expect(noteToSend('', ['power'])).toEqual({ category: 'power', categories: ['power'] })
    expect(noteToSend('late fabric', [])).toEqual({ text: 'late fabric' })
    expect(noteToSend('late fabric', ['material'])).toEqual({ text: 'late fabric', category: 'material', categories: ['material'] })
  })
  it('tidies spaces and never sends more than the server allows', () => {
    expect(noteToSend('  a   b\t\tc ', [])).toEqual({ text: 'a b c' })
    expect(noteToSend('x'.repeat(900), [])!.text).toHaveLength(MAX_NOTE)
  })
  it('keeps Tamil text exactly as typed', () => {
    const t = 'இன்று மூன்று இயந்திரங்கள் வேலை செய்யவில்லை'
    expect(noteToSend(t, ['machine'])).toEqual({ text: t, category: 'machine', categories: ['machine'] })
  })
})

describe('a note travels with its update through the offline queue', () => {
  let seq = 0
  const item = (over: Partial<QueuedEvent> = {}): QueuedEvent => ({
    clientUuid: `n-${++seq}`, orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 100, createdAt: seq, status: 'pending', attempts: 0, ...over,
  })
  const server = () => {
    const seen: any[] = []
    const send: SendBatch = async (b) => { seen.push(...b); return { results: b.map((e): BatchItemResult => ({ clientUuid: e.clientUuid, result: 'accepted' })) } }
    return { seen, send }
  }

  it('is included in the request, and left out when there is none', async () => {
    const store = memoryStore(); const s = server()
    await store.add(item({ clientUuid: 'with', note: { text: 'power cut', category: 'power' } }))
    await store.add(item({ clientUuid: 'without' }))
    await syncQueue(store, s.send)
    expect(s.seen.find((e) => e.clientUuid === 'with').note).toEqual({ text: 'power cut', category: 'power' })
    expect('note' in s.seen.find((e) => e.clientUuid === 'without')).toBe(false)
  })

  it('is kept safely while offline and sent, once, with the update when the signal returns', async () => {
    const store = memoryStore(true); const s = server(); let online = false
    const ctl = createQueueController({ store, isOnline: () => online, send: s.send, uuid: (() => { let n = 0; return () => `u${++n}` })() })
    await ctl.enqueue({ orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 60, note: { text: 'இயந்திரம் பழுது', category: 'machine' } })
    expect(s.seen).toEqual([])
    expect(store.items[0]!.note).toEqual({ text: 'இயந்திரம் பழுது', category: 'machine' })
    online = true
    await ctl.syncNow(); await ctl.syncNow()
    expect(s.seen).toHaveLength(1)
    expect(s.seen[0].note).toEqual({ text: 'இயந்திரம் பழுது', category: 'machine' })
  })

  it('is still there on a retry after a failed send', async () => {
    const store = memoryStore(); const s = server()
    await store.add(item({ clientUuid: 'a', note: { category: 'labour' } }))
    let first = true
    await syncQueue(store, async (b) => { if (first) { first = false; throw Object.assign(new Error('x'), { status: 0 }) } return s.send(b) })
    expect(store.items[0]!.note).toEqual({ category: 'labour' })
    await syncQueue(store, s.send)
    expect(s.seen[0].note).toEqual({ category: 'labour' })
  })

  it('carries every reason, in the order tapped, to the server; an older queued update with one reason alone still sends exactly as before', async () => {
    const store = memoryStore(); const s = server()
    await store.add(item({ clientUuid: 'many', note: { category: 'machine', categories: ['machine', 'labour', 'material'] } }))
    await store.add(item({ clientUuid: 'old', note: { text: 'power cut', category: 'power' } }))   // queued by a build that knew one reason
    await syncQueue(store, s.send)
    expect(s.seen.find((e) => e.clientUuid === 'many').note).toEqual({ category: 'machine', categories: ['machine', 'labour', 'material'] })
    expect(s.seen.find((e) => e.clientUuid === 'old').note).toEqual({ text: 'power cut', category: 'power' })
    expect('categories' in s.seen.find((e) => e.clientUuid === 'old').note).toBe(false)
  })

  it('FORM: the reasons survive being kept offline (the queue stores the whole note)', async () => {
    const store = memoryStore(true); const s = server(); let online = false
    const ctl = createQueueController({ store, isOnline: () => online, send: s.send, uuid: (() => { let n = 0; return () => `m${++n}` })() })
    await ctl.enqueue({ orderId: 'o1', stage: 'sewing', date: '2026-11-04', qty: 60, note: { text: 'x', category: 'power', categories: ['power', 'absence'] } })
    expect(store.items[0]!.note?.categories).toEqual(['power', 'absence'])
    online = true
    await ctl.syncNow(); await ctl.syncNow()
    expect(s.seen[0].note.categories).toEqual(['power', 'absence'])
  })

  it('travels alongside a photo', async () => {
    const store = memoryStore(); const s = server()
    await store.add(item({ clientUuid: 'a', photo: new Blob([new Uint8Array(2000)]), photoUuid: 'p1', note: { text: 'see photo' } }))
    await syncQueue(store, s.send, async () => ({ id: 'photo-9' }))
    expect(s.seen[0]).toMatchObject({ photoId: 'photo-9', note: { text: 'see photo' } })
  })
})
