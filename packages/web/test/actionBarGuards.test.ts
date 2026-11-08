import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Source guards for slice 1.1 (UI/UX plan): what jsdom cannot show. They check that the lines the fix rests on are there; the
// behaviour itself is measured in a real browser by `npm run ux` ("Send in view"). Each was shown to fail with its line removed.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const update = read('../src/pages/Update.tsx')
const bannerSrc = read('../src/ui/UpdateBanner.tsx')
const barCss = read('../src/ui/molecules/ActionBar.css').replace(/\/\*[\s\S]*?\*\//g, '')
const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
const html = read('../index.html').replace(/<!--[\s\S]*?-->/g, '')   // the page's own comment says "no user-scalable=no"

const rule = (source: string, selector: string) => new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? ''

describe('the Send bar on the Update screen', () => {
  it('holds Send, the saved line and the "more than is left" question, inside the bar', () => {
    const open = update.indexOf('<ActionBar>'), close = update.indexOf('</ActionBar>')
    expect(open).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(open)
    const inside = update.slice(open, close)
    expect(inside).toContain("t('sup.send')")                 // the button
    expect(inside).toContain('className="saved"')              // "Saved ... Sent." must stay in view after a send
    expect(inside).toContain("t('update.tooMany'")            // the question about the number sits with the button it concerns
    expect(inside).toContain('role="status"')                  // and is still announced
  })

  it('keeps the bar inside the form, and Send a submit button with btn--big (e2e, snapshots and a11y find it that way)', () => {
    const form = update.indexOf('<form'), bar = update.indexOf('<ActionBar>'), endForm = update.indexOf('</form>')
    expect(form).toBeGreaterThan(-1)
    expect(bar).toBeGreaterThan(form)
    expect(endForm).toBeGreaterThan(update.indexOf('</ActionBar>'))
    // Same promise through the atom (slice 2.x): Send is the filled, full-width, big Button with no `type="button"` (so it submits the form);
    // test/atoms.test.tsx proves that these three props draw `btn btn--primary btn--block btn--big`.
    expect(update).toMatch(/<Button variant="primary" block size="big" disabled=/)
    expect(update).not.toMatch(/<Button variant="primary" block size="big"[^>]*type="button"/)
  })
})

describe('the bar sticks to the bottom of the screen', () => {
  const bar = rule(barCss, '.actionbar')
  it('is sticky at bottom 0 and clears the home indicator', () => {
    expect(bar).toMatch(/position:\s*sticky/)
    expect(bar).toMatch(/bottom:\s*0/)
    expect(bar).toContain('safe-area-inset-bottom')
  })
  it('is drawn above the new-version bar', () => {
    const z = (s: string) => Number(/z-index:\s*(\d+)/.exec(s)?.[1])
    expect(z(bar)).toBeGreaterThan(z(rule(css, '.updatebar')))
  })
  it('has no transform, animation or overflow of its own (they break sticky and fixed children)', () => {
    expect(barCss).not.toMatch(/\b(transform|animation|overflow)\s*:/)
  })
  it('leaves room so a focused field is not left under it', () => {
    expect(barCss).toMatch(/scroll-padding-bottom/)
  })
})

describe('the new-version bar and the Send bar share the bottom of the screen', () => {
  it('the banner draws itself into the slot when a bar has published one', () => {
    expect(bannerSrc).toContain('createPortal(')
    expect(bannerSrc).toContain('subscribeBottomSlot')
  })
  it('inside the slot it is not pinned to the screen a second time', () => {
    expect(rule(barCss, '.actionbar__slot .updatebar')).toMatch(/position:\s*static/)
  })
})

describe('the keyboard', () => {
  it('resizes the page, so a bottom bar sits above the on-screen keyboard on Android (Chrome 108+)', () => {
    expect(html).toMatch(/<meta name="viewport"[^>]*interactive-widget=resizes-content/)
  })
  it('keeps pinch-zoom allowed', () => {
    expect(html).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/)
  })
})
