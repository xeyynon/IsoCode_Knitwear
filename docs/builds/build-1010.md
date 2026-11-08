# Build 1010: Final check before submission: a safer shared demo, steadier AI suggestions, and fixes across the app

Date: 2026-11-09
Tag: build-1010

<!-- manual:start -->
## What changed

The hosted demo now protects itself from its own visitors: its logins never lock, accounts, buyer links and templates cannot be changed, photos are limited, and the seeded notes and warnings come back every day. The AI suggestions can no longer be called without limit, wait when the service is busy, never show more than 100 percent sure, and keep their English draft within the limit. The app now shows why an order form was refused, opens a new buyer link pasted into a tab that is already open, tells a person when their sign-in has ended, offers the Tamil switch only to supervisors, gives every page its own title, and can be installed with its own icon. The demo password is no longer shipped in a normal build, and a long list of wording, documentation and clean-up fixes went in.

## Why

A reviewer will open the hosted demo and try everything, so anything that could lock them out, empty the demo for the next person, or run up the AI service's free allowance had to be closed before it is shared. A final audit of the server, the app and the repository also found smaller faults worth fixing first.

## How it was checked

Every fix has a test written for it. The full suite passes, including the database tests on a real Postgres 16 in CI, and a clean copy of the repository installs and passes its checks. The app was also walked through in a real browser at phone and desktop sizes, in English and Tamil, offline and online.

## Next improvement

Have supervisors read the new Tamil sentences, check the AI suggestions once against the live service, try the app on real phones, and upgrade the test tools (Vitest) by hand.
<!-- manual:end -->

## Files changed

- .github/workflows/ci.yml
- .github/workflows/release.yml
- .gitignore
- .vercelignore
- README.md
- audit/AUDIT-01-supervisor-phone.md
- audit/AUDIT-02-merchandiser-and-public.md
- audit/AUDIT-03-ui-2-0.md
- audit/DESIGN-DIRECTION.md
- audit/HANDOFF-backend-3.4.md
- audit/NEXT-SESSION.md
- audit/POA-SUBMISSION.md
- audit/POA-UIUX.md
- audit/PROGRESS.md
- audit/RESUME.md
- audit/TAMIL-REVIEW.md
- deployment.md
- docs/status.md
- package-lock.json
- packages/design/tokens.css
- packages/engine/src/index.ts
- packages/server/db/migrations/020_ai_limits.sql
- packages/server/src/aiFromEnv.ts
- packages/server/src/app.ts
- packages/server/src/authService.ts
- packages/server/src/demo.ts
- packages/server/src/demoMode.ts
- packages/server/src/demoSeed.ts
- packages/server/src/dev.ts
- packages/server/src/eventService.ts
- packages/server/src/noteAi.ts
- packages/server/src/noteAiGemini.ts
- packages/server/src/noteAiGroq.ts
- packages/server/src/noteService.ts
- packages/server/src/photoService.ts
- packages/server/src/seedDemoCli.ts
- packages/server/src/server.ts
- packages/server/src/vercel.ts
- packages/server/test/bugfixRound2Repo.test.ts
- packages/server/test/finalF1.test.ts
- packages/server/test/finalF1Vercel.test.ts
- packages/server/test/finalF2.test.ts
- packages/server/test/migrate.test.ts
- packages/server/test/noteAi.test.ts
- packages/server/test/toolingScripts.test.ts
- packages/web/index.html
- packages/web/public/icons/apple-touch-icon.png
- packages/web/public/icons/icon-192.png
- packages/web/public/icons/icon-512.png
- packages/web/public/icons/icon-maskable-512.png
- packages/web/public/manifest.webmanifest
- packages/web/public/sw.js
- packages/web/src/App.tsx
- packages/web/src/api/download.ts
- packages/web/src/api/session.ts
- packages/web/src/api/sessionRules.ts
- packages/web/src/board/boardLogic.ts
- packages/web/src/dates.ts
- packages/web/src/demo/demoAccess.ts
- packages/web/src/i18n.ts
- packages/web/src/langRules.ts
- packages/web/src/orders/orderForm.ts
- packages/web/src/pages/Buyer.tsx
- packages/web/src/pages/Login.tsx
- packages/web/src/pages/NotFound.tsx
- packages/web/src/pages/OrderDetail.tsx
- packages/web/src/pages/OrderSetup.tsx
- packages/web/src/pages/Review.tsx
- packages/web/src/pages/Status.tsx
- packages/web/src/pages/Today.tsx
- packages/web/src/review/noteAiLogic.ts
- packages/web/src/setup/PeopleTab.tsx
- packages/web/src/setup/activityLogic.ts
- packages/web/src/setup/addPerson.ts
- packages/web/src/styles.css
- packages/web/src/ui/AppBar.tsx
- packages/web/src/ui/organisms/AddPersonForm.tsx
- packages/web/src/ui/organisms/EvaluatorAccess.css
- packages/web/src/ui/organisms/EvaluatorAccess.tsx
- packages/web/src/ui/templates/AuthShell.tsx
- packages/web/src/ui/templates/PublicShell.tsx
- packages/web/src/ui/useDocumentTitle.ts
- packages/web/test/accountActivity.test.tsx
- packages/web/test/boardProgress.test.ts
- packages/web/test/demoNotShipped.test.ts
- packages/web/test/evaluatorAccess.test.tsx
- packages/web/test/finalF4AddPerson.test.tsx
- packages/web/test/finalF4AppBarLang.test.tsx
- packages/web/test/finalF4Buyer.test.tsx
- packages/web/test/finalF4ClockTime.test.ts
- packages/web/test/finalF4EvaluatorLayout.test.ts
- packages/web/test/finalF4I18n.test.ts
- packages/web/test/finalF4NoteAi.test.ts
- packages/web/test/finalF4OrderDetail.test.tsx
- packages/web/test/finalF4OrderForm.test.ts
- packages/web/test/finalF4OrderSetup.test.tsx
- packages/web/test/finalF4Pwa.test.ts
- packages/web/test/finalF4ReturnTo.test.tsx
- packages/web/test/finalF4ReviewAi.test.tsx
- packages/web/test/finalF4Session.test.tsx
- packages/web/test/finalF4Titles.test.tsx
- packages/web/test/langDefault.test.ts
- packages/web/test/swVersion.test.ts
- packages/web/vite.config.ts
- scripts/changelog.mjs
- scripts/check_docs.mjs
- scripts/make_icons.mjs
- scripts/snapshots.ts
- scripts/vercel_build.mjs
- uiux/2.0/README.md
- uiux/README.md
