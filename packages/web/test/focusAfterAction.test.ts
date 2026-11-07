import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// An action that removes the control that had focus must hand focus on, or it falls to <body>
// and the next Tab starts again from the top of the page (frontendskill.md 8.3).
const src = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

describe('focus after a control is removed', () => {
  it('Update: picking or removing a photo focuses the button that replaced the old one', () => {
    const s = src('pages/Update.tsx')
    expect(s).toMatch(/ref=\{addPhoto\}/)
    expect(s).toMatch(/ref=\{removePhoto\}/)
    expect(s).toMatch(/ref=\{retakePhoto\}/)
    expect(s).toMatch(/\(photo \? \(retaking\.current \? retakePhoto : removePhoto\) : addPhoto\)\.current\?\.focus\(\)/)   // a retake keeps focus on Retake
    expect(s.match(/photoFocus\.current = true/g)?.length).toBe(2)       // after the pick and on Remove
  })
  it('Today: Remove on a refused update focuses the box heading, or the first stage once the box is gone', () => {
    const s = src('pages/Today.tsx')
    expect(s).toMatch(/<h2 tabIndex=\{-1\} ref=\{refusedHeading\}>/)
    expect(s).toMatch(/removed\.current = true; void queue\.ctl\.discard/)
    expect(s).toMatch(/refusedHeading\.current \?\? main\.current\?\.querySelector<HTMLElement>\('\.stage__go'\)/)
  })
  it('Setup People: Save PIN puts focus back on Reset PIN', () => {
    const s = src('setup/PeopleTab.tsx')
    expect(s).toMatch(/id=\{`reset-\$\{a\.id\}`\}/)
    expect(s).toMatch(/setPinFor\(null\); setNewPin\(''\); document\.getElementById\(`reset-\$\{a\.id\}`\)\?\.focus\(\)/)
  })
  it('Setup People: a refused PIN is shown beside the PIN field, not in the banner at the top of the tab', () => {
    const s = src('setup/PeopleTab.tsx')
    expect(s).not.toMatch(/if \(w\) return setError\(w\)/)
    expect(s).toMatch(/if \(w\) return setPinError\(w\)/)
    expect(s).toMatch(/<p className="error" id=\{`pin-err-\$\{a\.id\}`\} role="alert">\{pinError\}<\/p>/)
    expect(s).toMatch(/aria-invalid=\{pinError \? true : undefined\} aria-describedby=\{pinError \? `pin-err-\$\{a\.id\}` : undefined\}/)
    expect(s).toMatch(/, setPinError\)/)                                    // a server refusal of the PIN lands there too
  })
  it('Review: Cancel link focuses the buyer links heading', () => {
    const s = src('pages/Review.tsx')
    expect(s).toMatch(/<h2 [^>]*tabIndex=\{-1\} ref=\{linksHeading\}>/)
    expect(s).toMatch(/await load\(\); linksHeading\.current\?\.focus\(\)/)
  })
})
