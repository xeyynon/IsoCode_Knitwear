import { describe, expect, it } from 'vitest'
import { dayMonth, fill, placeholders, plural, serverWords, stageLabel, strings, SUPERVISOR_PREFIXES, translate, type Key } from '../src/i18n'
import { signInMessage } from '../src/api/sessionRules'
import { storageWarning } from '../src/queue/storageStatus'
import { syncChipStatus } from '../src/ui/syncStatus'
import type { QueueState } from '../src/queue/controller'

const keys = Object.keys(strings.en) as Key[]
const supervisorKey = (k: string) => SUPERVISOR_PREFIXES.some((p) => k.startsWith(p))

describe('strings', () => {
  it('every key has English', () => {
    for (const k of keys) expect(strings.en[k].trim(), k).not.toBe('')
  })
  it('every supervisor key has Tamil: a supervisor never meets an English word on their own screens', () => {
    const missing = keys.filter((k) => supervisorKey(k) && !strings.ta[k]?.trim())
    expect(missing).toEqual([])
  })
  it('Tamil uses exactly the placeholders English uses, so no number goes missing', () => {
    for (const k of keys) {
      const ta = strings.ta[k]
      if (ta) expect(placeholders(ta), k).toEqual(placeholders(strings.en[k]))
    }
  })
  it('Tamil is only written for keys that exist in English', () => {
    expect(Object.keys(strings.ta).filter((k) => !(k in strings.en))).toEqual([])
  })
  it('merchandiser-only keys stay English (no guessed Tamil) and fall back to it', () => {
    expect(supervisorKey('board.title')).toBe(false)
    expect(translate('ta', 'board.title')).toBe('Order board')
  })
})

describe('fill and plural', () => {
  it('puts numbers in their place in either language', () => {
    expect(translate('en', 'update.tooMany', { qty: 900, left: 120 })).toBe('900 is more than the 120 pieces left. Check the number, then tap Send again.')
    expect(translate('ta', 'update.tooMany', { qty: 900, left: 120 })).toMatch(/^900.*120/)
    expect(translate('ta', 'today.finished', { n: 3 })).toContain('3')
  })
  it('leaves a placeholder with no value visible rather than blank', () => {
    expect(fill('{n} waiting', {})).toBe('{n} waiting')
  })
  it('chooses one or other by count', () => {
    expect(plural('en', 1, 'sync.attentionOne', 'sync.attentionOther')).toBe('1 needs attention')
    expect(plural('en', 2, 'sync.attentionOne', 'sync.attentionOther')).toBe('2 need attention')
  })
})

describe('words that come from data', () => {
  it('a usual stage name is Tamil in Tamil, and any other name shows as written', () => {
    expect(stageLabel('en', 'sewing')).toBe('sewing')
    expect(stageLabel('ta', 'Sewing')).toBe(strings.ta['stage.sewing'])
    expect(stageLabel('ta', 'hand embroidery')).toBe('hand embroidery')
  })
  it('every stage key has Tamil, and its name is the lower-case word', () => {
    for (const k of keys.filter((x) => x.startsWith('stage.'))) {
      expect(strings.ta[k], k).toBeTruthy()
      expect(k).toBe(`stage.${strings.en[k].toLowerCase()}`)
    }
  })
  it("the server's English reason is shown in English only; Tamil gets the Tamil sentence", () => {
    expect(serverWords('en', 'Over the limit', 'sync.refusedGeneric')).toBe('Over the limit')
    expect(serverWords('en', undefined, 'sync.refusedGeneric')).toBe(strings.en['sync.refusedGeneric'])
    expect(serverWords('ta', 'Over the limit', 'sync.refusedGeneric')).toBe(strings.ta['sync.refusedGeneric'])
    expect(serverWords('ta', null, 'sync.photoGeneric')).not.toMatch(/[A-Za-z]{3}/)
  })
  it("a date reads the same in both languages, with the month in the reader's script", () => {
    expect(dayMonth('en', '2026-11-04')).toBe('4 Nov')
    expect(dayMonth('ta', '2026-11-04')).toBe('4 நவ')
    expect(dayMonth('ta', 'nope')).toBe('-')
    expect(dayMonth('en', '2026-13-04')).toBe('-')
  })
})

describe('supervisor messages in Tamil', () => {
  it('sign-in errors are Tamil in Tamil and keep the server wording in English', () => {
    expect(signInMessage('rejected', undefined, 'ta')).toBe(translate('ta', 'err.rejected'))
    expect(signInMessage('locked', 'Too many wrong attempts. Try again in 20 minutes.', 'ta')).toContain('20')
    expect(signInMessage('locked', 'Too many wrong attempts. Try again in 20 minutes.', 'ta')).not.toMatch(/Too many/)
    expect(signInMessage('locked', 'Too many wrong attempts. Try again in 20 minutes.')).toMatch(/20 minutes/)
    expect(signInMessage('unreachable', undefined, 'ta')).not.toMatch(/[A-Za-z]{3}/)
  })
  it('storage warnings come out in the reader\'s language', () => {
    const t = (k: Key) => translate('ta', k)
    expect(storageWarning({ durable: false, persisted: null }, 0, t)).toBe(translate('ta', 'store.notDurable'))
  })
  it('the sync chip has no English left in Tamil', () => {
    const t = (k: Key, v?: Record<string, string | number>) => translate('ta', k, v)
    const base: QueueState = { pending: 0, foreign: 0, rejected: [], foreignRejected: 0, syncing: false, online: true, error: null, lastSyncedAt: 1, durable: true }
    for (const s of [base, { ...base, pending: 3 }, { ...base, pending: 3, syncing: true }, { ...base, pending: 3, error: 'server' as const },
      { ...base, pending: 3, error: 'auth' as const }, { ...base, online: false, pending: 2 }, { ...base, online: false }, { ...base, rejected: [{}] as unknown as QueueState['rejected'] }]) {
      expect(syncChipStatus(s, t).text, JSON.stringify(s)).not.toMatch(/[A-Za-z]{3}/)
    }
  })
})
