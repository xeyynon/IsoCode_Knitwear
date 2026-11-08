# Design direction: which UI/UX patterns we use, and how, 2026-11-08

> **Superseded in part by `audit/POA-UIUX.md` (v2).** After research: no coach mark (NN/g), Undo in the page rather than in a toast, skeletons only after measuring, and new supervisor words need Tamil because a test requires it. Where the two disagree, the plan wins.

Method: **Atomic Design**. Everything is built from atoms, then molecules, organisms, templates and pages.
Evidence for the choices comes from this repo's hard rules (the front-end guide, section 2), the audits in `audit/`, and the code (`packages/web/src`).

## 1. The combination we are choosing

| Layer | Pattern | Why for this product |
| --- | --- | --- |
| Structure | **Atomic Design** | The same button, field, card and alert are written by hand about 60, 34, 26 and 26 times. One fix (a disabled style, a touch size) should be one edit. |
| Layout | **Mobile-first, responsive** | The supervisor is the user the product is designed around. The CSS is mostly desktop-first now (6 `max-width` queries, 3 `min-width`). |
| Components | **Material, lightly** | Top app bar, chips, bottom primary action, elevation only on things that float (menu, dialogs). No ripples, no heavy shadows. |
| Scan order | **F-pattern** (merchandiser) and **Z-pattern** (sign-in, supervisor card) | Decides where status, the working and the action sit. |
| Feedback | **Skeletons, empty states, micro-interactions, toast with undo** | Trust: the supervisor must see "saved on phone" turn into "sent"; a merchandiser must be able to undo a slip. |
| Process | **Design Thinking** | The pilot is the research: three supervisors read the Tamil, five working days live, the five-second test, the daylight test. |
| Used once, narrowly | **Bento** | A key-facts strip at the top of Order detail only. |

## 2. Every pattern, with a verdict

Verdicts: **Use**, **Adapt** (a smaller version fits), **Not now**, **Never** (breaks a hard rule).

| Pattern | Verdict | Where it fits here, or the rule it breaks |
| --- | --- | --- |
| Atomic Design | **Use** | The method for everything below (section 4). |
| Mobile-first | **Use** | Write the 390 px layout as the base and add columns with `min-width`. Start with the board and Order detail, which are desktop-first today. |
| Material Design | **Adapt** | Keep the app bar and chips (already there). The floating action button becomes a **sticky bottom bar** with the one primary action on supervisor screens. Elevation only on menu, dialogs, toasts. |
| Bento grid | **Adapt** | Order detail header: tiles for Quantity, Ex-factory, Shortfall, Projected finish. Not on the board ("the table is the dashboard"), not on the buyer page. |
| Tabs and segmented controls | **Adapt** | Already used (sign-in role, Setup sections, Review jump bar). Fix the semantics, remember the last role on a phone, one visual style. |
| Breadcrumbs | **Adapt** | The hierarchy is two levels deep, so use one consistent back trail ("Board › B-PO-88240", "Setup › Closed days"). It replaces the three different back-link wordings now in use. |
| Stepper / wizard | **Adapt, later** | Not for the supervisor update (three taps is the goal) and not for New order (one page is faster on a desktop). It fits a **pilot setup checklist** in Setup: units, then closed days, then templates, then people, because that order is a real dependency. |
| Micro-interactions | **Use** | Only ones that carry trust: the sync chip changing from "waiting" to "sent", "Saved on this phone" to "Sent", "Copied" on a buyer link. Respect `prefers-reduced-motion`. No decoration. |
| Skeleton screens | **Use** | Board and Today lists instead of a spinner, keeping the 180 ms delay. On Today offline, show the saved copy, not a skeleton. |
| Empty states and onboarding | **Use** | Today with nothing assigned, Board with no orders, Review (already good). One first-visit coach mark on Today ("Tap Update to enter today's count"), in reviewed Tamil only. |
| Modal and toast | **Use** | Modal stays for destructive and outward-facing actions (already built). Add a **toast with Undo** for reversible ones ("Hidden from buyers. Undo"). Never put Undo on "Confirm for buyer": a buyer may already have seen it. |
| Gestures | **Not now** | Gloved hands, no discoverability, and WCAG needs a single-tap alternative for every gesture. Pinch-to-zoom on photos stays. No swipe actions. |
| Conversational UI | **Not now** | The reason pills already are the "quick reply" pattern. A chat or voice layer waits for the speech-service agreement. |
| F and Z patterns | **Use** | Board: status and PO at far left, shortfall at far right. Sign-in: title, role, fields, button, in that order. Supervisor card: PO top left, due top right, Update full width at the bottom. |
| Dark patterns | **Never**, and audited | No timers, pre-ticked options, hidden fees or guilt copy. "Send 99999 anyway" is a safety check, not a trick, and is kept neutral. Check the Tamil copy for pressure wording in the review. |
| Landing page / hero | **Not now** | No marketing page. Apply only "one headline, one action" to Sign in and to the buyer page's first screen. |
| Scrollytelling | **Not now** | Nothing in the product is a story. |
| Mega menu | **Never** | Five destinations fit in the small menu we have. |
| Glassmorphism | **Never** | Blur makes text contrast unpredictable; the colourful background it needs does not exist; floor screens are read in bright light; contrast is measured on solid tokens only. |
| Neumorphism | **Never** | Low contrast is the style. It breaks the 3:1 border rule and the "never colour alone" rule. |
| Skeuomorphism | **Never** | Textures cost bytes on a 2 GB phone and add nothing a supervisor needs. |

