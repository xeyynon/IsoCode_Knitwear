# Deployment: Company A order tracking

**Live app:** https://isocode-knitwear.vercel.app
**Source:** https://github.com/xeyynon/IsoCode_Knitwear

## Demo logins for the reviewer

The sign-in screen of the live app has an **Evaluator access** panel with these same logins: copy buttons, a show/hide eye for the secret, and **Use these** to fill both fields. All data is invented demo data (the brief's three sample POs plus four illustrative orders).

| Role | Sign in with | What to look at |
| --- | --- | --- |
| Merchandiser | Email `merch@companya.test`, password `demo knitwear 2026` | Order board (red, amber, green, grey with the maths), order setup from a TNA template, order detail and date-change history, **Review**: AI suggestions on Tamil notes, warnings to confirm before buyers see them, photos, buyer links |
| Supervisor, Unit 1 | Phone `90000 10001`, PIN `4826` | My orders today on a phone: B-PO-88240 finishing and B-PO-88213 stitching. Send a count, a photo, a reason and a note, in Tamil or English, online or offline |
| Supervisor, Unit 2 | Phone `90000 10002`, PIN `5937` | Unit 2's stages |
| Supervisor, Unit 3 | Phone `90000 10003`, PIN `6048` | The printed styles |
| Buyer, Company B (read-only) | https://isocode-knitwear.vercel.app/buyer#bl_demoCompanyB_readonly_2026 | Only Company B's orders, milestones, approved photos and confirmed notices |
| Buyer, Company C (read-only) | https://isocode-knitwear.vercel.app/buyer#bl_demoCompanyC_readonly_2026 | Only Company C's |

**The demo's "today" is Friday 6 November 2026** on every real day (`DEMO_TODAY`), so the brief's "qty done" figures keep their meaning however long the review takes. Time of day and sign-in tokens run on real time.

**What the shared demo allows.** Many reviewers use the same logins, so the demo protects itself: the demo logins never lock (a wrong password is still limited per address); adding, stopping or resetting accounts, making or cancelling buyer links, deleting templates and changing closed days are refused with a plain message; a photo is refused after 20 a day or 100 MB in total; a date after the demo day is stored on the demo day. Once a day, the first visit to the Review page puts the seeded notes and warnings back to waiting, so the next reviewer can try them, and each production deploy sets the demo accounts, PINs and buyer links back as published. A real deployment leaves `DEMO_TODAY` unset and has none of these limits.

**Tips:** a supervisor screen opens in Tamil on a phone where no language has been chosen; the switch is on the sign-in screen and in the menu. Try the supervisor screen at phone width (or on a phone), and turn the network off in the browser's developer tools before sending: the update waits on the phone and is sent when the connection returns.

---

## Run it locally

**You need:** Node.js 20.19 or newer (22 recommended), npm 10 or newer, Git. No Docker and no database server: the local demo runs real Postgres in memory (PGlite).

```bash
git clone https://github.com/xeyynon/IsoCode_Knitwear.git
cd IsoCode_Knitwear
npm ci                          # install exactly what the lock file says
npm run verify                  # optional: repo checks, typecheck and all 2,693 tests (a few minutes)
```

`npm ci` ends with a vulnerability summary such as "6 vulnerabilities (3 moderate, 1 high, 2 critical)". All of it is development tooling (Vitest, Vite and their helpers) and none of it is shipped: `npm audit --omit=dev`, which covers what runs in production, reported **0 vulnerabilities** on 9 November 2026.

Start the API and the app in two terminals:

```bash
npm run dev:api                 # terminal 1: API on http://127.0.0.1:8787, loaded with the demo data, today = 6 Nov 2026
npm run dev -w @isocode/web     # terminal 2: the app on http://localhost:5173
```

Open http://localhost:5173 (use `localhost`: on some Windows machines Vite listens on IPv6 only, so `http://127.0.0.1:5173` is refused; to listen on IPv4 start terminal 2 with `npm run dev -w @isocode/web -- --host 127.0.0.1`, or with `-- --host` to reach it from a phone on your network) and sign in with the logins above (the local terminal prints them too). Ports used: the API on 8787 and the app on 5173; `npm run e2e` serves its production build on 4173. The local buyer pages are `http://localhost:5173/buyer#bl_demoCompanyB_readonly_2026` and `...#bl_demoCompanyC_readonly_2026`.

**AI suggestions locally (optional, free):** create a key at https://console.groq.com (API Keys), then start terminal 1 with it set. Nothing is written to a file.

```powershell
# Windows PowerShell
$env:GROQ_API_KEY = "gsk_..."; npm run dev:api
```
```bash
# macOS / Linux
GROQ_API_KEY=gsk_... npm run dev:api
```

**With no AI key** the app runs the same: the review queue says AI suggestions are off, and the merchandiser translates the note and picks the reason by hand. Nothing is guessed.

**Other local commands**

| Command | What it does |
| --- | --- |
| `npm test` | All unit, API and database tests (PGlite) |
| `npm run typecheck` | TypeScript, all packages |
| `npm run check` | Repository guards: no secrets or private files, docs, colour contrast, bug list |
| `npm run build:vercel` | Builds exactly what Vercel deploys, into `.vercel/output` (skips the database step locally) |
| `VITE_API_BASE=same-origin npm run build` | Only the web app. A plain `npm run build` stops with "VITE_API_BASE is not set" on purpose: the address is baked into the bundle (`build:vercel` sets it for you) |
| `npm run e2e` | The offline test in a real browser (22 checks). It starts its own demo API on port 8787, so stop `npm run dev:api` first, or set `E2E_API_PORT=8799` (any free port) |
| `DEMO_DATA=fixture npm run dev:api` | The small test fixture instead of the demo data (the a11y and screenshot scripts check against it) |

---

## How it is deployed

```
GitHub (main) ──push──▶ Vercel build: npm ci, then npm run build:vercel
                              │
                              ├─ static/            the React app (Vite build)
                              ├─ functions/api      the whole Fastify API, bundled into one Node.js 22 function
                              └─ on production only: npm run migrate (as the table owner), then seed:demo --if-empty
                                                     │
                                                     ▼
                                       Neon Postgres (free plan, Singapore)
                                       the app connects as app_user: not the owner, row-level security applies
API function ──HTTPS──▶ Groq (free plan): AI suggestions for notes
```

- **Host:** Vercel (Hobby plan, free). The GitHub repository is connected: a push to `main` builds and deploys production; any other branch gets a preview address. Previews never touch the database: the database variables are set for Production only, so a preview shows the app and its API answers "not set up".
- **Build:** `vercel.json` runs `npm ci` and `npm run build:vercel` (`scripts/vercel_build.mjs`). It writes Vercel's Build Output directly: the web app as static files, the API bundled by esbuild into one function, `/api/*` routed to the function and every other path to the app. Security headers on every response.
- **Database:** Neon Postgres (free plan), added through the Vercel marketplace. Each production deploy runs the migrations (`packages/server/db/migrations`, applied once each, in order, under an advisory lock) as the owner, then loads the demo data only if the database has no orders. The API itself logs in as `app_user`, a login that is not a superuser, does not bypass row-level security and owns no tables; the server refuses to start otherwise.
- **Photos:** stored in Postgres (`MEDIA_STORE=db`, migration 019), because a serverless host has no disk. Only the photo routes can read them, after checking who is asking. For production, `MEDIA_STORE=s3` with a private bucket in an Indian region is supported (README).
- **AI:** Groq's free plan (`openai/gpt-oss-120b`, strict JSON schema). Claude and Gemini are also built in, chosen by `AI_PROVIDER`.
- **Cost:** ₹0. Every service is on a free plan with no card.

**Setting it up again from nothing**

1. Create a Vercel project from the repository (`vercel link`), and connect the Git repository (`vercel git connect`).
2. Add Neon from the Vercel marketplace: `vercel integration add neon`, free plan, then connect it to the project with the prefix `NEON` (`vercel integration resource connect <resource> <project> --prefix NEON`).
3. Run the migrations once as the owner (`DATABASE_URL=<NEON_DATABASE_URL_UNPOOLED> npm run migrate`), then give `app_user` a login and a long random password (`alter role app_user login password '...'`).
4. Set the environment variables below in Vercel (Production), then push to `main` or run `vercel deploy --prod`.

---

## Environment variables

Names only. Values live in Vercel's encrypted settings (secrets marked sensitive) and never in the repository; `npm run check` refuses key-shaped strings and `.env` files.

**Set by hand**

| Name | Secret | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection for the API, as `app_user` (not the owner) |
| `MIGRATE_DATABASE_URL` | yes | Owner connection, used only by the build to run migrations on a production deploy |
| `TOKEN_SECRET` | yes | Signs sign-in tokens; at least 32 random characters. Changing it signs everyone out |
| `GROQ_API_KEY` | yes | Groq key for AI suggestions on notes |
| `AI_PROVIDER` | no | `groq` (also `gemini`, `anthropic`) |
| `MEDIA_STORE` | no | `db`: photo bytes in Postgres |
| `DEMO_TODAY` | no | `2026-11-06`: the demo's fixed factory day. In the hosted build it also turns on the Evaluator access panel (`scripts/vercel_build.mjs` sets `VITE_DEMO_ACCESS=1` when `DEMO_TODAY` is set; a local `npm run dev` shows no panel, and the local terminal prints the logins). Not set in a real deployment |
| `SEED_DEMO` | no | `1`: load the demo data into an empty database on a production deploy |

**Optional** (not set on the demo): `AI_MODEL`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `ALLOWED_ORIGINS` (the app and API share one address, so not needed), `TRUST_PROXY` (defaults to 1 on Vercel), `LOG_LEVEL`, `DB_POOL_MAX` (2 here, 5 elsewhere), `DB_STATEMENT_TIMEOUT_MS`, `WARNING_FULL_REFRESH_MS` (0 here), `VITE_DEMO_ACCESS`, `VITE_API_BASE` (the build sets `same-origin`), and for a bucket instead of Postgres: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_PREFIX`, `S3_SSE`.

**Other variables the code reads** (all optional; names and defaults only)

| Name | Default | Purpose |
| --- | --- | --- |
| `MEDIA_DIR` | unset | Folder for uploaded photos when `MEDIA_STORE=disk`. With both unset, photos are off and the photo routes answer 503 |
| `PORT` | `8787` | Port of the real server (`npm run start:api`). The local demo API (`npm run dev:api`) always uses 8787 |
| `WARNING_FULL_REFRESH_MS` | `300000` (5 minutes) | How often the delay warnings are fully recomputed; `0` makes every refresh a full one |
| `ALLOW_UNSAFE_DB_ROLE` | unset | `1` lets the server start with a database role that bypasses row-level security. Local development only; never set it in a deployment |
| `DEMO_DATA` | demo data | `fixture` loads the small test fixture instead of the demo data (local only) |

Used by scripts and tests only, never by the running app: `E2E_API_PORT`, `E2E_BROWSER`, `E2E_SHOTS`, `LOAD_API_PORT`, `SNAP_OUT`, `TEST_DATABASE_URL`, `SLOWEST_TESTS`, `BANNED_TERMS` and `REQUIRE_BANNED_TERMS`.

**Added by the Neon integration** (prefixed `NEON_`): `NEON_DATABASE_URL`, `NEON_DATABASE_URL_UNPOOLED` and the other `NEON_*` connection parts. The app does not read them directly; they are where the owner connection above came from.

**Provided by Vercel:** `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`.

---

## Limits of this deployment (honest notes)

- Free plans: the Neon database sleeps after a few idle minutes, so the first request after a pause takes a second or two. Groq's free plan allows about 30 AI requests a minute and 1,000 a day; above that a note shows "the AI service is busy" and is asked again after a minute (a busy service does not use up one of the note's 3 tries), never guessed. A daily limit on calls (`AI_DAILY_BUDGET`, default 300) keeps the free plan from running out.
- Free-plan AI prompts may be used by the provider; acceptable here because every note is invented. A real deployment would use a paid plan with a data-processing agreement.
- The demo clock is for review only. A real deployment leaves `DEMO_TODAY` unset, which also removes the Evaluator access panel.
- Not yet checked on real low-end phones or with floor supervisors reading the Tamil (see the Status section of the README).
