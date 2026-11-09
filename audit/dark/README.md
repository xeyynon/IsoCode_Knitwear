# Dark theme (10 November 2026)

**Rule:** light is the default. Dark is only what a person chooses in the app menu ("Dark theme" / "Light theme"), kept on that device in `localStorage` `orders.theme`. The device's own dark setting is never read: the floor reads these screens in bright light, and red, amber and green must mean the same thing on every phone.

## What was built
- **Tokens** (`packages/design/tokens.css`): a dark value for every colour token under `:root[data-theme='dark']`, plus `color-scheme: dark` there (native inputs, selects, the date picker and scrollbars draw dark). The default `:root` still says `color-scheme: light`.
- **No flash** (`packages/web/public/theme-init.js`, loaded first in `<head>`): the Content-Security-Policy allows no inline script, so the saved theme is applied by a classic script from the app's own address, before the first paint. It also sets the browser's address-bar colour. The first-paint ring in `index.html` has dark colours too. The service worker keeps the script (`vite.config.ts` precache list, `public/sw.js`), so a reload with no signal still applies the theme. Measured at `domcontentloaded`: dark `rgb(21, 20, 27)` with `data-theme="dark"`, light `rgb(246, 245, 249)`.
- **The choice** (`src/ui/theme.ts`, `src/ui/ThemeMenuItem.tsx`, one item in `AppBar.tsx`): the item names the theme it switches to, applies it, keeps it, and closes the menu. Storage that throws (a private window) leaves the page light. A change in another tab is followed.
- **Words:** `nav.darkTheme` and `nav.lightTheme`. A supervisor's are Tamil **drafts, unreviewed** (`audit/TAMIL-REVIEW.md`).
- **Checks:** `scripts/check_contrast.mjs` measures every pair for both themes (31 pairs in each; the dark ones are marked `[dark]`); `scripts/a11y.ts` takes `THEME=dark` and stops if a page is not really dark.

## The dark palette and its measured contrast
| Token | Light | Dark |
| --- | --- | --- |
| `--page` | `#F6F5F9` | `#15141B` |
| `--surface` | `#FFFFFF` | `#1E1C27` |
| `--ink` | `#1F2328` | `#EDEBF5` |
| `--muted` | `#5A5670` | `#B2AEC6` |
| `--border` | `#8A85A0` | `#8C88A6` |
| `--accent` (violet) | `#6E5BB1` | `#A99AE6` |
| `--accent-soft` | `#EEEBF7` | `#2B2742` |
| `--on-accent` / `--on-ink` | `#FFFFFF` | `#15141B` |
| `--status-red` / `-text` | `#C24400` / `#A23F00` | `#F28B57` / `#FFA177` |
| `--status-amber` / `-text` | `#B07800` / `#8A5A00` | `#E3A83F` / `#F0C260` |
| `--status-green` | `#1B7F5F` | `#5CC797` |
| `--status-grey` (never green) | `#636975` | `#A8AEBA` |

| Pair (dark) | Ratio | Needed |
| --- | --- | --- |
| ink on surface / on page | 14.24 / 15.51 | 4.5 |
| muted on surface / on page | 7.81 / 8.51 | 4.5 |
| accent on surface / on page | 6.76 / 7.36 | 4.5 |
| accent on accent-soft | 5.74 | 4.5 |
| on-accent on accent (button text) | 7.36 | 4.5 |
| border on surface / on page | 4.95 / 5.39 | 3 |
| red icon on surface | 6.88 | 3 |
| red stamp text on surface / on page | 8.49 / 9.25 | 4.5 |
| amber icon on surface | 7.95 | 3 |
| amber stamp text on surface / on page | 10.07 / 10.97 | 4.5 |
| green on surface / on page | 8.05 / 8.77 | 3 / 4.5 |
| grey on surface / on page | 7.54 / 8.21 | 4.5 |
| disabled text on disabled background | 5.93 | 4.5 |

Red, amber and green sit within 1.01 to 1.17 of each other in lightness, as in the light set: they are told apart by the stamp's icon and word, never by colour alone.

## Pictures
Dark: `dark-board-1280`, `dark-order-1280`, `dark-review-1280`, `dark-setup-1280`, `dark-new-order-1280`, `dark-status-1280`, `dark-signin-1280`, `dark-board-390`, `dark-today-ta-390`, `dark-update-ta-390` (a supervisor, Tamil, touch), `dark-buyer-390`, `dark-menu-open`, `dark-menu-ta-390`. Light, for comparison: `light-board-1280`, `light-signin-1280`, `light-today-ta-390`, `light-menu-open`.

## Known limits
- Not looked at on a real phone, in daylight or in a dark room; an iPhone; a screen reader.
- The photo viewer and the "What's new" dialog were not photographed in dark (the demo has no photos); they use the same tokens (scrim, surface).
- The Tamil theme labels are drafts and need supervisors' review.
- A phone whose browser forces its own dark mode on every site is still kept light by `color-scheme: light` until the person chooses dark in the menu.
