import { describe, expect, it } from 'vitest'
import { createAsker, type ConfirmRequest } from '../src/ui/confirmAsker'

const req = (title: string): ConfirmRequest => ({ title, body: 'b', confirmLabel: 'Yes', cancelLabel: 'No' })

function setup() {
  const seen: (ConfirmRequest | null)[] = []
  return { seen, asker: createAsker<ConfirmRequest>((r) => seen.push(r)) }
}

describe('confirmation asker', () => {
  it('resolves true when confirmed and clears the open question', async () => {
    const { asker, seen } = setup()
    const p = asker.ask(req('one'))
    expect(seen).toEqual([req('one')])
    asker.answer(true)
    await expect(p).resolves.toBe(true)
    expect(seen.at(-1)).toBeNull()
  })
  it('resolves false when cancelled', async () => {
    const { asker } = setup()
    const p = asker.ask(req('one'))
    asker.answer(false)
    await expect(p).resolves.toBe(false)
  })
  it('a second question settles the first as no and then asks the second', async () => {
    const { asker, seen } = setup()
    const first = asker.ask(req('one'))
    const second = asker.ask(req('two'))
    await expect(first).resolves.toBe(false)
    expect(seen.at(-1)).toEqual(req('two'))
    asker.answer(true)
    await expect(second).resolves.toBe(true)
  })
  it('cancel (the screen went away) settles an open question as no, and does nothing when none is open', async () => {
    const { asker, seen } = setup()
    asker.cancel()
    expect(seen).toEqual([])
    const p = asker.ask(req('one'))
    asker.cancel()
    await expect(p).resolves.toBe(false)
  })
  it('an answer with nothing open is ignored, and a question is answered only once', async () => {
    const { asker } = setup()
    asker.answer(true)
    const p = asker.ask(req('one'))
    asker.answer(false)
    asker.answer(true)
    await expect(p).resolves.toBe(false)
  })
})
