import { describe, expect, it } from 'vitest'
import { downloadProblem, exportFileName } from '../src/review/exportLogic'

describe('the saved file name', () => {
  it('uses letters and digits from the buyer name, then the day', () => {
    expect(exportFileName('Buyer B', '2026-11-04')).toBe('orders-buyer-b-2026-11-04.csv')
    expect(exportFileName('  A & B / Co. (EU)  ', '2026-11-04')).toBe('orders-a-b-co-eu-2026-11-04.csv')
  })
  it('never carries a path, a quote or a line break from the name', () => {
    const name = exportFileName('..\\..\\evil"\r\n.csv', '2026-11-04')
    expect(name).toMatch(/^orders-[a-z0-9-]+-2026-11-04\.csv$/)
  })
  it('falls back when the name has no Latin letters, and stays short', () => {
    expect(exportFileName('தமிழ்', '2026-11-04')).toBe('orders-buyer-2026-11-04.csv')
    expect(exportFileName('x'.repeat(200), '2026-11-04').length).toBeLessThan(70)
  })
})

describe('what a failed download says', () => {
  it('says the link is no good for a 401, without saying why', () => {
    expect(downloadProblem(401)).toMatch(/not valid/)
    expect(downloadProblem(401)).not.toMatch(/expired|cancel|revoked/i)
  })
  it('blames the connection for no answer or a server error, and asks to retry otherwise', () => {
    expect(downloadProblem(0)).toMatch(/connection/)
    expect(downloadProblem(503)).toMatch(/connection/)
    expect(downloadProblem(404)).toMatch(/try again/)
  })
})
