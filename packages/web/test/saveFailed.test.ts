import { describe, expect, it } from 'vitest'
import { saveFailedKey } from '../src/queue/storageStatus'
import { translate } from '../src/i18n'

describe('an update the phone could not store', () => {
  it('says the phone is full when storage ran out', () => {
    const full = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    expect(saveFailedKey(full)).toBe('update.saveFailedFull')
  })

  it('gives a plain "not saved" for any other failure', () => {
    expect(saveFailedKey(new Error('boom'))).toBe('update.saveFailed')
    expect(saveFailedKey(undefined)).toBe('update.saveFailed')
  })

  it('has words in English and Tamil for both', () => {
    for (const k of ['update.saveFailed', 'update.saveFailedFull'] as const) {
      expect(translate('en', k).length).toBeGreaterThan(10)
      expect(translate('ta', k)).not.toBe(translate('en', k))
    }
  })
})
