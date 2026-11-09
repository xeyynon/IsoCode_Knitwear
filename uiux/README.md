# Interface snapshots

Pictures of every screen on the small test fixture data (invented, not real orders, and not the hosted demo's seed data). Nothing here is ever deleted: each set is kept so the screens can be compared over time.

| Set | What it is | Where |
| --- | --- | --- |
| **1.0** | The app as it was at build 1006 (3 Nov 2026), before the UI/UX 2.0 work. **Frozen: never regenerate or edit.** 31 pictures | [1.0/README.md](1.0/README.md) |
| **2.0** | The app as the UI/UX 2.0 work changes it (plan: `audit/POA-UIUX.md`). Written by `npm run snapshots`; each earlier run of 2.0 is kept in `2.0/previous/` | [2.0/README.md](2.0/README.md) |

## Which pictures are current

The 2.0 pictures are current: they were retaken on 2026-11-10 at Build 1012 (34 pictures), after the three-shape top bar, several reasons for a slow day, the finished area and the dark theme. The set before them, from 2026-11-08, is in `2.0/previous/2026-11-09-2244/`; `2.0/CHANGES.md` says what differs. They show the small test fixture data (a different set from the hosted demo), so figures and names differ from the live demo. The earlier 2.0 pictures are kept in `2.0/previous/`.

## Commands

```bash
npm run dev:api                  # terminal 1
npm run dev -w @isocode/web      # terminal 2
npm run snapshots                # terminal 3: writes uiux/2.0, keeps the earlier 2.0 set in uiux/2.0/previous/, and writes uiux/2.0/CHANGES.md (what changed since)
npm run diff                     # compare 2.0 with the set kept before it (or any two folders), reading only
npm run ux                       # measure: overflow and tap size, 10 screens at 5 widths, touch emulation on phones
npm run load                     # measure: first paint and time to a usable screen on an emulated Slow 3G and Fast 3G (emulation, not a real phone)
npm run phone                    # measure: the keyboard check on a real Android phone over USB (needs adb and a phone signed in)
```

The screenshots taken during the audits (before and during the work) are in `audit/`, and are kept too.
