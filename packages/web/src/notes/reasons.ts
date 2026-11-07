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

/** One tap picks a reason; tapping the chosen one again clears it (a radio cannot un-check itself, so the tap decides). */
export const toggleReason = (current: string | null, tapped: string): string | null => (current === tapped ? null : tapped)

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

/** What the supervisor typed, ready to send: tidied, capped, and nothing at all if it is empty. */
export function noteToSend(text: string, category: string | null): { text?: string; category?: string } | undefined {
  const t = text.replace(/[ \t]+/g, ' ').trim().slice(0, MAX_NOTE)
  if (!t && !category) return undefined
  return { ...(t ? { text: t } : {}), ...(category ? { category } : {}) }
}
