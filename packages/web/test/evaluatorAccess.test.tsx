// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EvaluatorAccess } from '../src/ui/organisms/EvaluatorAccess'
import { DEMO_ACCESS, masked } from '../src/demo/demoAccess'

describe('evaluator access on the sign-in screen (hosted demo only)', () => {
  afterEach(cleanup)
  it('shows the login for the chosen role with the secret hidden until asked', () => {
    render(<EvaluatorAccess mode="merchandiser" onUse={() => undefined} />)
    expect(screen.getByText('merch@companya.test')).toBeTruthy()
    expect(screen.queryByText('demo knitwear 2026')).toBeNull()
    expect(screen.getByText(masked('demo knitwear 2026'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show the password' }))
    expect(screen.getByText('demo knitwear 2026')).toBeTruthy()
  })

  it('"Use these" fills both fields, and a supervisor can be picked by unit', () => {
    const onUse = vi.fn()
    render(<EvaluatorAccess mode="supervisor" onUse={onUse} />)
    fireEvent.click(screen.getByRole('button', { name: 'Unit 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use these' }))
    expect(onUse).toHaveBeenCalledWith(DEMO_ACCESS.supervisor[2]!.id, DEMO_ACCESS.supervisor[2]!.secret)
    expect(screen.getByRole('status').textContent).toMatch(/Filled in/)
  })

  it('links each buyer page by its fragment, so the token is never sent to a server log', () => {
    render(<EvaluatorAccess mode="merchandiser" onUse={() => undefined} />)
    for (const a of screen.getAllByRole('link')) expect(a.getAttribute('href')).toMatch(/^\/buyer#bl_/)
  })
})
