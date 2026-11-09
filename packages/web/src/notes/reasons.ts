// The fixed list of reasons a stage can be slow. The server holds the real list (so the client can change
// it without a release) and the phone caches it, but the picker must work on a first visit with no signal,
// so the same list is built in as a fallback. The ids are what is stored; the words are only labels.
export interface Reason { id: string; en: string; ta?: string }

// The Tamil wording is UNREVIEWED: supervisors must correct it before the pilot.
export const DEFAULT_REASONS: Reason[] = [
  { id: 'labour', en: 'Not enough workers', ta: 'ஆட்கள் பற்றாக்குறை' },
  { id: 'absence', en: 'Workers on leave', ta: 'ஊழியர் விடுப்பு' },
  { id: 'machine', en: 'Machine problem', ta: 'இயந்திரம் பழுது' },
  { id: 'material', en: 'Material is late', ta: 'பொருள் தாமதம்' },
  { id: 'power', en: 'No power', ta: 'மின்சாரம் இல்லை' },
  { id: 'quality', en: 'Fixing quality', ta: 'தரம் சரிசெய்தல்' },
  { id: 'other', en: 'Something else', ta: 'மற்றவை' },
]

export const MAX_NOTE = 500

/** The label in the reader's language, falling back to English rather than showing a blank. */
export const reasonLabel = (r: Reason, lang: 'en' | 'ta'): string => (lang === 'ta' && r.ta ? r.ta : r.en)

/**
 * One tap switches one reason on or off, and nothing else changes (the form review: a slow day often has several causes at once). The reasons
 * are kept in the order they were tapped, because the note the phone writes from them follows that order, and the first one tapped is the main reason.
 */
export const toggleReasons = (current: readonly string[], tapped: string): string[] =>
  current.includes(tapped) ? current.filter((id) => id !== tapped) : [...current, tapped]

/** The words for an id. An id the list does not know (an old note, a changed list) shows as itself, never as nothing. */
export function reasonById(reasons: Reason[], id: string | null | undefined): Reason | null {
  if (!id) return null
  return reasons.find((r) => r.id === id) ?? { id, en: id }
}

/** A cached or fetched list is only trusted if it is well-formed; otherwise the built-in one is used. */
export function usableReasons(list: unknown): Reason[] {
  if (!Array.isArray(list)) return DEFAULT_REASONS
  const ok = list.filter((r): r is Reason => !!r && typeof (r as Reason).id === 'string' && typeof (r as Reason).en === 'string' && (r as Reason).id.length > 0)
  return ok.length ? ok : DEFAULT_REASONS
}

/**
 * What the supervisor wrote and chose, ready to send: tidied, capped, and nothing at all if there is neither. The reasons go as a list in the order
 * tapped, and `category` (the one the server, the Review screen and the AI have always read) is the first of them. An older phone sends `category` alone.
 */
export function noteToSend(text: string, categories: readonly string[]): { text?: string; category?: string; categories?: string[] } | undefined {
  const t = text.replace(/[ 	]+/g, ' ').trim().slice(0, MAX_NOTE)
  const ids = [...new Set(categories)]
  if (!t && ids.length === 0) return undefined
  return { ...(t ? { text: t } : {}), ...(ids.length ? { category: ids[0]!, categories: ids } : {}) }
}
