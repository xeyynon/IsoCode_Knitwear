import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { strings } from '../src/i18n'

// The form review (10 Nov 2026), wiring checks on the Update page: reasons are several, the note writes itself and is never overwritten,
// and every reason is submitted. The behaviour itself is tested in noteDraft.test.ts, reasonChips.test.tsx and reasonsMulti.test.ts.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const update = read('../src/pages/Update.tsx')

describe('Update.tsx', () => {
  it('draws the reasons with the shared multi-select chips, not a radio group', () => {
    expect(update).toContain('<ReasonChips')
    expect(update).not.toMatch(/type="radio"|toggleReason\(/)
  })
  it('lets the note follow the choices only through the draft rules (a typed note is never overwritten)', () => {
    expect(update).toMatch(/from '\.\.\/notes\/noteDraft'/)
    expect(update).toMatch(/onSelect\(/)
    expect(update).toMatch(/onEdit\(/)
    expect(update).toMatch(/rewrite\(/)
  })
  it('submits all the reasons in the order tapped', () => {
    expect(update).toMatch(/noteToSend\(draft\.text, selected\)/)
  })
  it('an unsent reason or note still holds back the "new version" banner', () => {
    expect(update).toMatch(/const unsent = [^\n]*selected\.length > 0/)
  })
  it('clears the reasons and the note after a send', () => {
    expect(update).toMatch(/setSelected\(\[\]\)/)
    expect(update).toMatch(/setDraft\(initialDraft\(\)\)/)
  })
})

describe('the words of the new form', () => {
  const keys = ['sup.reasonCount', 'sup.noteGenerated', 'sup.noteRewrite', 'sup.noteOtherHint', 'sup.savedZero'] as const
  it('each has English and Tamil, and a Tamil screen shows no English in them', () => {
    for (const k of keys) {
      expect(strings.en[k], k).toBeTruthy()
      expect(strings.ta[k], k).toBeTruthy()
      expect(strings.ta[k]!.replace(/\{\w+\}/g, ''), k).not.toMatch(/[A-Za-z]/)
    }
  })
  it('the generated-note label says it is editable', () => {
    expect(strings.en['sup.noteGenerated']).toMatch(/edit/i)
  })
  it('the new Tamil is a draft listed for supervisors to review', () => {
    const review = read('../../../audit/TAMIL-REVIEW.md')
    for (const k of keys) expect(review, k).toContain(`\`${k}\``)
    const src = read('../src/i18n.ts')
    for (const k of keys) expect(src.split('\n').find((l) => l.includes(`'${k}'`) && /[஀-௿]/.test(l)) ?? '', k).toContain('DRAFT, unreviewed')
  })
})
