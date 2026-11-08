# IsoCode Knitwear: order tracking

[![CI](https://github.com/xeyynon/IsoCode_Knitwear/actions/workflows/ci.yml/badge.svg)](https://github.com/xeyynon/IsoCode_Knitwear/actions/workflows/ci.yml)
[![Release](https://github.com/xeyynon/IsoCode_Knitwear/actions/workflows/release.yml/badge.svg)](https://github.com/xeyynon/IsoCode_Knitwear/actions/workflows/release.yml)

Order tracking for a knitwear exporter. Supervisors on the floor send a daily count from a phone, in Tamil, even without a signal. A server works out, for every order, whether it will ship on time and shows the reasoning. Merchandisers see the orders that need attention first; buyers get a read-only view of only their own orders.

> **Status: early build.** The calculation engine, database, API, the merchandiser's order board, order setup and order detail, and the supervisor's offline daily update work and are tested. The review gate, the buyer's read-only view, photos on a daily update and typed notes work and are tested; voice notes and automatic translation are not built. See [Status](#status) and [Roadmap](#roadmap).

## Contents
[Why](#why) · [Status](#status) · [How the colours are decided](#how-the-colours-are-decided) · [Architecture](#architecture) · [Repository layout](#repository-layout) · [Getting started](#getting-started) · [Configuration](#configuration) · [API](#api) · [Security model](#security-model) · [Testing](#testing) · [Development workflow](#development-workflow) · [CI and releases](#ci-and-releases) · [Roadmap](#roadmap)

## Why
Orders slip because progress on the floor reaches the merchandiser late, by phone or chat, and the delay is noticed when it is too late to recover. This project replaces chasing with a live board:

- **Floor to board in one tap.** A supervisor enters today's pieces for a stage. The server recomputes the order's status.
- **A colour you can explain.** Every row shows the sum behind its colour: *need 467 a day, making 350 a day, 700 pieces short by 11 Nov.*
- **Honest by design.** An order with no updates is grey, never green. A rate based on little data is labelled an estimate. Nothing reaches a buyer until a merchandiser confirms it.

## Status

| Area | State |
| --- | --- |
| Run-rate engine (status, projected finish, working-day calendars, TNA back-scheduling) | Built, tested |
| Database schema with row-level security | Built, tested |
| HTTP API: sign-in with lockout, board, daily updates (single and batch), order creation, ex-factory change with logged reason, status check | Built, tested |
| Web app: sign-in, order board, public status page | Built (`build-1000`) |
| Board search and sort: search by PO, buyer or style (every word must match), sort by worst status, ex-factory date, buyer or PO; both live in the address (`q`, `sort`) beside the status and buyer filters, and the link to the review queue says how many are waiting | Built, tested |
| Board unit and ship-week filters, and a stage progress bar: a unit matches an order when it owns any of its stages (`unit`); ship week is the Monday-to-Sunday week of the ex-factory date against today in India, chosen from Overdue (earlier weeks), This week, Next week or Later, with the dates spelled out (`week`); both combine with the search, sort, status and buyer, the status counts follow them, and each row shows stages finished out of all with the current stage in words (a neutral bar, never a status colour) | Built, tested |
| Supervisor app: "My orders today", the daily update, an offline queue that survives restarts, "3 waiting" status, and the app opening with no signal | Built (`build-1001`), 14 browser checks |
| Order setup (with a schedule preview before creating) and order detail (a stage timeline with plan, projected date and days early or late; the working behind each colour; date-change history as who, what and when, newest first; change ex-factory with a reason; "Order board" goes back to the board with the same filters, search and sort, kept in the address so a reload keeps it) | Built (`build-1002`) |
| Order detail, horizontal stage timeline (screens wider than 720 px): one bar per stage on a shared date axis from the first update (or today) to ex-factory, the planned finish marked above the bar and the projected finish below it with how many days late or early, a dashed labelled ex-factory line, and each stage's own unit's closed days hatched behind it (Sundays in a light hatch, and named closures with the merchandiser's note such as "Deepavali" in a darker one the other way, each with its own legend entry such as "Closed: Deepavali"); a stage that finishes after ex-factory says so in words, and the track widens so it is never cut off. Status is the badge's icon and word, and the chart uses no status colour, so it reads in greyscale. It scrolls inside its own box when the period is long; a phone gets the vertical list instead, so the page never scrolls sideways. A "Closed days in this period" line gives the same days as text for a screen reader and the phone. Layout maths is `orders/timelineLayout.ts` | Built, tested |
| "Add an update" on the order detail (merchandiser): enter a stage on a visit, for a stage nobody on the floor reports. Stage, date (defaults to the factory's today, never a future day), pieces (a whole number: "-5" is refused, not read as 5) and an optional note. It is kept as entered on behalf (migration `012`, insert-only like every update; a supervisor's session cannot write such a row) and the stage shows a person icon with "Entered by a merchandiser, low confidence" on the order page and the board, so the flag is never colour alone. One id per entry, so pressing again after a lost answer is never counted twice. Logic is `orders/visitEntry.ts`; which stages are flagged is `server/src/confidence.ts` | Built, tested |
| A photo on a daily update: shrunk on the phone, uploaded safely even after a lost signal or a lost reply, approved in the review queue before a buyer can see it | Built (`build-1004`) |
| Photos the right way up and viewable: the phone applies the camera's rotation before it shrinks a photo (a portrait shot is no longer sent sideways), a supervisor can **Retake** a chosen photo, and a merchandiser can click a photo in the Review queue to open it full size in a dialog (scroll, pinch to zoom, Close or Escape). Photos are not yet shown on Order detail. The rotation is checked in headless Edge only: a real-phone check is listed in `frontendskill.md` 8.7 | Built; real-phone check pending |
| Review queue (confirm, reword or hide a warning before a buyer can see it; a sticky summary bar with a count per section and jump links that move focus to the section heading; a section with nothing in it shrinks to one line saying when items appear there), buyer links (create, cancel, expire) and the buyer's read-only page, with automated cross-buyer leak tests | Built (`build-1003`) |
| A reason (one tap from a fixed list) and a few typed words, in Tamil or English, on a daily update; a merchandiser reviews them, adding the English meaning of Tamil text. Notes are internal and never shown to buyers | Built (`build-1005`) |
| **Setup** for the pilot: add supervisors and merchandisers (easy PINs refused), reset a PIN, sign someone out on every phone, stop an account, add units, set closed days per unit, create and edit TNA templates; signing out everywhere, stopping an account and deleting a template ask first in an accessible dialog (`ui/ConfirmDialog.tsx`, not the browser's box) | Built (`build-1006`) |
| Withdraw an approved photo from the screen, and clear the files of old rejected photos | Built (`build-1006`) |
| Tamil on every supervisor screen: sign-in (with a language switch before signing in), My orders today, the daily update with its photo, reason and note, the sync chip, storage warnings, error messages, the usual stage names, month names and the menu. Words the server wrote in English (why an update was refused) show as a plain Tamil sentence instead. Merchandiser screens stay English | Built; the Tamil is **unreviewed** and must be read and corrected by supervisors before the pilot |
| Tamil first for supervisors: a supervisor who signs in on a phone where nobody has chosen a language sees Tamil straight away; a merchandiser stays in English. The language switch (menu, or the sign-in screen) is a choice and always wins, and signing out never erases it. A language that was only our default is remembered so the sign-in screen is Tamil on that phone, but the next person to sign in gets their own default. The rule is `langRules.ts` (pure, tested); the browser scripts (`e2e_offline`, `snapshots`) set English first so their pictures and checks stay the same | Built, tested; the Tamil is still unreviewed |
| One calm "cannot reach the server" state: when a screen cannot load because the connection is down (a failed fetch, a timeout, or a proxy or gateway page instead of the app's own answer) it shows "Can't reach the server. Check the connection and try again." with a Retry button and a link to the public status page, the same card on the board, order screens, review, setup and the supervisor's Today and Update; supervisor screens add "Your work saved on this phone is safe" (Tamil: unreviewed), and a buyer's page leaves out the status link. A server that answered with an error still shows its own message. The classification is `api/sessionRules.ts`, the card is `ui/LoadFailed.tsx`; the offline queue and the sync chip are unchanged | Built, tested |
| Mocked alerts: when a warning is confirmed for buyers, a stage turns red, or a photo is approved, the email or WhatsApp message that would go out is written to the `outbox` table in the same transaction as the change (to the buyer's name or to "Merchandisers", never a real address). A buyer's message holds only the confirmed wording or "a photo is ready", never a rate or a shortfall. **Nothing is sent anywhere.** Merchandisers read the latest 50 in Setup > Alerts ("Alerts (not sent: demo)"); buyers and supervisors cannot read the table, and the API never edits or deletes a row | Built, tested |
| Voice notes, automatic translation, and automatic reason suggestions | **Not built** (they need a speech and translation service agreement; until then a person does the translating) |

**Not yet verified:** nothing has run against a production Postgres server or on real phones (the offline checks ran in a desktop browser at phone size), and the Tamil wording has not been checked with floor supervisors.

## How the colours are decided
For each stage, in order, the engine takes the pieces still to make, the working days left (in that stage's own unit calendar), and the recent rate (the average of the last five days with an update).

| Colour | Rule |
| --- | --- |
| **Red** (late risk) | Making under 90% of the rate needed; the milestone is today or has passed with pieces left (even with no update yet; on the day itself the reason says "due today", not "passed"); no output; or this or a later stage is projected past ex-factory |
| **Amber** (at risk) | Making 90 to 100% of the rate needed, or under 2 working days of buffer before ex-factory |
| **Green** (on track) | Making at least the rate needed, with a 2-day buffer, and a recent update |
| **Grey** (no update) | No output yet while the milestone is still ahead, or a good rate that has gone quiet. Never shown as green |

The order's colour is its worst stage. Thresholds live in a settings table. Every colour is also shown with an icon and a word, because red, amber and green are almost the same lightness and cannot carry meaning alone.

*A deliberate departure from the first written spec:* slipping past a stage milestone is not red by itself, because otherwise the amber band could never be reached. Red needs the order to be projected past ex-factory. This is recorded as a decision and should be confirmed with the business.

## The look (UI/UX 2.0)
Plan and log: `audit/POA-UIUX.md` and `audit/PROGRESS.md`; the rules a screen must keep: `frontendskill.md` section 2; the components: `packages/web/src/ui/README.md`.

- **One light theme, one action colour.** The action colour is Pantone Violet, `#6E5BB1` (sampled from pantone-colours.com; 5.53:1 against white), with a soft wash of it, `--accent-soft #EEEBF7`, for hero cards and selected surfaces. The page is a faint lavender (`--page #F6F5F9`), borders and labels are violet-grey (`--border #8A85A0`, `--muted #5A5670`), text is `--ink #1F2328`. All of it lives in `packages/design/tokens.css`; `scripts/check_contrast.mjs` checks every pair, and a test fails on a literal colour anywhere else. Red, amber and green keep their meaning (order status) and are unchanged.
- **A status is a ruled stamp.** Every status on the board, order page, review, timeline and the buyer page is drawn by `StatusBadge` as a level, double-ruled rectangle at least 79 x 24 px, in capitals, with the icon and the word, the colour on the rule and the text, and no fill (`ui/StatusStamp.css`). It reads the same in greyscale.
- **Neutral surfaces.** Cards, tiles and rows are white with a neutral border; a status colour is never a background. A form error is ink with a drawn "!" mark, not red (red is for order status only).
- **Supervisor phone:** Today opens on a hero card (a progress ring, "N of M updated today", the date the counts go to, the sync chip) above large stage cards (pieces done against planned with a bar, due date, one full-width Update button). Update opens on a hero with the order, a ring, "today so far" and "left", then a large number field; Send sits in a bar pinned above the keyboard.
- **Merchandiser desktop:** the board's status filter is a row of tiles on wide screens (a phone keeps compact chips and a Filters button); the order page is a bento (key-fact tiles, then the timeline and the stage cards side by side); Board, Review and Setup are tabs in the app bar; Setup opens on a pilot checklist and has one "Add a person" form and an account Activity list.
- **Numbers and dates:** piece counts are grouped one way everywhere (`1,750`, `1,25,000`); a date field reads its date back in words under it.
- **Loading:** a ring in `index.html` fills the first seconds before the app starts, and Today's list shows grey blocks while it loads. Both were added only after `npm run load` measured the wait.

**Not verified:** none of this has been seen on a real phone in daylight (soft tints can wash out in glare), on an iPhone, or with a screen reader; floor supervisors have not read the new Tamil (`audit/TAMIL-REVIEW.md`).

Look at it and measure it:
```bash
npm run dev:api                  # terminal 1
npm run dev -w @isocode/web      # terminal 2
npm run snapshots                # pictures of every screen into uiux/2.0 (the earlier set is kept in uiux/2.0/previous/)
npm run diff                     # compare two picture sets pixel by pixel, reading only
npm run ux                       # overflow and tap-size audit: 10 screens at 5 widths, touch emulation on phones
npm run a11y                     # axe on every screen
npm run load                     # load times on an emulated slow network and processor (emulation, not a real phone)
npm run phone                    # the keyboard check on a real Android phone over USB (adb)
```

## Architecture
```mermaid
flowchart LR
  SUP["Supervisor phone<br/>Tamil, offline queue"] --> API
  MER["Merchandiser web app<br/>board, setup, review"] --> API
  BUY["Buyer link<br/>read-only, one buyer"] --> API
  API["Fastify API<br/>guarded by default"] --> ENG["Run-rate engine<br/>pure function"]
  API --> DB[("Postgres<br/>row-level security")]
```

- **Phones never compute status.** They send dated events; the server recomputes after each one.
- **The engine is a pure function** with no database or clock access, so it is fully unit-tested.
- **Security lives in the database.** Row-level security is forced on every table, so a forgotten filter in the API cannot leak another buyer's data.
- **Updates are append-only and idempotent.** A repeated send (flaky network, app killed mid-sync) is recognised by its client id and never counted twice.

**Stack:** TypeScript throughout. React 19 with Vite and React Router (one chunk per screen, so a phone never downloads the board). Fastify on Node. Postgres. Vitest for tests. PGlite (Postgres in WebAssembly) runs the database tests anywhere.

## Repository layout
```
packages/
  engine/    Run-rate engine and TNA back-scheduling (pure TypeScript)
  server/    Fastify API, services, SQL migrations and row-level security tests
  web/       React app: sign-in, board, status page
  design/    Colour tokens
scripts/     changelog.mjs (versioning), check_repo.mjs, check_docs.mjs, check_bugs.mjs, check_contrast.mjs, and the browser tools
docs/builds/ One report per numbered build
uiux/        Screenshots of every screen on demo data: 1.0 (frozen, build 1006) and 2.0 (npm run snapshots writes it; earlier 2.0 sets are kept)
.github/     CI, release and Dependabot configuration
```

## Getting started
**Prerequisites:** Node.js 20.19 or newer (22 recommended) and npm 10 or newer. Docker is not needed.

```bash
npm install
npm run verify        # static checks, typecheck and every test (not the web build: CI also runs npm run build)
```

**Run the whole app locally on demo data** (an in-memory database with illustrative orders; today is fixed to 4 Nov 2026 so the figures line up):

```bash
npm run dev:api                 # terminal 1: API on http://127.0.0.1:8787
npm run dev -w @isocode/web     # terminal 2: app on http://localhost:5173
```

| Demo account | Sign in with |
| --- | --- |
| Merchandiser | `m@example.test` / `correct horse battery` |
| Supervisor | phone `98765 43210` / PIN `4321` (My orders today and the daily update) |

These are throwaway demo credentials for the in-memory database. Never reuse them anywhere real.

**Production build of the web app:**
```bash
VITE_API_BASE=https://api.example.com npm run build
```
The build deliberately fails without `VITE_API_BASE`: the value is baked into the bundle, and a missing one would silently point production at the wrong place.

## Configuration
**API** (`packages/server/.env.example`)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection. Connect as the non-owner `app_user` role |
| `TOKEN_SECRET` | At least 32 random characters. The server refuses to start without it |
| `ALLOWED_ORIGINS` | Comma-separated browser origins. Cleaned of stray quotes, brackets and slashes; invalid entries are dropped with a warning |
| `TRUST_PROXY` | How many reverse proxies sit in front: `1` (the usual), `2` to `10`, or a list of proxy addresses or ranges (`10.0.0.0/8,192.168.1.5`, also `loopback`, `linklocal`, `uniquelocal`). `0`, `false` or unset means none. The caller's address is then read from the end of `X-Forwarded-For`, where the proxies add theirs, never from the front, which the caller writes. Any other value stops the server at start-up with a message that names the variable |
| `MEDIA_DIR` | Folder where uploaded photos are kept. Leave it unset (with `MEDIA_STORE` unset) to switch photos off: the photo routes then answer 503 |
| `MEDIA_STORE` | Where photos live: `disk` (needs `MEDIA_DIR`), `memory` (trials; photos vanish on restart) or `s3`. Unset means `disk` if `MEDIA_DIR` is set, else photos off. Any other value, or a missing S3 variable, stops the server at start-up with a message that names the variable (never a value) |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Required when `MEDIA_STORE=s3`. The bucket must be private, in an Indian region (for example `ap-south-1`), and block public access. The key needs only get, put and delete on the bucket (plus list on it, so a missing photo reads as "not found" and not as "denied") |
| `S3_ENDPOINT` | Optional. For Cloudflare R2, MinIO, Backblaze or another S3-compatible service; leave unset for AWS. Must be `https://` (`http://` only for localhost) and must not hold a user name or password |
| `S3_FORCE_PATH_STYLE` | Optional, `1` or `true`. Puts the bucket in the path instead of the host name; MinIO needs it |
| `S3_PREFIX` | Optional folder inside the bucket, for example `pilot/`. Photos are stored under random keys inside it |
| `S3_SSE` | Optional, `AES256` (default) or `none` for a service that rejects the encryption header. Photos are stored encrypted at rest |
| `PORT` | Defaults to 8787 (empty counts as unset). Must be a whole number from 1 to 65535, otherwise the server stops at start-up with a plain message |
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info` (default), `debug`, `trace` or `silent`. At `info` each request writes one short line (method, route pattern, status, milliseconds), never a body, a header or a query string. Any other value stops the server at start-up |
| `DB_POOL_MAX` | Database connections, 1 to 50, default 5. Each is a Postgres process and the work is mostly CPU, so more do not help a small server. A request that cannot get one within 5 seconds answers 503 `busy` |
| `DB_STATEMENT_TIMEOUT_MS` | The database ends any single statement that runs longer than this, default 30000; 0 means no limit. A transaction left idle is ended after 15 seconds |
| `ALLOW_UNSAFE_DB_ROLE` | `1` lets the server start even though `DATABASE_URL` is a superuser, `BYPASSRLS` or table-owner login, which silently turns row-level security off. For local development only; leave it unset in every real deployment (the default is to refuse to start) |

**Start the real API** with `npm run start:api` (it runs `packages/server/src/server.ts` through `tsx`, which is installed with `npm ci --omit=dev`). Nothing loads `packages/server/.env.example` or a `.env` file: export the variables in the environment of the process (the host's settings, `export`, a systemd `EnvironmentFile`, `docker run --env-file`). `npm run dev:api` is the in-memory demo, not this.

Run `DATABASE_URL=postgres://owner:...@host/db npm run migrate` as the table owner (it applies `packages/server/db/migrations` in order, once each, and is safe to repeat; details in `md/deployment.md`), then give `app_user` login and a password separately. Secrets never belong in the repository (see [Security model](#security-model)).

**Web:** `VITE_API_BASE`, build time, required for production builds.

## API
Errors always have the shape `{ "error": { "code", "message" } }`. Messages are safe to show; detail is logged on the server only. A request body over the limit answers 413 `too_large`, and a photo over 3 MB answers 413 `photo_too_large` (a phone should not retry either). Every route needs a token unless listed as public, so a route added later is protected by default.

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /api/health`, `GET /api/status` | public | Liveness; plain Up/Down status of the API and database |
| `POST /api/auth/login` | public | Email and password, or phone and 4-digit PIN |
| `GET /api/board` | merchandiser | Every order with colour and working, worst first; also the units that own its stages and how many stages are finished (`units`, `stagesDone`, `stagesTotal`, `currentStage`) |
| `GET /api/orders/options` | merchandiser | Buyers and TNA templates for the order form |
| `POST /api/orders/preview` | merchandiser | The dates an order would get, without creating it |
| `GET /api/orders/:id` | merchandiser | One order in full: each stage planned versus projected, the working, the date-change history, and `calendar` (the period and each stage's unit's closed days in it, with a reason) for the timeline, and `reasons` (the settings reason list that words the notes' reasons) |
| `POST /api/orders` | merchandiser | Create an order from a TNA template; stages are back-scheduled from ex-factory |
| `POST /api/orders/:id/ex-factory` | merchandiser | Move ex-factory and re-schedule; every change is logged with a required reason (at most 300 characters) |
| `GET /api/review` | merchandiser | Warnings waiting for review and those visible to buyers (also brings warnings up to date) |
| `POST /api/warnings/:id/confirm`, `.../dismiss`, `.../undo-dismiss` | merchandiser | Confirm a warning for buyers (optionally rewording it), hide it, or undo hiding it. A confirm sends the colour and wording that were shown and gets 409 if a refresh has changed them since. Undo works only if the warning was still waiting for review; a confirmed one needs a fresh confirmation (409 `needs_confirmation`) |
| `GET/POST /api/buyer-links`, `POST /api/buyer-links/:id/revoke` | merchandiser | Make, list and cancel a buyer's private link |
| `GET /api/outbox` | merchandiser | The mocked alerts (nothing is sent): the latest 50, newest first, `Cache-Control: no-store`; 403 for a supervisor, 401 for a buyer link |
| `GET /api/buyer/orders` | buyer link | The buyer's own orders, planned dates and confirmed warnings. A link opens only this |
| `GET /api/buyer/export.csv` | buyer link | The same orders as a CSV file (PO, style, colour, quantity, ex-factory, each stage's planned finish, confirmed notices), built from what the buyer page already shows and nothing more |
| `GET /api/buyers/:id/export.csv` | merchandiser | The file one buyer would get, for checking it or sending it on |
| `GET /api/reasons` | signed in | The fixed list of reasons for a slow stage |
| `POST /api/notes/:id/confirm` | merchandiser | Review a note: add the English meaning of a Tamil note and settle the reason |
| `POST /api/photos` | supervisor | Upload one photo as a raw JPEG (headers carry the order, stage, day and a retry-safe id). Checked to be a real JPEG, 1 KB to 3 MB |
| `GET /api/photos/:id/file`, `POST /api/photos/:id/approve`, `.../reject` | merchandiser | View, approve or withdraw a photo |
| `POST /api/photos/purge` | merchandiser | Delete the files of photos rejected more than N days ago (waiting and approved photos are never touched) |
| `GET /api/accounts/audit` | merchandiser | Who added, reset, signed out, stopped or allowed an account, and when: the latest 100, newest first, optionally for one person (`?subject=`). Insert-only; never holds a PIN or password |
| `GET/POST /api/units` | merchandiser | List and add units (your own floors and subcontractors) |
| `GET /api/accounts`, `POST /api/accounts/supervisors`, `.../merchandisers`, `.../:id/pin`, `.../:id/sign-out`, `.../:id/disabled` | merchandiser | Who can sign in; add people; reset a PIN; sign out everywhere; stop or allow an account |
| `GET/POST /api/calendar`, `POST /api/calendar/clear` | merchandiser | Closed days and extra worked days per unit |
| `GET/POST /api/templates`, `POST /api/templates/:id/delete` | merchandiser | List, create, edit and delete TNA templates (orders already made keep their dates). Creating answers 201, saving over an existing one answers 200 |
| `GET /api/buyer/photos/:id` | buyer link | An approved photo of the buyer's own |
| `GET /api/my/stages` | supervisor | The stages in the supervisor's own unit, with progress and today's total |
| `POST /api/events`, `POST /api/events/batch` | supervisor, merchandiser | Send daily counts, optionally with a photo and a note (a reason and/or words); the batch form serves the offline queue. A supervisor posts only for their own unit's stages. A merchandiser may post for any stage (a subcontractor has no one to send a count): the row is stored as entered on behalf, with who entered it, and the board (`lowConfidenceStages`) and the order page (`lowConfidence`, plus `today`) show "Entered by a merchandiser, low confidence" for a stage whose newest update days include such an entry. The engine still just counts the pieces; buyers never see any of it |

## Security model
- **Row-level security, forced, on every table.** The API connects as a role that owns nothing. Each request runs in one transaction that begins by stating who is asking, using transaction-local settings that cannot leak between pooled requests. With nothing set, every policy denies: the schema fails closed.
- **Buyers** see only their own orders, approved photos and confirmed warnings, and never the events a colour is computed from.
- **Supervisors** see only their own unit.
- **Sign-in:** secrets are hashed with scrypt. A wrong password and an unknown account give the same answer in the same time. Five wrong tries lock an account for 15 minutes and failures are rate-limited per address. A 4-digit PIN is weak on its own; the lockout is what protects it.
- **Tokens** are signed claims (12 hours for merchandisers, 30 days for supervisors) that carry the account's version. Each request checks the account is not stopped and the version still matches, so a merchandiser can sign a person out on every phone at once (a lost phone), reset a PIN, or stop an account, and it takes effect on the very next request. A person moved to another unit is signed out too. To sign **everyone** out, rotate `TOKEN_SECRET`.
- **PINs:** easy ones (the same digit, a run such as 1234, a repeated pair, common choices) are refused when a supervisor is added or a PIN is reset.
- **History is append-only:** a database trigger rejects edits and deletes of daily events and date changes, even by the table owner.
- **No detail leaks:** unexpected errors return a plain message with no stack trace, path or SQL.
- **Never commit** keys, `.env` files, real worker or buyer data, recordings, or photos (`media/`, `uploads/`). `scripts/check_repo.mjs` refuses these and key-shaped strings (cloud and API keys, private keys, a database URL with a password, `TOKEN_SECRET=` and `S3_SECRET_ACCESS_KEY=` values, signed tokens), in tracked and new files, including file names with Tamil or accented characters. The private `md/` folder and `company-a-build-plan.md` are refused even if added with `git add -f`. In CI the `BANNED_TERMS` list must be present on pushes, tags and same-repository pull requests (a missing one fails the run); pull requests from forks and from Dependabot cannot receive the secret, so there the log says the guard did not run.

Report a vulnerability privately to the repository owner rather than in a public issue.

## Testing
```bash
npm test               # engine, API, database and web logic (Vitest), on PGlite (Postgres in WebAssembly)
npm run test:pg        # the server tests on a real Postgres: set TEST_DATABASE_URL to a SUPERUSER connection string of a disposable server
npm run typecheck      # the web app and engine, the server without browser types, and the scripts and config files
npm run check          # repo checks (secrets, tags, duplicate InBul ids), Markdown links, colour contrast, bug log
npm run verify         # check, typecheck and test; CI also runs a production web build (npm run build, which needs VITE_API_BASE)
npm run e2e            # the offline test in a real browser (see below)
npm run a11y           # axe-core on every screen, in a real browser (needs the two dev servers)
```
- **Real Postgres:** `npm run test:pg` with `TEST_DATABASE_URL=postgres://postgres:...@localhost:5432/postgres` runs `packages/server` against a real server instead of PGlite: each test file gets its own throwaway database, and the app connects as `app_user` through the production pool. CI does this in the `test-postgres` job (Postgres 16, plus the row-level-security SQL file run with `psql` as a non-superuser owner and the real migration runner). Never point it at a server you care about.
- **Slow tests:** a few files start PGlite or run git many times; they carry a longer time limit of their own (`scripts/slowTests.mjs`). In CI the 10 slowest tests are printed at the end of the run (`SLOWEST_TESTS=1` does it locally).
- **Engine:** table-driven tests for every rule and edge case (zero history, completed stage, past milestone, over-production, duplicate event, closed days).
- **Database:** the SQL assertions in `packages/server/db/tests/rls.test.sql` run on PGlite under `npm test`, once as a non-superuser table owner so FORCE RLS binds the owner too, and are plain Postgres so they also run under `psql`.
- **Mutation-checked:** the security and engine rules were each deliberately broken once to confirm a test fails. A test that has never failed has not been shown to test anything.
- **Contrast:** `check_contrast.mjs` measures every colour pair against WCAG AA.
- **Offline, in a real browser:** `npm run e2e` builds the app, starts the API and the app, and drives Edge (or Chrome with `E2E_BROWSER=chrome`). It loads the app, goes offline, enters 20 updates, restarts the app while still offline, reconnects, and checks that each update arrived exactly once and the totals add up. It also loses a server reply on purpose to prove a retry never double-counts. Set `E2E_SHOTS=<folder>` to save screenshots.
- **Accessibility, in a real browser:** `npm run a11y` (with `npm run dev:api` and `npm run dev -w @isocode/web` running) drives Edge through every screen at 390x844 touch and 1280x900 (sign-in both tabs, board with the menu open, order setup with and without errors, an order detail, review, each Setup section, status, a buyer page opened with a link made through the API and cancelled again at the end, and the supervisor's list and update screen with a reason, a note and the "too many pieces" question open, in English and Tamil). It injects axe-core (WCAG 2.0 to 2.2 A and AA plus best practice, no rule switched off), also requires exactly one `h1` per screen, exits with an error on any serious or critical violation and lists the moderate and minor ones grouped by screen. Set `API=<url>` to use a spare API when the demo one has locked the sign-in. A clean run is a floor: a screen-reader pass (NVDA, TalkBack) is still needed.

### Service worker and new versions
`packages/web/public/sw.js` keeps the app itself available with no signal (production builds only; it never touches the API, the app's own queue keeps the updates). A new version installs in the background and then **waits**: it is never swapped in by itself, because new files under a screen that is still open would break it. When one is waiting, a quiet bar at the bottom of the screen says "A new version is ready. Reload when you have finished." (also in Tamil) with **Reload** and **Later**. Reload posts `{type: 'SKIP_WAITING'}` to the waiting worker, which then takes over, and the page reloads once (a flag in the tab stops a reload loop). The bar stays away while the Update screen holds a count, reason, note or photo that is not saved yet, and shows once the update is saved. Saved updates live in IndexedDB, so they are still there after the reload and are sent from there; if the phone only kept the queue in memory (the warned fallback) and something is waiting, the bar is not shown at all. The app also asks the browser for a newer version when it comes back to the front, at most every 30 minutes. The rules are in `packages/web/src/ui/swUpdate.ts` (tests in `packages/web/test/swUpdate.test.ts`), the wiring in `swUpdateStore.ts` and `UpdateBanner.tsx`.

### Fonts
The fonts ship with the app, so a phone with no Tamil font does not show boxes: `@fontsource/noto-sans` (Latin, weights 400, 600, 700) and `@fontsource/noto-sans-tamil` (Tamil, the same three weights), both licensed under the SIL Open Font License. `packages/web/src/fonts.ts` imports only those six subset files (the weights `styles.css` uses); each has `font-display: swap`, and the token stacks in `packages/design/tokens.css` keep the system fonts as the fallback while a file loads. A new weight in `styles.css` needs its own line in `fonts.ts`. The build's `precache.json` lists the `.woff2` files (not the `.woff` fallbacks the font CSS also names), so the fonts are kept for no-signal use with the rest of the app. Cost, measured on the production build: six `.woff2` files, 83 kB in total (Latin 40 kB, Tamil 45 kB; they are already compressed, so gzip saves nothing), about 0.3 kB more gzipped CSS, and no extra JavaScript. The files load only when a screen first needs them (Tamil text pulls the Tamil ones), and are fetched once, then served from the service worker's cache.

## Development workflow
Every change is either a **build** or an **InBul** (internal build):

| Kind | What it is | Tag |
| --- | --- | --- |
| **Build** | Something a user would notice: a screen, wording, a status rule, sync behaviour | `build-1000`, `build-1001`, ... |
| **InBul** | Everything else: docs, tests, tooling, research | `InBul01`, `InBul02`, ... |

The tag is the source of truth for the number; commit titles never carry it. Builds are batched (about ten fixes each) so the list stays meaningful.

```bash
# a build
git add <files>
node scripts/changelog.mjs --pending "<title>" "<what changed>" --why ".." --verified ".." --next ".."
git add docs/builds CHANGELOG.md build-info.json
git commit -m "<the same title>"
node scripts/changelog.mjs --tag

# an InBul
node scripts/changelog.mjs --next-internal      # e.g. InBul06
git add <files> && git commit -m "InBul06: <title>"
node scripts/changelog.mjs --tag

# push with tags
git push origin main --tags
```
- `node scripts/changelog.mjs --status` shows the next free numbers. Check it just before committing; never guess. The next InBul id is the highest one in any tag **or any commit title on any branch**, plus one, so a session that has not tagged yet still holds its id. `check_repo.mjs` fails when one id is the title of two commits (InBul17 and InBul18 already were, before this rule; they are listed in `scripts/inbul.mjs`), and `--tag` refuses a build whose report still holds placeholder text such as `(write one or two plain sentences)`.
- The scripts act on the repository that holds them, wherever you start them from.
- `CHANGELOG.md` and `build-info.json` are generated. Never edit them by hand. `node scripts/changelog.mjs --regenerate` rebuilds both from `docs/builds` without making a new build; `--pending` does the same as part of a build.
- **The app shows the build.** `build-info.json` is imported into the web bundle (`packages/web/src/release/buildInfo.ts`), so the label ("Build 1006 - 3 Nov 2026") is the build that was shipped. It is at the foot of the app menu on every screen and on the public status page. Merchandisers also get **What's new** in the menu: a dialog with the title, date and summary of the last three builds. The summary is the whole "What changed" paragraph of the build report, so write it as release wording a merchandiser can read: plain, public, no budgets, rates or client detail. `build-info.json` keeps the last 10 builds. Date and label formatting is `release/releaseInfo.ts`; the file written by the script is shaped in `scripts/buildInfo.mjs` (both tested in `packages/web/test/releaseInfo.test.ts`). Supervisors do not get the dialog (it is English only), only the label.
- **Bugs:** a bug found by an audit gets an id (`BE-nnn`) in `bug.md`. When it is fixed, `bugfixed.md` gets an entry that starts with the id and names its test on a line `Test: <file> :: <start of the test's name>`. `scripts/check_bugs.mjs` (part of `npm run check`) fails when a fixed bug has no entry, an entry's id is not in `bug.md`, or a named test file or test does not exist.
- Never put "(Build N)" in a title, move a tag, or add attribution lines to commits.
- Build reports in `docs/builds` are public. They say what changed and how it was checked, never budgets, rates or client detail.
- Run `npm run verify` before every commit. Pull requests use the template in `.github`.

## CI and releases
| Workflow | Trigger | Does |
| --- | --- | --- |
| **CI** (`ci.yml`) | Pull requests and pushes to `main` | Repo checks, Markdown links, colour contrast, bug log, typecheck, all tests, a production web build, and the server tests on Postgres 16 (`test-postgres`). A push to `main` is never cancelled by the next push; a pull request's older run is |
| **Release** (`release.yml`) | A `build-N` tag | Runs the repo checks (banned terms required), typecheck and tests on the tagged commit first, then publishes a GitHub Release whose notes are the build report's "What changed" paragraph only. A report that still holds placeholder text is refused |
| **Dependabot** | Weekly | Proposes npm and GitHub Actions updates |

## Roadmap
1. **Supervisor app, remaining:** supervisors reading and correcting the Tamil (it is written for every supervisor screen but unreviewed), voice notes, and trying it on real low-end phones. (The daily update, offline queue, photos and typed notes are built.)
2. **Order screens, remaining:** setting an order's stages by hand, and an option to re-date existing orders when a holiday is added.
3. **Review gate:** done for warnings, photos and notes.
4. **Buyer view:** done, including the isolation tests on real Postgres (`test-postgres` in CI).
5. **Notes, remaining:** voice notes, and automatic translation and reason suggestions with low-confidence ones sent to review. The original is always kept beside any translation.
6. **Pilot:** one production unit for a week, with baseline measurements.

## Licence
No licence has been chosen yet, so all rights are reserved by default.
