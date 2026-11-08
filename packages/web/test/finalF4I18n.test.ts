import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { stageLabel, strings, translate } from '../src/i18n'
import { signInMessage } from '../src/api/sessionRules'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const review = read('../../../audit/TAMIL-REVIEW.md')

describe('W-10: every stage the demo templates use has Tamil', () => {
  const seed = read('../../server/src/demoSeed.ts')
  // the stages named in the seed's templates (plain('Cutting', ...)) and in the order histories ({ stage: 'Cutting', ...})
  const names = [...new Set([...seed.matchAll(/plain\('([A-Za-z ]+)'/g), ...seed.matchAll(/\{ stage: '([A-Za-z ]+)', done:/g)].map((m) => m[1]!))]

  it('W-10: finds the stages in the seed (a guard on the test itself)', () => {
    expect(names).toEqual(expect.arrayContaining(['Cutting', 'Stitching', 'Printing', 'Finishing', 'Packing']))
  })
  it.each(names)('W-10: %s has a Tamil key and shows in Tamil', (name) => {
    const key = `stage.${name.toLowerCase()}` as keyof typeof strings.en
    expect(strings.en[key], key).toBe(name)
    expect(strings.ta[key]?.trim(), key).toBeTruthy()
    expect(stageLabel('ta', name)).toBe(strings.ta[key])
    expect(stageLabel('ta', name)).not.toBe(name)
  })
  it('W-10: the two new words are in the review list', () => {
    expect(review).toContain('`stage.stitching`')
    expect(review).toContain('`stage.printing`')
  })
})

describe('W-17: the lock-out message is whole in Tamil too', () => {
  const server = 'Too many wrong attempts. Try again in 20 minutes. If you forgot your PIN or password, ask your merchandiser to reset it.'
  it('W-17: English says what to do next', () => {
    expect(signInMessage('locked', server)).toMatch(/ask your merchandiser to reset it/)
    expect(translate('en', 'err.locked', { min: 20 })).toMatch(/ask your merchandiser to reset it/)
  })
  it('W-17: Tamil has the minutes and the second sentence, with no English in it', () => {
    const ta = signInMessage('locked', server, 'ta')
    expect(ta).toContain('20')
    expect(ta).toMatch(/மெர்ச்சண்டைசர/)
    expect(ta).not.toMatch(/Too many|merchandiser/)
    expect(review).toContain('`err.locked`')
  })
})

describe('W-9: "your session ended" has both languages', () => {
  it('W-9: the words exist in English and Tamil and are in the review list', () => {
    expect(strings.en['login.sessionEnded']).toBe('Your session ended. Sign in again.')
    expect(strings.ta['login.sessionEnded']?.trim()).toBeTruthy()
    expect(review).toContain('`login.sessionEnded`')
  })
})
