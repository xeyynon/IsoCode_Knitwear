import { useSyncExternalStore } from 'react'
import { languageAfterSignIn, parseStoredLang, type StoredLang } from './langRules'
import type { Role } from './api/sessionRules'

export type Lang = 'en' | 'ta'
const KEY = 'orders.lang'

// Keys are grouped by screen. Every key under a SUPERVISOR_PREFIXES group is shown to a supervisor
// and must have Tamil (a test enforces it). Numbers and names go in as {placeholders}, never by
// gluing strings together, because Tamil puts them in a different place in the sentence.
const en = {
  'status.red': 'Late risk',
  'status.amber': 'At risk',
  'status.green': 'On track',
  'status.grey': 'No update',
  'app.title': 'Order tracking',
  'app.updateReady': 'A new version is ready. Reload when you have finished.',
  'app.updateReload': 'Reload',
  'app.updateLater': 'Later',
  // Shared: the menu, loading, the reload card
  'nav.menu': 'Menu',
  'nav.signOut': 'Sign out',
  'nav.toTamil': 'தமிழ்',
  'nav.toEnglish': 'English',
  'common.loading': 'Loading',
  'common.tryAgain': 'Try again',
  'common.ok': 'OK',
  'common.remove': 'Remove',
  'common.skip': 'Skip to main content',
  // Confirmation dialogs on merchandiser screens (English only: no supervisor prefix)
  'confirm.cancel': 'Cancel',
  // The full-size photo view on merchandiser screens (English only: no supervisor prefix)
  'viewer.open': 'View full size',
  // The build label and "What's new" in the menu of merchandiser screens (English only: no supervisor prefix)
  'release.whatsNew': "What's new",
  'release.close': 'Close',
  'release.none': 'No release notes yet.',
  // The keyboard shortcuts help on merchandiser screens (English only: no supervisor prefix)
  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.note': 'Shortcuts do not work while you are typing in a field.',
  'shortcuts.search': 'Search the board',
  'shortcuts.board': 'Go to the board',
  'shortcuts.review': 'Go to review',
  'shortcuts.setup': 'Go to setup',
  'shortcuts.help': 'Show this list',
  'shortcuts.then': 'then',
  'shortcuts.close': 'Close',
  'viewer.close': 'Close',
  'viewer.hint': 'Scroll, or pinch to zoom',
  'confirm.signOutTitle': 'Sign {name} out everywhere?',
  'confirm.signOutBody': 'They are signed out on every phone and can sign in again.',
  'confirm.signOutYes': 'Sign out everywhere',
  'confirm.stopTitle': 'Stop {name}?',
  'confirm.stopBody': 'They are signed out at once and cannot sign in until you allow it again.',
  'confirm.stopYes': 'Stop account',
  'confirm.deleteTemplateTitle': 'Delete the template "{name}"?',
  'confirm.deleteTemplateBody': 'Orders already made from it are not affected.',
  'confirm.deleteTemplateYes': 'Delete template',
  'chunk.title': 'This screen did not load',
  'chunk.body': 'The app may have been updated. Reload to get the latest version.',
  'chunk.reload': 'Reload',
  // Sign in (the supervisor parts and the shared parts; the merchandiser's email and password stay English)
  'login.title': 'Sign in',
  'login.sessionEnded': 'Your session ended. Sign in again.',
  'login.who': 'Who is signing in',
  'login.merchandiser': 'Merchandiser',
  'login.supervisor': 'Supervisor',
  'login.phone': 'Phone number',
  'login.pin': '4-digit PIN',
  'login.signingIn': 'Signing in…',
  'err.rejected': 'Incorrect details. Check and try again.',
  'err.locked': 'Too many wrong attempts. Try again in {min} minutes. If you forgot your PIN or password, ask your merchandiser to reset it.',
  'err.rateLimited': 'Too many attempts. Please wait a few minutes.',
  'err.invalid': 'Please fill in every field.',
  'err.clock': "This device's date or time looks wrong, so the sign-in could not be kept. Set the correct date and time, then try again.",
  'err.unreachable': 'Cannot reach the server right now. Check your connection and try again.',
  // The one "cannot reach the server" card every screen shows when a load fails (ui/LoadFailed).
  'err.cantReach': "Can't reach the server. Check the connection and try again.",
  'err.workSafe': 'Your work saved on this phone is safe.',
  'err.retry': 'Retry',
  'err.checkStatus': 'Check server status',
  'err.notFoundTitle': 'Page not found',
  'err.notFound': 'That page does not exist.',
  'err.notFoundBack': "Back to today's orders",
  // Merchandiser board (not translated: merchandisers read English)
  'board.title': 'Order board',
  'board.all': 'All',
  'board.refresh': 'Refresh',
  'board.shortBy': 'pcs short',
  // Supervisor: shared by My orders today and the daily update
  'sup.title': 'My orders today',
  'sup.send': 'Send',
  'sup.pieces': 'Pieces made',
  'sup.wholeNumber': 'Only whole numbers, like 350. Check the number.',
  'sup.reason': 'Why is it slow? (optional)',
  'sup.note': 'Note (optional)',
  'sup.savedOne': 'Saved {qty} piece',
  'sup.savedOther': 'Saved {qty} pieces',
  'sup.savedPhoto': ' with a photo',
  'sup.savedNote': ' and a note',
  // Supervisor: My orders today
  'today.attention': 'Updates that need attention',
  'today.refusedLine': 'pieces on {date}: {reason}',
  'today.droppedLine': 'pieces, {stage}, {date}: {note}',
  'today.savedList': 'No connection. Showing your list saved on {date} at {time}.',
  'today.loading': 'Loading your orders',
  'today.loadFailed': 'Could not load your orders.',
  'today.nothing': 'Nothing to update right now.',
  'today.nothingNext': 'New orders appear here when your merchandiser sets them up.',
  'today.today': 'Today',
  'today.done': 'Done',
  'today.due': 'Due',
  'today.update': 'Update',
  'today.finished': 'Finished ({n})',
  'today.progress': '{n} of {m} updated today',
  'today.countsFor': 'Counts go to {date}',
  // Supervisor: the daily update
  'update.due': 'due {date}',
  'update.todaySoFar': 'Today so far',
  'update.left': 'Left',
  'update.next': 'Next: {po} · {stage}',
  'update.hint': "Enter the pieces made since your last update. They are added to today's total.",
  'update.notInList': 'This stage is not in your list.',
  'update.tooMany': '{qty} is more than the {left} pieces left. Check the number, then tap Send again.',
  'update.sendAnyway': 'Send {qty} anyway',
  'update.saveFailed': 'Not saved. This update could not be stored on the phone. Tap Send to try again.',
  'update.saveFailedFull': 'Not saved. The phone is full. Free some space or remove the photo, then tap Send again.',
  'photo.add': 'Add a photo',
  'photo.preparing': 'Preparing…',
  'photo.input': 'Take or choose a photo',
  'photo.alt': 'The photo that will be sent with this update',
  'photo.ready': 'Photo ready ({size})',
  'photo.remove': 'Remove photo',
  'photo.retake': 'Retake photo',
  'photo.notPicture': 'That file is not a picture.',
  'photo.unreadable': 'That picture could not be read. Try taking it again.',
  'photo.cannotPrepare': 'This phone cannot prepare pictures.',
  'photo.couldNotPrepare': 'This phone could not prepare the picture.',
  'photo.tooSmall': 'That picture is too small or blank to send. Take it again.',
  'photo.noSize': 'The picture has no size.',
  'photo.unusable': 'That picture could not be used.',
  // Supervisor: the sync chip
  'sync.allSent': 'All sent',
  'sync.sent': 'Sent.',
  'sync.waitingToSend': '{n} waiting to send.',
  'sync.waitingN': '{n} waiting',
  'sync.offline': 'Offline',
  'sync.offlineWaiting': 'Offline · {n} waiting',
  'sync.sendingWaiting': 'Sending… {n} waiting',
  'sync.waitingFailed': '{n} waiting · could not send',
  'sync.refusedCount': 'Not accepted · {n}',
  'sync.refusedGeneric': 'The server could not accept this update.',
  'sync.photoGeneric': 'The photo was not accepted.',
  'sync.signInAgain': 'Sign in again to send {n} waiting',
  'sync.tryNow': 'Try now',
  'sync.notAccepted': 'Not accepted',
  'sync.photoNotAccepted': 'Photo not accepted, pieces sent',
  'sync.attentionOne': '{n} needs attention',
  'sync.attentionOther': '{n} need attention',
  'sync.foreignOne': '{n} from another sign-in waits for that person',
  'sync.foreignOther': '{n} from another sign-in wait for that person',
  'sync.foreignRejected': '{n} from another sign-in not accepted',
  // Supervisor: phone storage warnings
  'store.notDurable': 'This phone cannot keep updates safely. Do not close the app until they are sent.',
  'store.lowSpace': 'Phone storage is almost full. Free some space so updates are not lost.',
  'store.homeScreen': 'Add this app to your home screen so waiting updates are kept safely.',
  // Supervisor: the usual stage names. A stage is free text from the template, so one not listed
  // here shows as the template wrote it. The key is "stage." + the name in lower case.
  'stage.knitting': 'Knitting',
  'stage.linking': 'Linking',
  'stage.mending': 'Mending',
  'stage.washing': 'Washing',
  'stage.sewing': 'Sewing',
  'stage.cutting': 'Cutting',
  'stage.trimming': 'Trimming',
  'stage.ironing': 'Ironing',
  'stage.finishing': 'Finishing',
  'stage.checking': 'Checking',
  'stage.packing': 'Packing',
  'stage.dispatch': 'Dispatch',
  'stage.stitching': 'Stitching',
  'stage.printing': 'Printing',
} as const
export type Key = keyof typeof en

