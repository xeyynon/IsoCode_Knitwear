import { describe, expect, it } from 'vitest'
import { matchRoutes } from 'react-router-dom'
import { stageFromParam, stageHref } from '../src/stages/stageLink'

// The same route App.tsx declares for the Update screen.
const routes = [{ path: '/today/:orderId/:stage' }]
const roundTrip = (stage: string) => {
  const m = matchRoutes(routes, stageHref('o1', stage))
  return stageFromParam(m?.[0]?.params.stage ?? '')
}

describe('the link from Today to a stage', () => {
  it('opens the Update screen for any stage name a template accepts', () => {
    expect(roundTrip('cutting')).toBe('cutting')
    expect(roundTrip('50% check')).toBe('50% check')    // the router already decodes: a second decode throws
    expect(roundTrip('a%20b')).toBe('a%20b')            // ...or turns it into a different stage
    expect(roundTrip('pack / ship #2')).toBe('pack / ship #2')
  })
})
