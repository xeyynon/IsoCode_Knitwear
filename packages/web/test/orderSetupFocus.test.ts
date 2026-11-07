import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// The error banner on the new-order form only exists after the first failed Create, so focus has to move
// AFTER React has rendered it. Calling focus() in the click handler found a null ref on the first failure.
describe('new order: the first failed Create moves focus to the error summary', () => {
  const src = readFileSync(new URL('../src/pages/OrderSetup.tsx', import.meta.url), 'utf8')

  it('does not focus the banner inside the submit handler', () => {
    const submit = src.slice(src.indexOf('async function submit'), src.indexOf('const err ='))
    expect(submit).not.toMatch(/errorsRef\.current\??\.focus/)
  })

  it('focuses the banner in an effect that runs after each failed submit', () => {
    expect(src).toMatch(/useEffect\(\(\) => \{[^}]*errorsRef\.current\?\.focus\(\)[^}]*\}, \[failedTries\]\)/)
  })
})
