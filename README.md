<div align="center">

# IsoCode Knitwear
### Order tracking that tells a knitwear exporter, *before* it is too late, which orders will miss their ship date, and why.

[![CI](https://github.com/xeyynon/IsoCode_Knitwear/actions/workflows/ci.yml/badge.svg)](https://github.com/xeyynon/IsoCode_Knitwear/actions/workflows/ci.yml)
[![Release](https://github.com/xeyynon/IsoCode_Knitwear/actions/workflows/release.yml/badge.svg)](https://github.com/xeyynon/IsoCode_Knitwear/actions/workflows/release.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![React 19](https://img.shields.io/badge/React-19-61dafb)
![Postgres 16](https://img.shields.io/badge/Postgres-16%20%C2%B7%20row--level%20security-336791)
![Works offline](https://img.shields.io/badge/phone-works%20offline-6e56b0)
![Tamil and English](https://img.shields.io/badge/language-Tamil%20%C2%B7%20English-6e56b0)

<img src="uiux/2.0/03-board-desktop.png" alt="The merchandiser order board: orders worst first, each with the sum behind its colour" width="900">

<sub>The merchandiser's board on demo data. Every colour comes with an icon, a word and the working behind it.</sub>

</div>

## What it does

Supervisors on the floor send a daily count from a phone, in Tamil, even without a signal. A server works out, for every order and every stage, whether it will ship on time and **shows the reasoning**. Merchandisers see the orders that need attention first. Buyers get a read-only page of only their own orders, and only what a merchandiser has confirmed.

| | |
| --- | --- |
| **One tap from floor to board** | A supervisor enters today's pieces for a stage. The server recomputes the order's colour at once. |
| **A colour you can explain** | *Need 467 a day, making 350 a day, 700 pieces short by 11 Nov.* Every row shows the sum. |
| **Honest by design** | An order with no updates is grey, never green. A rate based on little data is labelled an estimate. Nothing reaches a buyer until a merchandiser confirms it. |
| **Built for a bad signal** | The app opens with no signal, saves every update on the phone first, and sends when it can. A repeated send is never counted twice. |
| **Tamil first for supervisors** | Every supervisor screen is in Tamil (the wording still needs reading by supervisors before the pilot). |
| **Private by construction** | Row-level security is forced on every table, so a forgotten filter cannot leak another buyer's data. |
| **AI reads the notes, a person decides** | A supervisor's Tamil note gets an English meaning and a suggested reason with its confidence, beside the original. Unsure or failed suggestions say so; the merchandiser always decides. |

## Three people, three screens

<table>
<tr>
<td align="center" width="33%"><b>Supervisor, on a phone</b><br><sub>"My orders today": one big button per stage</sub><br><br><img src="uiux/2.0/11-today-list-phone.png" alt="The supervisor list: three stages, progress and an Update button each" width="230"></td>
<td align="center" width="33%"><b>The same, in Tamil</b><br><sub>A supervisor who has not chosen a language sees Tamil straight away</sub><br><br><img src="uiux/2.0/12-today-list-tamil-phone.png" alt="The supervisor list in Tamil" width="230"></td>
<td align="center" width="33%"><b>Buyer, with a private link</b><br><sub>Read-only. Their own orders and confirmed notices only</sub><br><br><img src="uiux/2.0/25-buyer-view-phone.png" alt="The buyer page: orders and planned finish dates" width="230"></td>
</tr>
</table>

## A tour

### The merchandiser's desk

<table>
<tr>
<td width="50%" valign="top"><b>Order detail</b><br><sub>Plan against projected finish on one timeline, closed days hatched, the working behind the colour</sub><br><br><img src="uiux/2.0/21-order-detail.png" alt="Order detail with a timeline, key facts and stage detail" width="560"></td>
<td width="50%" valign="top"><b>Review gate</b><br><sub>Confirm, reword or hide a warning. Nothing is visible to a buyer until you do</sub><br><br><img src="uiux/2.0/24-review-queue.png" alt="The review queue with two warnings waiting" width="560"></td>
</tr>
<tr>
<td width="50%" valign="top"><b>New order, with a schedule preview</b><br><sub>Back-scheduled from the ship date, in each unit's own working days</sub><br><br><img src="uiux/2.0/19-order-form-preview.png" alt="The new order form with the dates each stage must finish by" width="560"></td>
<td width="50%" valign="top"><b>Pilot setup</b><br><sub>People, units, closed days and templates; stop an account or sign someone out of a lost phone in one click</sub><br><br><img src="uiux/2.0/29-setup-people.png" alt="Setup: people who can sign in" width="560"></td>
</tr>
</table>

### On the floor, with a poor signal

<table>
<tr>
<td align="center" width="50%"><b>Saved on the phone, sent later</b><br><sub>"Offline, 1 waiting". The count is safe; Send works when there is signal</sub><br><br><img src="uiux/2.0/15-update-offline-saved.png" alt="An update saved on the phone while offline" width="260"></td>
<td align="center" width="50%"><b>A reason in one tap, and a few words</b><br><sub>In Tamil. A merchandiser reviews notes before anyone else can read them</sub><br><br><img src="uiux/2.0/28-update-reason-note-tamil-phone.png" alt="The update screen in Tamil with a reason chosen and a note typed" width="260"></td>
</tr>
</table>

More pictures of every screen, in English and Tamil, wide and phone-sized, are in [`uiux/2.0`](uiux/2.0/README.md) (what changed since 1.0 is in [`uiux/2.0/CHANGES.md`](uiux/2.0/CHANGES.md)).

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

## Status

An early build, **tested but not yet tried in production**. The calculation engine, database, API, the merchandiser's board, order setup and detail, the review gate, the buyer's read-only view, photos, notes, pilot setup, and the supervisor's offline daily update all work and are covered by automated tests (nearly 2,000, including a real Postgres 16 run in CI). AI suggestions for notes from the floor (an English meaning and a reason, and what happens when the AI is unsure or wrong) are built and tested; voice notes are **not built**. A demo runs at **https://isocode-knitwear.vercel.app** (free plans; how it is deployed and the demo logins: [deployment.md](deployment.md)).

Not yet verified: a production-size Postgres server (the demo runs on Neon's free plan), a real S3 bucket, real phones (the offline checks ran in a desktop browser at phone size), and the Tamil wording with floor supervisors. Every row, with the build that delivered it, is in [docs/status.md](docs/status.md); the open work is in the [Roadmap](#roadmap).

Quality is tracked in the open: [`bug.md`](bug.md) lists every reproduced bug, [`bugfixed.md`](bugfixed.md) how each was fixed and the test that keeps it fixed, and [`optimised.md`](optimised.md) what was made cheaper to run, with measurements. The research behind those is in [`docs/optimisation-research.md`](docs/optimisation-research.md).

## Architecture
```mermaid
flowchart LR
  SUP["Supervisor phone<br/>Tamil, offline queue"] --> API
  MER["Merchandiser web app<br/>board, setup, review"] --> API
  BUY["Buyer link<br/>read-only, one buyer"] --> API
  API["Fastify API<br/>guarded by default"] --> ENG["Run-rate engine<br/>pure function"]
  API --> DB[("Postgres<br/>row-level security")]
  API --> OBJ[("Photo store<br/>disk or private S3")]
```

- **Phones never compute status.** They send dated events; the server recomputes after each one (only the touched order, with one full pass per day).
- **The engine is a pure function** with no database or clock access, so it is fully unit-tested.
- **Security lives in the database.** Row-level security is forced on every table, so a forgotten filter in the API cannot leak another buyer's data.
- **Updates are append-only and idempotent.** A repeated send (flaky network, app killed mid-sync) is recognised by its client id and never counted twice.

**Stack:** TypeScript throughout. React 19 with Vite and React Router (one chunk per screen, so a phone never downloads the board). Fastify on Node. Postgres. Vitest for tests. PGlite (Postgres in WebAssembly) runs the database tests anywhere.

## Repository layout
```
packages/
  engine/    Run-rate engine and TNA back-scheduling (pure TypeScript)
  server/    Fastify API, services, SQL migrations and row-level security tests
  web/       React app: board, order screens, review, setup, supervisor screens, buyer page, status page
  design/    Colour tokens
scripts/     changelog.mjs (versioning), check_repo.mjs, check_docs.mjs, check_bugs.mjs, check_contrast.mjs, and the browser tools
docs/        status.md, optimisation-research.md, and builds/ (one report per numbered build)
uiux/        Screenshots of every screen on demo data: 1.0 (frozen, build 1006) and 2.0
bug.md, bugfixed.md, optimised.md   The bug log, the fix log and the speed-and-cost log
.github/     CI, release and Dependabot configuration
```

## Getting started
**Prerequisites:** Node.js 20.19 or newer (22 recommended) and npm 10 or newer. Docker is not needed.

```bash
npm install
npm run verify        # static checks, typecheck and every test (not the web build: CI also runs npm run build)
```

**Run the whole app locally on demo data** (an in-memory database loaded with the brief's sample POs and four illustrative orders from `packages/server/src/demoSeed.ts`; today is fixed to 6 Nov 2026 so the figures line up):

```bash
npm run dev:api                 # terminal 1: API on http://127.0.0.1:8787
npm run dev -w @isocode/web     # terminal 2: app on http://localhost:5173
```

| Demo account | Sign in with |
| --- | --- |
| Merchandiser | `merch@companya.test` / `demo knitwear 2026` |
| Supervisor, Unit 1 | phone `90000 10001` / PIN `4826` (B-PO-88240 finishing, B-PO-88213 stitching) |
| Supervisor, Unit 2 | phone `90000 10002` / PIN `5937` |
| Supervisor, Unit 3 | phone `90000 10003` / PIN `6048` (the printed styles) |
| Buyer, Company B (read-only) | `http://localhost:5173/buyer#bl_demoCompanyB_readonly_2026` |
| Buyer, Company C (read-only) | `http://localhost:5173/buyer#bl_demoCompanyC_readonly_2026` |

These are throwaway demo credentials. Never reuse them anywhere real. Set `GROQ_API_KEY` (free, console.groq.com), `GEMINI_API_KEY` (free, Google AI Studio) or `ANTHROPIC_API_KEY` in terminal 1 to turn AI suggestions on. `DEMO_DATA=fixture npm run dev:api` serves the small test fixture instead (`m@example.test` / `correct horse battery`, supervisor `98765 43210` / `4321`), which `npm run a11y`, `snapshots` and `ux` check against. `npm run seed:demo` loads the same demo data into a real, migrated, empty Postgres (as `app_user`).

**Production build of the web app:**
```bash
VITE_API_BASE=https://api.example.com npm run build
```
The build deliberately fails without `VITE_API_BASE`: the value is baked into the bundle, and a missing one would silently point production at the wrong place.

## Contents
[What it does](#what-it-does) · [Three screens](#three-people-three-screens) · [A tour](#a-tour) · [Colours](#how-the-colours-are-decided) · [Status](#status) · [Architecture](#architecture) · [Layout](#repository-layout) · [Getting started](#getting-started) · [Configuration](#configuration) · [API](#api) · [Security](#security-model) · [Testing](#testing) · [Workflow](#development-workflow) · [CI and releases](#ci-and-releases) · [Roadmap](#roadmap)

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
| `AI_PROVIDER` | `groq`, `gemini` or `anthropic`: who reads the notes from the floor. Unset: whichever key below is set (Anthropic, then Gemini, then Groq). Neither key: AI is off and the review queue says so (never a made-up suggestion) |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | That provider's key. Keep it in the host's secret settings |
| `AI_MODEL` | Optional. The provider's model; defaults `openai/gpt-oss-120b`, `gemini-3.8-flash` and `claude-opus-5-5` |
| `DEMO_TODAY` | Hosted demo only: every real day reads as this date (`demoClock.ts`), so the seeded figures stay meaningful |
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
| `POST /api/notes/suggest`, `POST /api/notes/:id/suggest` | merchandiser | AI suggestions: for up to 3 notes still waiting for one, or for one note again. 503 when AI is not set up |
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

<details>
<summary><b>Service worker and new versions</b></summary>

`packages/web/public/sw.js` keeps the app itself available with no signal (production builds only; it never touches the API, the app's own queue keeps the updates). A new version installs in the background and then **waits**: it is never swapped in by itself, because new files under a screen that is still open would break it. When one is waiting, a quiet bar at the bottom of the screen says "A new version is ready. Reload when you have finished." (also in Tamil) with **Reload** and **Later**. Reload posts `{type: 'SKIP_WAITING'}` to the waiting worker, which then takes over, and the page reloads once (a flag in the tab stops a reload loop). The bar stays away while the Update screen holds a count, reason, note or photo that is not saved yet, and shows once the update is saved. Saved updates live in IndexedDB, so they are still there after the reload and are sent from there; if the phone only kept the queue in memory (the warned fallback) and something is waiting, the bar is not shown at all. The app also asks the browser for a newer version when it comes back to the front, at most every 30 minutes. The rules are in `packages/web/src/ui/swUpdate.ts` (tests in `packages/web/test/swUpdate.test.ts`), the wiring in `swUpdateStore.ts` and `UpdateBanner.tsx`.

</details>

<details>
<summary><b>Fonts</b></summary>

The fonts ship with the app, so a phone with no Tamil font does not show boxes: `@fontsource/noto-sans` (Latin, weights 400, 600, 700) and `@fontsource/noto-sans-tamil` (Tamil, the same three weights), both licensed under the SIL Open Font License. `packages/web/src/fonts.ts` imports only those six subset files (the weights `styles.css` uses); each has `font-display: swap`, and the token stacks in `packages/design/tokens.css` keep the system fonts as the fallback while a file loads. A new weight in `styles.css` needs its own line in `fonts.ts`. The build's `precache.json` lists the `.woff2` files (not the `.woff` fallbacks the font CSS also names), so the fonts are kept for no-signal use with the rest of the app. Cost, measured on the production build: six `.woff2` files, 83 kB in total (Latin 40 kB, Tamil 45 kB; they are already compressed, so gzip saves nothing), about 0.3 kB more gzipped CSS, and no extra JavaScript. The files load only when a screen first needs them (Tamil text pulls the Tamil ones), and are fetched once, then served from the service worker's cache.

</details>

## Development workflow
Every change is either a **build** or an **InBul** (internal build):

| Kind | What it is | Tag |
| --- | --- | --- |
| **Build** | Something a user would notice: a screen, wording, a status rule, sync behaviour | `build-1000`, `build-1001`, ... |
| **InBul** | Everything else: docs, tests, tooling, research | `InBul01`, `InBul02`, ... |

The tag is the source of truth for the number; commit titles never carry it. Builds are batched (about ten fixes each) so the list stays meaningful.

**Fewer, bigger commits.** One day of work once produced 94 commits on `main` (about 65 of them real changes, the rest merges), most of them one fix each. That buries what matters. The rule from now on:

- **One pull request, one commit on `main`.** Commit as often as you like on your branch, but merge with `gh pr merge --squash` (or the Squash button; the repository allows nothing else), so `main` gets one commit per pull request, titled for the whole change. The pull request title becomes the commit title, so an internal change is titled `InBulNN: ...` with the id from `node scripts/changelog.mjs --next-internal`.
- **One InBul per pull request, not per fix.** Related internal work (a bug round, a tooling clean-up, a docs pass) is one pull request and one InBul id. A follow-up that only fixes the same pull request's own test or typo goes into that pull request, not into a new InBul.
- **Bundle what a user would notice into a build.** A build is a release record, so group a day's or a theme's changes into one (for example one build for the backend bug and speed work, one for a UI round) rather than one per fix. Its report lists the pull requests and InBul ids it covers under "What changed".
- **Dependabot already groups** its weekly updates; major versions are upgraded by hand, one pull request each.

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
5. **Notes, remaining:** voice notes (speech to text, then the same AI step), and measuring the AI's suggestions against the merchandisers' final reasons over the pilot to set the confidence threshold from data.
6. **Pilot:** one production unit for a week, with baseline measurements.

## Licence
No licence has been chosen yet, so all rights are reserved by default.
