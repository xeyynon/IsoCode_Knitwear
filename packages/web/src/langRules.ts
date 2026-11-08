// Which language a person starts in. Pure, so the rule is tested without a browser.
//
// Supervisors work in Tamil, so a supervisor who has never picked a language gets Tamil at sign-in.
// Anyone else stays in English, and a merchandiser always does: they have no language switch. A pick made with the language switch always wins; a language that
// was only a default is replaced by the next person's default, so a merchandiser who signs in on a
// phone a supervisor used is not left in Tamil.
import type { Lang } from './i18n'
import type { Role } from './api/sessionRules'

export type StoredLang = { lang: Lang | null; chosen: boolean }

/**
 * Read the two stored values. A language stored with no marker was written by the language switch
 * (the only thing that wrote it before defaults existed), so it is a choice; "default" marks the
 * one this app picked. Anything else counts as nothing stored.
 */
export function parseStoredLang(lang: string | null, source: string | null): StoredLang {
  if (lang !== 'en' && lang !== 'ta') return { lang: null, chosen: false }
  return { lang, chosen: source !== 'default' }
}

/** The language to show once this role has signed in, and whether it is a person's choice or our default. */
export function languageAfterSignIn(role: Role, stored: StoredLang): { lang: Lang; chosen: boolean } {
  // A merchandiser's screens are English only (only fragments of them have Tamil), so a Tamil left on this phone does not apply to them.
  if (role === 'merchandiser') return { lang: 'en', chosen: false }
  if (stored.chosen && stored.lang) return { lang: stored.lang, chosen: true }
  return { lang: role === 'supervisor' ? 'ta' : 'en', chosen: false }
}
