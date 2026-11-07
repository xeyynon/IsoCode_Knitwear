import { describe, expect, it } from 'vitest'
import { createQueueController } from '../src/queue/controller'
import { oneAtATime } from '../src/queue/oneAtATime'
import { memoryStore } from '../src/queue/sync'

describe('a double tap on Send', () => {
  const e = { orderId: 'o1', stage: 'cutting', date: '2026-11-04', qty: 50 }
  const make = () => {
    const store = memoryStore(true)
    let id = 0
    const ctl = createQueueController({ store, uuid: () => `u${++id}`, isOnline: () => false, send: async () => ({ results: [] }) })
    return { ctl, store }
  }

  it('queues one update, not two, when the second tap lands while the first is still saving', async () => {
    const { ctl, store } = make()
    const saving = { current: false }
    const send = () => oneAtATime(saving, async () => { await ctl.enqueue(e) })
    const ran = await Promise.all([send(), send()])          // same tick: no re-render in between
    expect(ran).toEqual([true, false])
    expect(store.items).toHaveLength(1)
    expect(ctl.getState().pending).toBe(1)
  })

  it('lets the next update through once the first is saved', async () => {
    const { ctl, store } = make()
    const saving = { current: false }
    await oneAtATime(saving, async () => { await ctl.enqueue(e) })
    await oneAtATime(saving, async () => { await ctl.enqueue({ ...e, qty: 20 }) })
    expect(store.items.map((i) => i.qty)).toEqual([50, 20])
  })

  it('does not stay stuck if a save fails', async () => {
    const saving = { current: false }
    await expect(oneAtATime(saving, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
    expect(saving.current).toBe(false)
  })
})
