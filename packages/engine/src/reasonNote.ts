// The note a supervisor does not have to type: written from the reasons they tapped. Pure, shared by the phone (to fill the note box) and
// the server (to know a note is exactly that, so no AI call is needed and the English meaning is already known).
//
// Order matters: the reasons come in the order they were tapped, and the sentence follows that order ("machine problem, not enough
// workers, material is late" reads machine first). The first one tapped is the main reason (the existing single `category`).
//
// English follows the product owner's examples. Tamil is a DRAFT written by the front-end session and has NOT been reviewed by supervisors
// (audit/TAMIL-REVIEW.md): single reasons are short sentences, and several reasons are joined as a list of the same labels the reason
// chips already show, which avoids guessing Tamil grammar for every combination.

export type NoteLang = 'en' | 'ta'

/** The ids of the seeded reason list (settings `reason_categories`, migration 006), in list order. */
export const REASON_IDS = ['labour', 'absence', 'machine', 'material', 'power', 'quality', 'other'] as const
export type ReasonId = (typeof REASON_IDS)[number]

/** The most reasons one note can carry: the whole list. */
export const MAX_REASONS = REASON_IDS.length

const isReasonId = (id: string): id is ReasonId => (REASON_IDS as readonly string[]).includes(id)

/** One reason on its own: a whole sentence. */
const ONE: Record<NoteLang, Record<ReasonId, string>> = {
  en: {
    labour: 'Production was slower due to insufficient workforce availability.',
    absence: 'Production was affected by worker absences.',
    machine: 'Production was delayed due to machine-related issues.',
    material: 'Production was affected by delayed material availability.',
    power: 'Production was interrupted due to a power outage.',
    quality: 'Additional time was required for quality inspection and corrections.',
    other: 'Additional operational circumstances affected production.',
  },
  // DRAFT, unreviewed (audit/TAMIL-REVIEW.md)
  ta: {
    labour: 'போதுமான ஆட்கள் இல்லாததால் உற்பத்தி மெதுவாக இருந்தது.',
    absence: 'ஊழியர்கள் விடுப்பில் இருந்ததால் உற்பத்தி பாதிக்கப்பட்டது.',
    machine: 'இயந்திரப் பழுதால் உற்பத்தி தாமதமானது.',
    material: 'பொருள் தாமதமாக வந்ததால் உற்பத்தி பாதிக்கப்பட்டது.',
    power: 'மின்சாரம் இல்லாததால் உற்பத்தி தடைபட்டது.',
    quality: 'தரம் சரிபார்த்துச் சரிசெய்ய கூடுதல் நேரம் தேவைப்பட்டது.',
    other: 'வேறு சூழ்நிலைகள் உற்பத்தியைப் பாதித்தன.',
  },
}

/** Each reason as a phrase that fits after "due to". */
const PHRASE: Record<NoteLang, Record<ReasonId, string>> = {
  en: {
    labour: 'limited workforce availability',
    absence: 'worker absences',
    machine: 'machine-related issues',
    material: 'delayed material supply',
    power: 'a power outage',
    quality: 'extra time for quality checks and corrections',
    other: 'other circumstances',
  },
  // DRAFT, unreviewed: the same words as the reason chips
  ta: {
    labour: 'ஆட்கள் பற்றாக்குறை',
    absence: 'ஊழியர் விடுப்பு',
    machine: 'இயந்திரம் பழுது',
    material: 'பொருள் தாமதம்',
    power: 'மின்சாரம் இல்லை',
    quality: 'தரம் சரிசெய்தல்',
    other: 'மற்றவை',
  },
}

/** "a", "a and b", "a, b, and c" (English); "a", "a மற்றும் b", "a, b மற்றும் c" (Tamil, draft). */
function join(lang: NoteLang, parts: string[]): string {
  if (parts.length === 1) return parts[0]!
  const and = lang === 'en' ? 'and' : 'மற்றும்'
  if (parts.length === 2) return `${parts[0]} ${and} ${parts[1]}`
  const head = parts.slice(0, -1).join(', ')
  return lang === 'en' ? `${head}, ${and} ${parts[parts.length - 1]}` : `${head} ${and} ${parts[parts.length - 1]}`
}

/**
 * The reasons that count: known ids only, each once, the first tap first. Anything else (an id that has left the list, a repeat) is dropped,
 * never an error: a note from an older phone must still read sensibly.
 */
export function cleanReasonIds(ids: readonly string[] | null | undefined): ReasonId[] {
  const seen = new Set<ReasonId>()
  for (const id of ids ?? []) if (isReasonId(id) && !seen.has(id)) seen.add(id)
  return [...seen]
}

/**
 * The note for these reasons, in this language. Empty for none. One reason is its own sentence; several are one sentence
 * ("Production was slower due to machine-related issues, limited workforce availability, and delayed material supply.").
 */
export function composeReasonNote(lang: NoteLang, ids: readonly string[] | null | undefined): string {
  const list = cleanReasonIds(ids)
  if (list.length === 0) return ''
  if (list.length === 1) return ONE[lang][list[0]!]
  const phrases = join(lang, list.map((id) => PHRASE[lang][id]))
  return lang === 'en' ? `Production was slower due to ${phrases}.` : `${phrases} காரணமாக உற்பத்தி மெதுவாக இருந்தது.`
}
