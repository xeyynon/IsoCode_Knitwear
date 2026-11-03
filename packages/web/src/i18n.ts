import { useSyncExternalStore } from 'react'

export type Lang = 'en' | 'ta'
const KEY = 'orders.lang'

const en = {
  'status.red': 'Late risk',
  'status.amber': 'At risk',
  'status.green': 'On track',
  'status.grey': 'No update',
  'app.title': 'Order tracking',
  'nav.menu': 'Menu',
  'nav.signOut': 'Sign out',
  'nav.language': 'தமிழ்',
  'board.title': 'Order board',
  'board.all': 'All',
  'board.refresh': 'Refresh',
  'board.shortBy': 'pcs short',
  'sup.title': 'My orders today',
  'sup.send': 'Send',
  'sup.pieces': 'Pieces made',
  'sup.reason': 'Why is it slow? (optional)',
  'sup.note': 'Note (optional)',
  'sync.allSent': 'All sent',
  'sync.waiting': 'waiting',
  'sync.offline': 'Offline',
} as const
export type Key = keyof typeof en

// Tamil: the four status words come from the design doc and are TO BE CHECKED with
// supervisors before the pilot. Anything not translated falls back to English rather than
// guessing: a wrong Tamil label on a work screen is worse than an English one.
const ta: Partial<Record<Key, string>> = {
  'status.red': 'தாமத அபாயம்',
  'status.amber': 'கவனம்',
  'status.green': 'சரியான நேரம்',
  'status.grey': 'இன்று பதிவு இல்லை',
  // UNREVIEWED: written for this build, not yet read by a native speaker. Have supervisors
  // correct these before the pilot (see the design check "three supervisors read the labels").
  'sup.title': 'இன்றைய ஆர்டர்கள்',
  'sup.send': 'அனுப்பு',
  'sup.pieces': 'தயாரித்த எண்ணிக்கை',
  'sup.reason': 'ஏன் தாமதம்? (விருப்பம்)',
  'sup.note': 'குறிப்பு (விருப்பம்)',
  'sync.allSent': 'அனைத்தும் அனுப்பப்பட்டது',
  'sync.waiting': 'காத்திருக்கிறது',
  'sync.offline': 'இணைப்பு இல்லை',
}

export function translate(lang: Lang, key: Key): string {
  return (lang === 'ta' ? ta[key] : undefined) ?? en[key]
}

let current: Lang = (() => {
  try { return window.localStorage.getItem(KEY) === 'ta' ? 'ta' : 'en' } catch { return 'en' }
})()
const listeners = new Set<() => void>()

export function setLang(lang: Lang) {
  current = lang
  try { window.localStorage.setItem(KEY, lang) } catch { /* the choice just will not be remembered */ }
  document.documentElement.lang = lang
  listeners.forEach((l) => l())
}

export function useLang(): { lang: Lang; t: (k: Key) => string } {
  const lang = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => current)
  return { lang, t: (k) => translate(lang, k) }
}

if (typeof document !== 'undefined') document.documentElement.lang = current
