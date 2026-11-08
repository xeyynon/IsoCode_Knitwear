import { describe, expect, it } from 'vitest'
import { personProblem, personRequest, personNotice, EMPTY_PERSON } from '../src/setup/addPerson'

// UI/UX plan, slice 5.2: one "Add a person" form with a role choice. The checks are the ones the two old forms made, moved here
// unchanged; the server checks everything again.
const sup = { ...EMPTY_PERSON, label: 'Meena', phone: '98765 43211', pin: '4821', unitId: 'u1' }
const mer = { ...EMPTY_PERSON, label: 'Ravi', email: 'ravi@example.test', password: 'correct horse battery' }

describe('a supervisor', () => {
  it('is ready with a name, a 10-digit phone, a PIN that is not easy to guess and a unit', () => {
    expect(personProblem('supervisor', sup)).toBeNull()
  })
  it('is refused, in plain words, for each missing or wrong part', () => {
    expect(personProblem('supervisor', { ...sup, label: ' ' })).toBe("Enter the supervisor's name.")
    expect(personProblem('supervisor', { ...sup, phone: '12345' })).toBe('Enter a 10-digit phone number.')
    expect(personProblem('supervisor', { ...sup, pin: '1234' })).toMatch(/too easy to guess/)
    expect(personProblem('supervisor', { ...sup, pin: '48' })).toBe('The PIN must be exactly 4 digits')
    expect(personProblem('supervisor', { ...sup, unitId: '' })).toBe('Choose the unit this supervisor works in.')
  })
  it('sends only what a supervisor needs, to the supervisors route', () => {
    expect(personRequest('supervisor', sup)).toEqual({ path: '/api/accounts/supervisors', body: { label: 'Meena', phone: '98765 43211', pin: '4821', unitId: 'u1' } })
  })
  it('says what to do next once added', () => {
    expect(personNotice('supervisor', sup)).toBe('Added Meena. Give them the phone number and PIN; they can sign in straight away.')
  })
})

describe('a merchandiser', () => {
  it('is ready with a name, an email and a password (the server checks the rest)', () => {
    expect(personProblem('merchandiser', mer)).toBeNull()
  })
  it('is refused for a missing name, email or short password', () => {
    expect(personProblem('merchandiser', { ...mer, label: '' })).toBe("Enter the merchandiser's name.")
    expect(personProblem('merchandiser', { ...mer, email: 'not an email' })).toBe('Enter an email address.')
    expect(personProblem('merchandiser', { ...mer, password: 'short' })).toBe('The password needs at least 10 characters.')
  })
  it('sends only what a merchandiser needs, to the merchandisers route', () => {
    expect(personRequest('merchandiser', mer)).toEqual({ path: '/api/accounts/merchandisers', body: { label: 'Ravi', email: 'ravi@example.test', password: 'correct horse battery' } })
  })
  it('says it was added', () => {
    expect(personNotice('merchandiser', mer)).toBe('Added Ravi.')
  })
})
