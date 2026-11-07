import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { LAST_ROLE_KEY, autofocusFirstField, initialLoginMode, parseLastRole, readLastRole, rememberRole } from '../src/loginRules'

// UI/UX plan, slice 1.2. A Tamil-reading supervisor opened the sign-in on the merchandiser form (English "Email" and "Password"),
// had to find the other tab, and the keyboard then opened over it. The form now opens on the role last signed in on this phone.
const memory = (start: Record<string, string> = {}) => {
  const data = { ...start }
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v } }
}

describe('which form the sign-in opens on', () => {
  it('the role last signed in on this phone wins, in either language', () => {
    expect(initialLoginMode('supervisor', 'en')).toBe('supervisor')
    expect(initialLoginMode('merchandiser', 'ta')).toBe('merchandiser')
  })
  it('with nothing remembered, Tamil means supervisor and English means merchandiser', () => {
    expect(initialLoginMode(null, 'ta')).toBe('supervisor')
    expect(initialLoginMode(null, 'en')).toBe('merchandiser')
  })
  it('only the two roles are ever read back; anything else counts as nothing', () => {
    expect(parseLastRole('supervisor')).toBe('supervisor')
    expect(parseLastRole('merchandiser')).toBe('merchandiser')
    for (const bad of ['admin', '', 'Supervisor', null, undefined]) expect(parseLastRole(bad)).toBeNull()
  })
})

describe('the keyboard', () => {
  it('on a phone it waits until the role is known, so it never opens over the role switch', () => {
    expect(autofocusFirstField({ coarsePointer: true, roleKnown: false })).toBe(false)
    expect(autofocusFirstField({ coarsePointer: true, roleKnown: true })).toBe(true)
  })
  it('with a mouse the cursor goes to the first field at once', () => {
    expect(autofocusFirstField({ coarsePointer: false, roleKnown: false })).toBe(true)
  })
})

describe('remembering the role', () => {
  it('writes and reads it back', () => {
    const s = memory()
    expect(readLastRole(s)).toBeNull()
    rememberRole(s, 'supervisor')
    expect(s.data[LAST_ROLE_KEY]).toBe('supervisor')
    expect(readLastRole(s)).toBe('supervisor')
  })
  it('survives storage that is missing or throws (a private window)', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(readLastRole(broken)).toBeNull()
    expect(() => rememberRole(broken, 'supervisor')).not.toThrow()
    expect(readLastRole(null)).toBeNull()
    expect(() => rememberRole(null, 'supervisor')).not.toThrow()
  })
})

// What a unit test cannot show: the form uses these rules, and writes the role only once a sign-in has really worked
// (a wrong PIN must not change what the next person sees).
describe('Login.tsx', () => {
  const src = readFileSync(new URL('../src/pages/Login.tsx', import.meta.url), 'utf8')
  it('opens on initialLoginMode and holds the cursor back with autofocusFirstField', () => {
    expect(src).toContain('initialLoginMode(')
    expect(src).toContain('autofocusFirstField(')
  })
  it('remembers the role only after a successful sign-in', () => {
    const start = src.indexOf('async function submit')
    const submit = src.slice(start, src.indexOf('return (', start))
    expect(submit).toMatch(/if \(r\.ok\)[^\n]*rememberRole\(/)
    expect(src.match(/rememberRole\(/g)?.length).toBe(1)   // not on a tab click, not on a failed attempt
  })
  it('keeps the merchandiser tab first, so existing scripts that click the second tab still mean "supervisor"', () => {
    expect(src).toMatch(/\(\['merchandiser', 'supervisor'\] as const\)/)
  })
})
