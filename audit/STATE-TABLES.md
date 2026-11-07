# State tables for the phase 1 components

Written before the components are built (plan slice 0.5; rule: `packages/web/src/ui/README.md`). The states below are the ones the app **already has** (read from `pages/Update.tsx`, `ui/syncStatus.ts` and `styles.css`), plus what each new component must keep. Every row becomes a test. Order status and sync status never share a look: sync is neutral (ink, muted, indigo dot), order status is red, amber, green and grey with an icon and a word.

## 1. Quantity field (the pieces number on Update)

| State | Looks and behaves like | Source today | Test |
| --- | --- | --- | --- |
| Empty | Visible label, 56 px, centred 28 px number, numeric keypad; Send off | `raw === ''` | Send is disabled |
| Typing a whole number | Value shown as typed; Send on | `parsePieces` returns a number | Send enabled |
| Not a whole number (`-5`, `12.5`, text) | Message in words, "Only whole numbers, like 350. Check the number."; `aria-invalid`; Send off; nothing repaired silently | `notWholeNumber(raw)` | Message shown; Send disabled; value unchanged |
| More than is left | Allowed (over-production is real). First Send tap shows the question and the button reads "Send N anyway"; the field points at the question with `aria-describedby` and an ink border (not `aria-invalid`, not red) | `overLeft` and `confirming` | First tap sends nothing; second tap sends once |
| Storage not ready | Send off | `!queue` | Send disabled |
| Saving | Send off while one send is running | `busy` | No second send from a double tap |
| Disabled | A clear grey look (`--disabled-bg`, `--disabled-ink`, 4.5:1), not a pale indigo | slice 1.4 | Contrast pair checked |

## 2. Send and the bottom ActionBar

The bar holds, top to bottom: the failure or saved line, the "more than is left" question, and Send. It stays in reach at the bottom of the screen; it never covers the number field when that is focused; it never hides the saved line.

| State | Shown in the bar | Test |
| --- | --- | --- |
| Nothing entered | Send, off | Send fully visible at 390x844 |
| Ready | Send, on, 56 px or more on touch | Height measured on touch in `npm run ux` |
| Question open | The question text, then "Send N anyway" | Both visible together |
| Saved on the phone, not yet sent | "Saved on this phone", pending note | Never says "sent" |
| Sent | "Sent" only after the server confirmed that update | Not shown before |
| Server refused | "Not accepted" with the reason in words (or a plain Tamil sentence) | Pieces are not lost |
| Photo dropped | "Photo not accepted": the pieces still went | Pieces counted |
| Could not save (storage full) | The failure, in words | Old "Saved" line is gone |
| New version ready | The new-version bar appears **inside the same bottom area**, above Send; it never covers the saved line | Both readable at once |
| Keyboard open | Send above the keyboard on Android (`interactive-widget=resizes-content`); a focused field is never under the bar (`scroll-padding-bottom`) | Real phone only; desktop proves the bar sticks |

## 3. Sync chip (already built; kept, with its looks pinned)

From `syncChipStatus`. Tone is ok (indigo dot), wait (muted dot) or problem (ink border).

| State | Text (English) | Tone |
| --- | --- | --- |
| Signed out with updates waiting | "Sign in again to send N waiting" | problem |
| Offline with updates waiting | "Offline · N waiting" | wait |
| Offline, nothing waiting | "Offline" | wait |
| Sending | "Sending… N waiting" | wait |
| Online, waiting, last try failed | "N waiting · could not send" | problem |
| Online, waiting | "N waiting" | wait |
| A refused update is left | "Not accepted · N" | problem |
| Everything confirmed | "All sent" | ok |

Rule kept: "All sent" only when nothing waits and nothing was refused; it never means the order is on track. A change between states is noticed (slice 4.4) without green and without motion when the user asks for reduced motion.

## 4. Button

| State | Looks and behaves like |
| --- | --- |
| Default | Border, surface, ink text, `--tap-min` high (44 mouse, 48 phone) |
| Primary | Indigo fill, white text; one per screen where possible |
| Primary block (Send, Sign in) | Full width, `--tap-primary` (56 px) **also on touch** (slice 1.0) |
| Small | 36 px with a mouse, `--tap-min` on a phone |
| Strong (destructive confirm) | 2 px ink border, never red |
| Hover, focus-visible | 3 px indigo focus ring with offset; never removed |
| Disabled | `--disabled-bg`, `--disabled-ink`, kept border; says why when the reason is not obvious |
| Pressed | Native; no custom motion |
| Busy | Disabled, label unchanged (no spinner on Send: "saved on the phone" is instant) |

Tamil: labels may wrap to two lines; the button grows, never truncates (`html[lang='ta'] .btn { height: auto }`).

## 5. Field (label, input, hint, error)

| State | Looks like |
| --- | --- |
| Empty, valid, focused | Visible label above, 44/48 px input, 3:1 border, focus ring |
| Hint | Muted text tied with `aria-describedby` |
| Invalid | Message in words below, `role="alert"`, `aria-invalid`, 2 px red-text border only for a real input error (not for "more than is left") |
| Disabled, read-only | Disabled look as in the button table |
| Long Tamil label, long value | Wraps; nothing clipped |
