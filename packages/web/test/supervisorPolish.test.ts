import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// UI/UX plan, slices 1.4 to 1.7 (supervisor screens). Source guards: they check that the lines each fix rests on are present;
// the behaviour is measured in a real browser (touch emulation) and recorded in audit/PROGRESS.md.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
const update = read('../src/pages/Update.tsx')
const login = read('../src/pages/Login.tsx')
const rule = (selector: string) => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():'=]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('1.3 the language switch on the sign-in shows both languages', () => {
  it('is a pair of buttons, one per language, each marked with its own language and pressed state', () => {
    expect(login).toMatch(/lang="ta" aria-pressed=\{lang === 'ta'\}/)
    expect(login).toMatch(/lang="en" aria-pressed=\{lang === 'en'\}/)
    expect(login).toContain("setLang('ta')")
    expect(login).toContain("setLang('en')")
  })
  it('is no longer one small text link that swaps to the other language', () => {
    expect(login).not.toMatch(/className="link"[^>]*onClick=\{\(\) => setLang\(lang === 'en'/)
  })
  it('uses the names the app already has (the same in both languages), so there is no new Tamil to review', () => {
    expect(login).toContain("t('nav.toTamil')")
    expect(login).toContain("t('nav.toEnglish')")
  })
})

describe('1.4 a button that cannot be used yet', () => {
  const disabled = rule('.btn:disabled')
  it('is a clear grey with readable ink, not a washed-out copy of the live button', () => {
    expect(disabled).toContain('var(--disabled-bg)')
    expect(disabled).toContain('var(--disabled-ink)')
    expect(disabled).not.toMatch(/opacity/)   // 55% indigo read as broken
  })
  it('keeps a visible edge and a not-allowed cursor', () => {
    expect(disabled).toContain('var(--border)')
    expect(disabled).toMatch(/cursor:\s*not-allowed/)
  })
  it('does not use the status grey: that means "no update" on an order', () => {
    expect(disabled).not.toContain('--status-grey')
  })
})

describe('1.5 the number field points at the "more than is left" question', () => {
  it('the question has an id and the field is described by it while it is open', () => {
    expect(update).toContain('id="toomany"')
    expect(update).toMatch(/aria-describedby=\{confirming \? 'hint toomany' : 'hint'\}/)
  })
  it('the field is not marked invalid for it: more than is left is allowed (over-production is real)', () => {
    expect(update).toMatch(/aria-invalid=\{notWholeNumber\(raw\)\}/)
    expect(update).not.toMatch(/aria-invalid=\{[^}]*confirming/)
  })
  it('the field gets an ink edge, never a status colour (red means order status)', () => {
    expect(update).toMatch(/confirming \? ' input--asking' : ''/)
    const asking = rule('.input--asking')
    expect(asking).toContain('var(--ink)')
    expect(asking).not.toMatch(/--status-|--accent/)
  })
})

describe('1.6 the number field takes the cursor once it exists', () => {
  it('waits for the stage to load, not for the queue (the field does not exist yet then)', () => {
    expect(update).not.toMatch(/focus\(\) \}, \[queue\]\)/)
    expect(update).toMatch(/if \(hasStage\) input\.current\?\.focus\(\)/)
    expect(update).toMatch(/\[hasStage\]\)/)
  })
})

describe('1.7 sign-in fields and the note box on a phone', () => {
  it('the supervisor sign-in fields are 56 px, set by a rule with two classes (so a later rule cannot lower them)', () => {
    expect(rule('.input.input--tall')).toContain('var(--tap-primary)')
    // Same promise through the atom (slice 2.1): both fields (the phone and the PIN) are drawn with `tall`, and `tall` is what adds the class.
    expect((login.match(/<Input[^>]*\btall=\{supervisor\}/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(readFileSync(new URL('../src/ui/atoms/Input.tsx', import.meta.url), 'utf8')).toContain("tall && 'input--tall'")
  })
  it('the note box has no resize grip on a touch screen', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{(?:[^{}]|\{[^{}]*\})*\.textarea\s*\{[^}]*resize:\s*none/)
  })
})
