// Which sign-in form a person sees first. Pure, so the rules are tested without a browser (UI/UX plan, slice 1.2).
//
// The sign-in has two forms: a merchandiser's email and password, and a supervisor's phone number and PIN. It used to open on the
// merchandiser's every time, so a Tamil-reading supervisor met English "Email" and "Password" first, had to find the other tab,
// and the keyboard opened over it. Now it opens on the role last signed in on this phone.
import type { Lang } from './i18n'

export type LoginMode = 'merchandiser' | 'supervisor'
export const LAST_ROLE_KEY = 'orders.lastRole'

/** What was stored: a role we know, or nothing. Anything else (an old value, another app's) counts as nothing. */
export function parseLastRole(raw: string | null | undefined): LoginMode | null {
  return raw === 'merchandiser' || raw === 'supervisor' ? raw : null
}

/**
 * The form to open on. The role last signed in on this phone wins. With nothing remembered, a phone already in Tamil is most
 * likely a supervisor's (merchandisers work in English), so it opens on the supervisor form; anyone else gets the merchandiser's.
 */
export function initialLoginMode(last: LoginMode | null, lang: Lang): LoginMode {
  if (last) return last
  return lang === 'ta' ? 'supervisor' : 'merchandiser'
}

/**
 * Whether to put the cursor in the first field as the page opens. On a phone that raises the keyboard, which covers the role
 * switch, so it waits until the role is known (remembered). With a mouse there is no keyboard to cover anything.
 */
export function autofocusFirstField({ coarsePointer, roleKnown }: { coarsePointer: boolean; roleKnown: boolean }): boolean {
  return !coarsePointer || roleKnown
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** Every storage access is in try/catch: a private window or blocked site data can throw, and the page must still work. */
export function readLastRole(store: Store | null): LoginMode | null {
  try { return parseLastRole(store?.getItem(LAST_ROLE_KEY)) } catch { return null }
}
export function rememberRole(store: Store | null, role: LoginMode): void {
  try { store?.setItem(LAST_ROLE_KEY, role) } catch { /* nothing is lost: the next sign-in just opens on the default */ }
}