## 3. How each person's screens use the mix

- **Supervisor (phone):** mobile-first, Z-pattern, a sticky bottom primary bar, micro-interactions on sync, skeleton and empty states, one coach mark. No gestures, no motion beyond a short fade.
- **Merchandiser (desktop first, phone second):** F-pattern, chips and segmented controls, a collapsible filter group on the phone, skeletons, toast with undo, breadcrumbs, a bento key-facts strip on Order detail.
- **Buyer:** calm, read-only, one headline and an "as of" date, an empty state that says what happens next. No motion, no status colour.

## 4. The atomic inventory of this app

Today the atoms exist as CSS classes only (`styles.css`, 444 lines). `ui/` holds about 20 mixed components, and pages are 150 to 340 lines each (Review 342, Board 247). Target:

| Level | What it is here | Already there | To build |
| --- | --- | --- | --- |
| **Atoms** | Button (primary, default, small, block, icon, strong), TextLink, Input, Select, Textarea, Label, Chip, Badge, Icon, Tag, Heading, Text (muted `.sub`), Spinner, Skeleton | `StatusBadge` only, as a component | All the others as components; today they are raw class names |
| **Molecules** | Field (label + input + hint + error), SegmentedControl, SearchBox, Stat (label + value), ProgressBar, SyncChip, Banner, Notice, EmptyState, Toast, Breadcrumb, ReasonPicker, PhotoBox, **ActionBar** | `SyncChip`, `LoadFailed`, `Loading`, `LowConfidence`, `AuthImage` | Field, SegmentedControl, Stat, ProgressBar, Banner, EmptyState, Toast, Breadcrumb, ActionBar |
| **Organisms** | AppBar with Menu, FilterStrip, BoardTable and BoardCard, StageCard, StageTimeline, HistoryList, ReviewCard, PeopleTable, TemplateEditor, OrderForm, UpdateForm, KeyFacts | `AppBar`, `StageTimeline`, `ConfirmDialog`, `PhotoViewer`, `WhatsNewDialog`, `Shortcuts`, `VisitEntryForm`, `UpdateBanner` | The rest are inside the page files and need extracting |
| **Templates** | AuthShell, MerchandiserShell (`.page`, `.page--form`), SupervisorShell with an ActionBar slot, PublicShell | The `.page` classes | As components, so every page gets the same frame |
| **Pages** | The ten screens | Yes | Thin: they fetch data and place organisms |

## 5. How we work (small slices, each proved)

1. **Foundation, no visual change:** spacing, radius and elevation tokens next to the colour tokens; a clear disabled treatment; a component test harness (Vitest with Testing Library) because the front-end guide, section 8.9 lists "no component tests" as a gap.
2. **Atoms**, one at a time, replacing the raw class markup; each with a test and a screenshot.
3. **Molecules**, starting with **ActionBar** (the first fix from audit 01).
4. **Organisms and templates**, starting with the phone board filters and the People table (audit 02).
5. **Pages** become thin; then re-audit with Playwright, report, and move to the next.
6. New components go in new folders (`ui/atoms`, `ui/molecules`, `ui/organisms`, `ui/templates`). Existing files move in one mechanical commit later, so history stays readable.

Every slice follows the front-end guide, section 10: test first, break it on purpose, look at 390 and 1280 in English and Tamil, check greyscale if status is touched, retake snapshots, update docs, then a build or an InBul (only when you ask me to commit).

## 6. First slice

**ActionBar molecule on the supervisor Update screen** (audit 01, finding 1: Send is below the fold). The number field stays at the top; the status line, the "too many" banner and Send live in one sticky bar at the bottom of the screen.
