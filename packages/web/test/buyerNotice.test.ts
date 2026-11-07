import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BuyerNotice, orderKey } from '../src/pages/Buyer'

describe('the key of an order card on the buyer page', () => {
  it('differs for the same PO in two colours or two styles, as orders are unique by PO, style and colour', () => {
    const keys = [
      orderKey({ po: 'P1', style: 'tee', colour: 'black' }),
      orderKey({ po: 'P1', style: 'tee', colour: 'white' }),
      orderKey({ po: 'P1', style: 'polo', colour: 'black' }),
    ]
    expect(new Set(keys).size).toBe(3)
  })
})

describe('a notice on the buyer page', () => {
  it.each([['late_risk', 'Late risk'], ['attention', 'Needs attention']] as const)('says %s in buyer words, with no internal status colour', (severity, word) => {
    const html = renderToStaticMarkup(createElement(BuyerNotice, { severity }))
    expect(html).toContain(word)
    expect(html).not.toMatch(/badge--(red|amber|green|grey)/)   // rule 18: a buyer never sees the board colours
    expect(html).not.toContain('At risk')                       // the internal amber word
  })
})
