// "Demo mode" on the server: the one place that says what it is and what it changes.
//
// A hosted review demo is public by design: its logins and buyer links are printed on the sign-in screen, so anything a merchandiser or
// a supervisor can do, anybody on the internet can do. Demo mode is the app built with a pinned factory day (the `dayClock` option, see
// demoClock.ts) unless the caller says otherwise with `demo`. A normal deployment never has a pinned day, so every rule below is off
// there and nothing about it changes.
//
// What demo mode changes (and nothing else):
//   1. accounts, buyer links, templates and the calendar are read-only (403), so nobody can lock another reviewer out;
//   2. the seeded demo accounts never lock after wrong passwords (the per-address sign-in budget still counts);
//   3. a photo is refused (429 quota) once the demo's stored photos are too big or too many for today (the free database is small);
//   4. an update or photo dated after the pinned day is stored on the pinned day instead of being refused (a phone's own calendar runs
//      ahead of the pinned one, and an offline queue restored on a later day must not be thrown away);
//   5. the seeded notes, warnings and demo accounts are put back once a day (demoSeed.ts topUpDemoIfDue).

export interface DemoModeOptions { demo?: boolean; dayClock?: unknown }

/** Is this app a shared, public demo? An explicit `demo` wins; otherwise a pinned factory day means yes. */
export const isDemoMode = (opts: DemoModeOptions): boolean => opts.demo ?? opts.dayClock !== undefined

/** The plain answer for a change the shared demo does not allow. */
export const DEMO_READ_ONLY_MESSAGE = 'This demo is read-only for accounts, links and templates, so nobody can lock another reviewer out.'

/** The demo keeps at most this many bytes of stored photos (the free database holds 0.5 GB in all). */
export const DEMO_MEDIA_BYTES_CAP = 100 * 1024 * 1024
/** ...and takes at most this many photos in one Indian calendar day. */
export const DEMO_PHOTOS_PER_DAY = 20
/** The plain answer (429, code `quota`) for a photo over either limit. */
export const DEMO_QUOTA_MESSAGE = 'The demo has reached its photo limit for today. Please try again tomorrow.'
