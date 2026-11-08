import { tenDigits, weakPin } from './setupLogic'

// The one "Add a person" form (UI/UX plan, slice 5.2): a role choice, then only the fields that role needs. Without React, so it can be tested.
// The checks for a supervisor are the ones the old "Add a supervisor" form made; the merchandiser's were only on the server, so a few
// obvious ones (name, email, password length) are said here first. The server checks everything again.

export const INDIAN_MOBILE = 'Enter an Indian mobile number: ten digits starting with 6, 7, 8 or 9'

export type PersonRole = 'supervisor' | 'merchandiser'

export interface PersonFields { label: string; phone: string; pin: string; unitId: string; email: string; password: string }
export const EMPTY_PERSON: PersonFields = { label: '', phone: '', pin: '', unitId: '', email: '', password: '' }

/** What is wrong with this person as written, in plain words, or null when it is ready to send. */
export function personProblem(role: PersonRole, f: PersonFields): string | null {
  if (!f.label.trim()) return role === 'supervisor' ? "Enter the supervisor's name." : "Enter the merchandiser's name."
  if (role === 'supervisor') {
    const phone = tenDigits(f.phone)
    if (!phone) return 'Enter a 10-digit phone number.'
    // The server's rule for a new account (adminService.ts): an Indian mobile number starts with 6, 7, 8 or 9.
    if (!/^[6-9]/.test(phone)) return INDIAN_MOBILE
    const weak = weakPin(f.pin); if (weak) return weak
    if (!f.unitId) return 'Choose the unit this supervisor works in.'
    return null
  }
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return 'Enter an email address.'
  if (f.password.length < 10) return 'The password needs at least 10 characters.'
  return null
}

/** The route and body for the role: only that role's fields, as the server expects them. */
export function personRequest(role: PersonRole, f: PersonFields): { path: string; body: Record<string, string> } {
  if (role === 'supervisor') return { path: '/api/accounts/supervisors', body: { label: f.label, phone: f.phone, pin: f.pin, unitId: f.unitId } }
  return { path: '/api/accounts/merchandisers', body: { label: f.label, email: f.email, password: f.password } }
}

export function personNotice(role: PersonRole, f: PersonFields): string {
  const name = f.label.trim()
  return role === 'supervisor' ? `Added ${name}. Give them the phone number and PIN; they can sign in straight away.` : `Added ${name || 'the merchandiser'}.`
}