/** Key groups a supervisor sees. Each key in them must have Tamil. */
export const SUPERVISOR_PREFIXES = ['status.', 'app.', 'nav.', 'common.', 'chunk.', 'login.', 'err.', 'sup.', 'today.', 'update.', 'photo.', 'sync.', 'store.', 'stage.'] as const

// Tamil: the four status words come from the design doc and are TO BE CHECKED with
// supervisors before the pilot. Anything not translated falls back to English rather than
// guessing: a wrong Tamil label on a work screen is worse than an English one.
const ta: Partial<Record<Key, string>> = {
  'status.red': 'தாமத அபாயம்',
  'status.amber': 'கவனம்',
  'status.green': 'சரியான நேரம்',
  'status.grey': 'இன்று பதிவு இல்லை',
  // Language names are written in their own language in both tables.
  'nav.toTamil': 'தமிழ்',
  'nav.toEnglish': 'English',
  // UNREVIEWED: written for this build, not yet read by a native speaker. Have supervisors
  // correct these before the pilot (see the design check "three supervisors read the labels").
  'app.title': 'ஆர்டர் கண்காணிப்பு',
  'app.updateReady': 'புதிய பதிப்பு தயார். வேலை முடிந்ததும் மீண்டும் ஏற்றவும்.',
  'app.updateReload': 'மீண்டும் ஏற்று',
  'app.updateLater': 'பிறகு',
  'nav.menu': 'மெனு',
  'nav.signOut': 'வெளியேறு',
  'common.loading': 'ஏற்றுகிறது',
  'common.tryAgain': 'மீண்டும் முயற்சி',
  'common.ok': 'சரி',
  'common.remove': 'நீக்கு',
  'common.skip': 'முதன்மைப் பகுதிக்குச் செல்',   // DRAFT, unreviewed (TAMIL-REVIEW.md)
  'chunk.title': 'இந்தத் திரை திறக்கவில்லை',
  'chunk.body': 'ஆப் புதுப்பிக்கப்பட்டிருக்கலாம். புதிய பதிப்பைப் பெற மீண்டும் ஏற்றவும்.',
  'chunk.reload': 'மீண்டும் ஏற்று',
  'login.title': 'உள்நுழை',
  'login.sessionEnded': 'உங்கள் உள்நுழைவு முடிந்தது. மீண்டும் உள்நுழையுங்கள்.',   // DRAFT, unreviewed (TAMIL-REVIEW.md)
  'login.who': 'யார் உள்நுழைகிறார்',
  'login.merchandiser': 'மெர்ச்சண்டைசர்',
  'login.supervisor': 'மேற்பார்வையாளர்',
  'login.phone': 'போன் எண்',
  'login.pin': '4 இலக்க PIN',
  'login.signingIn': 'உள்நுழைகிறது…',
  'err.rejected': 'விவரங்கள் தவறு. சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
  'err.locked': 'பல முறை தவறு. {min} நிமிடம் கழித்து முயற்சிக்கவும். PIN மறந்துவிட்டால், மெர்ச்சண்டைசரிடம் அதை மாற்றச் சொல்லுங்கள்.',   // second sentence DRAFT, unreviewed (TAMIL-REVIEW.md)
  'err.rateLimited': 'பல முயற்சிகள். சில நிமிடங்கள் காத்திருக்கவும்.',
  'err.invalid': 'எல்லா இடங்களையும் நிரப்பவும்.',
  'err.clock': 'இந்த போனின் தேதி அல்லது நேரம் தவறாக உள்ளது, அதனால் உள்நுழைவு நிற்கவில்லை. சரியான தேதி, நேரத்தை அமைத்து மீண்டும் முயற்சிக்கவும்.',
  'err.unreachable': 'இப்போது சர்வரை அணுக முடியவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
  'err.cantReach': 'சர்வரை அணுக முடியவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
  'err.workSafe': 'இந்த போனில் சேமித்த உங்கள் பணி பாதுகாப்பாக உள்ளது.',
  'err.retry': 'மீண்டும் முயற்சி',
  'err.checkStatus': 'சர்வர் நிலையைப் பார்',
  'err.notFoundTitle': 'பக்கம் இல்லை',   // DRAFT, unreviewed (TAMIL-REVIEW.md)
  'err.notFound': 'அந்தப் பக்கம் இல்லை.',   // DRAFT, unreviewed
  'err.notFoundBack': 'இன்றைய ஆர்டர்களுக்குத் திரும்பு',   // DRAFT, unreviewed
  'sup.title': 'இன்றைய ஆர்டர்கள்',
  'sup.send': 'அனுப்பு',
  'sup.pieces': 'தயாரித்த எண்ணிக்கை',
  'sup.wholeNumber': 'முழு எண் மட்டும், உதாரணம் 350. எண்ணைச் சரிபார்க்கவும்.',
  'sup.reason': 'ஏன் தாமதம்? (விருப்பம்)',
  'sup.note': 'குறிப்பு (விருப்பம்)',
  'sup.savedOne': '{qty} துண்டு சேமிக்கப்பட்டது',
  'sup.savedOther': '{qty} துண்டுகள் சேமிக்கப்பட்டன',
  'sup.savedPhoto': ', புகைப்படத்துடன்',
  'sup.savedNote': ', குறிப்புடன்',
  'today.attention': 'கவனிக்க வேண்டிய பதிவுகள்',
  'today.refusedLine': 'துண்டுகள், {date}: {reason}',
  'today.droppedLine': 'துண்டுகள், {stage}, {date}: {note}',
  'today.savedList': 'இணைப்பு இல்லை. {date} அன்று {time} மணிக்குச் சேமித்த பட்டியல் காட்டப்படுகிறது.',
  'today.loading': 'உங்கள் ஆர்டர்கள் ஏற்றப்படுகின்றன',
  'today.loadFailed': 'உங்கள் ஆர்டர்களை ஏற்ற முடியவில்லை.',
  'today.nothing': 'இப்போது பதிவு செய்ய எதுவும் இல்லை.',
  'today.nothingNext': 'புதிய ஆர்டர்களை மெர்ச்சண்டைசர் சேர்த்ததும் அவை இங்கே தெரியும்.',   // DRAFT, unreviewed (TAMIL-REVIEW.md)
  'today.today': 'இன்று',
  'today.done': 'முடிந்தது',
  'today.due': 'கெடு',
  'today.update': 'பதிவு செய்',
  'today.finished': 'முடிந்தவை ({n})',
  'today.progress': 'இன்று {m} இல் {n} பதிவு செய்யப்பட்டது',   // DRAFT, unreviewed (audit/TAMIL-REVIEW.md)
  'today.countsFor': '{date} தேதிக்கான எண்ணிக்கை',   // DRAFT, unreviewed
  'update.due': 'கெடு {date}',
  'update.todaySoFar': 'இன்று இதுவரை',
  'update.left': 'மீதம்',
  'update.next': 'அடுத்தது: {po} · {stage}',   // DRAFT, unreviewed
  'update.hint': 'கடைசி பதிவுக்குப் பிறகு செய்த துண்டுகளை உள்ளிடவும். அவை இன்றைய மொத்தத்தில் சேர்க்கப்படும்.',
  'update.notInList': 'இந்த நிலை உங்கள் பட்டியலில் இல்லை.',
  'update.tooMany': '{qty}, மீதமுள்ள {left} துண்டுகளை விட அதிகம். எண்ணைச் சரிபார்த்து, மீண்டும் அனுப்பு அழுத்தவும்.',
  'update.sendAnyway': 'இருந்தாலும் {qty} அனுப்பு',
  'update.saveFailed': 'சேமிக்கப்படவில்லை. இந்தப் பதிவை போனில் சேமிக்க முடியவில்லை. மீண்டும் முயல அனுப்பு அழுத்தவும்.',
  'update.saveFailedFull': 'சேமிக்கப்படவில்லை. போன் நிரம்பியுள்ளது. இடத்தை விடுவிக்கவும் அல்லது புகைப்படத்தை நீக்கவும், பிறகு மீண்டும் அனுப்பு அழுத்தவும்.',
  'photo.add': 'புகைப்படம் சேர்',
  'photo.preparing': 'தயாராகிறது…',
  'photo.input': 'புகைப்படம் எடு அல்லது தேர்வு செய்',
  'photo.alt': 'இந்தப் பதிவுடன் அனுப்பப்படும் புகைப்படம்',
  'photo.ready': 'புகைப்படம் தயார் ({size})',
  'photo.remove': 'புகைப்படத்தை நீக்கு',
  'photo.retake': 'புகைப்படத்தை மீண்டும் எடு',
  'photo.notPicture': 'அந்தக் கோப்பு புகைப்படம் இல்லை.',
  'photo.unreadable': 'புகைப்படத்தைப் படிக்க முடியவில்லை. மீண்டும் எடுக்கவும்.',
  'photo.cannotPrepare': 'இந்த போனில் புகைப்படத்தைத் தயார் செய்ய முடியாது.',
  'photo.couldNotPrepare': 'இந்த போனால் புகைப்படத்தைத் தயார் செய்ய முடியவில்லை.',
  'photo.tooSmall': 'புகைப்படம் மிகச் சிறியது அல்லது வெறுமையாக உள்ளது. மீண்டும் எடுக்கவும்.',
  'photo.noSize': 'புகைப்படத்துக்கு அளவு இல்லை.',
  'photo.unusable': 'இந்தப் புகைப்படத்தைப் பயன்படுத்த முடியவில்லை.',
  'sync.allSent': 'அனைத்தும் அனுப்பப்பட்டது',
  'sync.sent': 'அனுப்பப்பட்டது.',
  'sync.waitingToSend': '{n} அனுப்பக் காத்திருக்கிறது.',
  'sync.waitingN': '{n} காத்திருக்கிறது',
  'sync.offline': 'இணைப்பு இல்லை',
  'sync.offlineWaiting': 'இணைப்பு இல்லை · {n} காத்திருக்கிறது',
  'sync.sendingWaiting': 'அனுப்புகிறது… {n} காத்திருக்கிறது',
  'sync.waitingFailed': '{n} காத்திருக்கிறது · அனுப்ப முடியவில்லை',
  'sync.refusedCount': 'ஏற்கப்படவில்லை · {n}',
  'sync.refusedGeneric': 'இந்தப் பதிவை சர்வர் ஏற்கவில்லை.',
  'sync.photoGeneric': 'புகைப்படம் ஏற்கப்படவில்லை.',
  'sync.signInAgain': 'காத்திருக்கும் {n} பதிவுகளை அனுப்ப மீண்டும் உள்நுழையவும்',
  'sync.tryNow': 'இப்போது முயற்சி செய்',
  'sync.notAccepted': 'ஏற்கப்படவில்லை',
  'sync.photoNotAccepted': 'புகைப்படம் ஏற்கப்படவில்லை, எண்ணிக்கை அனுப்பப்பட்டது',
  'sync.attentionOne': '{n} கவனிக்க வேண்டும்',
  'sync.attentionOther': '{n} கவனிக்க வேண்டும்',
  'sync.foreignOne': 'வேறு நபரின் {n} பதிவு அவருக்காகக் காத்திருக்கிறது',
  'sync.foreignOther': 'வேறு நபரின் {n} பதிவுகள் அவருக்காகக் காத்திருக்கின்றன',
  'sync.foreignRejected': 'வேறு நபரின் {n} பதிவுகள் ஏற்கப்படவில்லை',
  'store.notDurable': 'இந்த போனில் பதிவுகளைப் பாதுகாப்பாக வைக்க முடியாது. அனுப்பப்படும் வரை ஆப்பை மூட வேண்டாம்.',
  'store.lowSpace': 'போன் சேமிப்பகம் கிட்டத்தட்ட நிரம்பிவிட்டது. பதிவுகள் இழக்காமல் இருக்க இடத்தைக் காலி செய்யவும்.',
  'store.homeScreen': 'காத்திருக்கும் பதிவுகள் பாதுகாப்பாக இருக்க, இந்த ஆப்பை முகப்புத் திரையில் சேர்க்கவும்.',
  'stage.knitting': 'பின்னல்',
  'stage.linking': 'லிங்கிங்',
  'stage.mending': 'மெண்டிங்',
  'stage.washing': 'வாஷிங்',
  'stage.sewing': 'தையல்',
  'stage.cutting': 'கட்டிங்',
  'stage.trimming': 'டிரிம்மிங்',
  'stage.ironing': 'அயர்னிங்',
  'stage.finishing': 'ஃபினிஷிங்',
  'stage.checking': 'சோதனை',
  'stage.packing': 'பேக்கிங்',
  'stage.dispatch': 'அனுப்புதல்',
  'stage.stitching': 'ஸ்டிச்சிங்',   // DRAFT, unreviewed (TAMIL-REVIEW.md)
  'stage.printing': 'பிரிண்டிங்',   // DRAFT, unreviewed (TAMIL-REVIEW.md)
}

