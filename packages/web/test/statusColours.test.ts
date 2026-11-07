import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Rule 10: red, amber and green mean order status only. The public status page shows system health,
// so its Up and Down words stay neutral and the word itself carries the meaning.
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('the status page', () => {
  for (const sel of ['.checks .ok', '.checks .bad']) {
    it(`colours ${sel} with a neutral token, not an order-status one`, () => {
      const re = new RegExp(`${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`, 'g')
      const bodies = [...css.matchAll(re)].map((m) => m[1]!)
      expect(bodies.length).toBeGreaterThan(0)
      for (const b of bodies) expect(b).not.toMatch(/--status-|--red|--amber|--green/)
    })
  }
})
