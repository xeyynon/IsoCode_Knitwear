# Build 1012: A calmer top bar: three shapes, one menu and the views in the centre

Date: 2026-11-10
Tag: build-1012

<!-- manual:start -->
## What changed

Every screen now has a new top bar made of three separate shapes instead of one strip: the app's name on the left, the views in the middle, and the menu on the right. A merchandiser sees Board, Review (with the number waiting) and Setup in the middle, and the one you are on is underlined; a supervisor sees the page title there, so both roles get the same look. The middle stays exactly centred on the screen whatever the sides hold. The menu opens and moves with the keyboard (arrow keys, Home, End, Escape) and keeps every item it had, including the dark and light choice and the language. On a phone a merchandiser's views become a row that scrolls sideways under the bar, and Tamil titles and 200% zoom fit without anything running off the screen. The bar slides in once when the app opens, not again on every page, and not at all if the phone is set to reduce motion. The status page and the buyer page show the app's name only; the sign-in page has no bar.

## Why

The earlier bar crowded the page title, the views and the menu into one strip, and a user's-eye audit showed that the top of the screen and the back control looked different from page to page. The new bar follows a design already proven in another of the owner's products: three calm shapes, one centred middle, one menu, a single entrance. It is the same on every page and role, in light and dark.

## How it was checked

On the combined result the full automated suite passes (2,910 tests, 16 skipped that need a real Postgres), the accessibility audit finds nothing serious on 48 screens in light and again in dark, the layout audit is clean at 55 screen widths including 195 px in Tamil, and the offline browser test passes 23 of 23 with the strict security policy enforced. The new bar was also measured in a browser: its middle sits 0 px off the screen centre at five desktop widths from 1180 to 1920 px, the brand, the views and the menu share one centreline, and no control is under the touch size. Not checked: a real phone, an iPhone, a screen reader, and the sign-in page, which was left without a bar on purpose. The new bar adds no new words, so there is no new Tamil to review.

## Next improvement

Let a buyer see where an order stands (on track or not, which stage, last updated) and what changed, including date changes, which buyers' compliance teams asked for; let a merchandiser cancel or fix a mistyped order; keep a supervisor's unsent number and note when she leaves the screen, and let her see and correct what she sent; one name for the ship date everywhere. The plan is in audit/POA-AUDIT-04.md.
<!-- manual:end -->

## Files changed

- package.json
- packages/design/tokens.css
- packages/web/src/pages/NotFound.tsx
- packages/web/src/pages/OrderSetup.tsx
- packages/web/src/styles.css
- packages/web/src/ui/AppBar.css
- packages/web/src/ui/AppBar.tsx
- packages/web/src/ui/menuRules.ts
- packages/web/src/ui/molecules/NavTabs.css
- packages/web/src/ui/molecules/NavTabs.tsx
- packages/web/src/ui/molecules/PopoverMenu.tsx
- packages/web/src/ui/templates/PublicShell.tsx
- packages/web/test/darkTheme.test.ts
- packages/web/test/finalF4Buyer.test.tsx
- packages/web/test/menuRules.test.ts
- packages/web/test/narrowScreens.test.ts
- packages/web/test/navRules.test.ts
- packages/web/test/popoverMenu.test.tsx
- packages/web/test/skipLinkNotFound.test.tsx
- packages/web/test/templates.test.tsx
- packages/web/test/topBar.test.tsx
- packages/web/test/topBarCss.test.ts
- scripts/topbar_metrics.ts
- tsconfig.scripts.json