/** Both tables, read-only, for the tests that check coverage and placeholders. */
export const strings: { readonly en: Readonly<Record<Key, string>>; readonly ta: Readonly<Partial<Record<Key, string>>> } = { en, ta }

export type Vars = Record<string, string | number>

/** Put values into {placeholders}. A placeholder with no value is left as it is, so a gap is visible, never blank. */
export function fill(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

/** The {placeholders} a string uses, for the tests. */
export const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

export function translate(lang: Lang, key: Key, vars?: Vars): string {
  return fill((lang === 'ta' ? ta[key] : undefined) ?? en[key], vars)
}

/** The "one" or "other" key for a count, filled with {n} unless `vars` says otherwise. */
export function plural(lang: Lang, n: number, one: Key, other: Key, vars: Vars = { n }): string {
  return translate(lang, new Intl.PluralRules(lang).select(n) === 'one' ? one : other, vars)
}

/** "Saved 1 piece" / "Saved 350 pieces", plus what went with it, in the chosen language. */
export function savedText(lang: Lang, qty: number, photo: boolean, note: boolean): string {
  return plural(lang, qty, 'sup.savedOne', 'sup.savedOther', { qty })
    + (photo ? translate(lang, 'sup.savedPhoto') : '') + (note ? translate(lang, 'sup.savedNote') : '') + '.'
}

/** A stage name for the reader: Tamil for the usual ones, otherwise (and always in English) the name as the template wrote it. */
export function stageLabel(lang: Lang, name: string): string {
  if (lang !== 'ta') return name
  const key = `stage.${name.trim().toLowerCase()}`
  return key in ta ? translate(lang, key as Key) : name
}

/**
 * Words the server or the sync wrote in English (why an update was refused, why a photo was left
 * out). English readers get them as written; Tamil readers get the plain Tamil sentence for `generic`.
 */
export function serverWords(lang: Lang, text: string | null | undefined, generic: Key): string {
  const words = text?.trim()
  return lang === 'en' && words ? words : translate(lang, generic)
}

const TA_MONTHS = ['ஜன', 'பிப்', 'மார்', 'ஏப்', 'மே', 'ஜூன்', 'ஜூலை', 'ஆக', 'செப்', 'அக்', 'நவ', 'டிச']
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "4 Nov" / "4 நவ" from a YYYY-MM-DD date; "-" when it is not one. */
export function dayMonth(lang: Lang, iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  const month = m ? (lang === 'ta' ? TA_MONTHS : EN_MONTHS)[Number(m[2]) - 1] : undefined
  return m && month ? `${Number(m[3])} ${month}` : '-'
}

// The language is stored with a marker when it was only our default for a role, never a person's pick (langRules.ts).
const SOURCE_KEY = 'orders.lang.src'
const readStored = (): StoredLang => {
  try { return parseStoredLang(window.localStorage.getItem(KEY), window.localStorage.getItem(SOURCE_KEY)) } catch { return { lang: null, chosen: false } }
}
const writeStored = (lang: Lang, chosen: boolean) => {
  try {
    window.localStorage.setItem(KEY, lang)
    if (chosen) window.localStorage.removeItem(SOURCE_KEY); else window.localStorage.setItem(SOURCE_KEY, 'default')
  } catch { /* the choice just will not be remembered */ }
}

let current: Lang = readStored().lang ?? 'en'
const listeners = new Set<() => void>()

function show(lang: Lang) {
  current = lang
  if (typeof document !== 'undefined') document.documentElement.lang = lang
  listeners.forEach((l) => l())
}

export const getLang = (): Lang => current

/** The language switch: always a choice, and it wins over any default from then on. */
export function setLang(lang: Lang) {
  writeStored(lang, true)
  show(lang)
}

/** At sign-in (and when the app opens already signed in): a supervisor who never chose gets Tamil; a choice is kept. */
export function applySignInLanguage(role: Role | undefined) {
  if (!role) return
  const next = languageAfterSignIn(role, readStored())
  // A merchandiser is shown English without writing it down: what is stored on this phone may be a supervisor's own choice.
  if (role !== 'merchandiser') writeStored(next.lang, next.chosen)
  show(next.lang)
}

export type T = (k: Key, vars?: Vars) => string

export function useLang(): { lang: Lang; t: T } {
  const lang = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => current)
  return { lang, t: (k, vars) => translate(lang, k, vars) }
}

if (typeof document !== 'undefined') document.documentElement.lang = current
