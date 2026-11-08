import { describe, expect, it } from 'vitest'
import { duplicateFault } from '../src/errors.js'

describe('BE-040: the case-insensitive email index has its own plain wording', () => {
  it('BE-040: a case-only email clash answers 409 with the email wording, not the generic one', () => {
    const e = duplicateFault({ code: '23505', constraint: 'account_email_lower_key' })
    expect(e?.status).toBe(409)
    expect(e?.message).toBe('That email already has an account')
  })
  it('BE-040: the older index names keep their wording', () => {
    expect(duplicateFault({ code: '23505', constraint: 'account_email_key' })?.message).toBe('That email already has an account')
    expect(duplicateFault({ code: '23505', constraint: 'unknown_key' })?.message).toMatch(/already exists/)
  })
})
