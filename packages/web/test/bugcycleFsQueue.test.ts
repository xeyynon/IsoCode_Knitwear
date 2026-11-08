import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createQueueController, type QueueState } from '../src/queue/controller'
import { memoryStore } from '../src/queue/sync'
import type { BatchItemResult, SendBatch } from '../src/queue/types'
import { syncChipStatus } from '../src/ui/syncStatus'
import { translate } from '../src/i18n'

// Final bug cycle (9 Nov 2026): FE-S-06. A reply lost on the way back leaves the update on the server and on the phone; the phone retries
// within seconds (the same id, so the server stores it once) and says "trying again" until a second failure, not "could not send".
const tick = () => new Promise((r) => setTimeout(r, 5))

describe('FE-S-06: after a lost reply the phone tries again within seconds, and never sends a second copy', () => {
  it('FE-S-06: the first failure schedules its own retry; the retry sends the same id once and the queue empties', async () => {
    const store = memoryStore(); const seen: string[] = []; let calls = 0
    const send: SendBatch = async (b) => {
      calls++; seen.push(...b.map((e) => e.clientUuid))
      if (calls === 1) throw new Error('network: the reply was lost')   // the server has it; the phone never heard
      return { results: b.map((e): BatchItemResult => ({ clientUuid: e.clientUuid, result: 'duplicate' as BatchItemResult['result'] })) }
    }
    const ctl = createQueueController({ store, send, isOnline: () => true, retryDelaysMs: [20, 40, 80] })
    const item = await ctl.enqueue({ orderId: 'o1', stage: 'Stitching', date: '2026-11-06', qty: 100 })
    await ctl.syncNow()
    expect(ctl.getState().pending).toBe(1)
    expect(ctl.getState().failedTries).toBe(1)
    await new Promise((r) => setTimeout(r, 120))   // no one tapped "Try now" and no 30 s timer ran
    await tick()
    expect(ctl.getState().pending).toBe(0)
    expect(ctl.getState().failedTries).toBe(0)
    expect(new Set(seen).size).toBe(1)             // one id, tried twice
    expect(seen[0]).toBe(item.clientUuid)
  })
})

describe('FE-S-06: what the chip says', () => {
  const base = { pending: 1, foreign: 0, rejected: [], foreignRejected: 0, syncing: false, online: true, error: 'server', lastSyncedAt: null, durable: true } as unknown as QueueState
  const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('en', k, v)
  it('FE-S-06: the first failure is calm ("trying again"), a second one is the honest "could not send"', () => {
    const first = syncChipStatus({ ...base, failedTries: 1 }, t as never)
    expect(first.tone).toBe('wait')
    expect(first.text).toMatch(/trying again/i)
    const second = syncChipStatus({ ...base, failedTries: 2 }, t as never)
    expect(second.tone).toBe('problem')
    expect(second.text).toMatch(/could not send/i)
  })
  it('FE-S-06: the new words have Tamil, marked as a draft and listed for review', () => {
    expect(translate('ta', 'sync.retrying', { n: 2 })).toMatch(/[஀-௿]/)
    expect(readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8')).toMatch(/'sync\.retrying':[^\n]*DRAFT, unreviewed/)
    expect(readFileSync(new URL('../../../audit/TAMIL-REVIEW.md', import.meta.url), 'utf8')).toContain('`sync.retrying`')
  })
})
