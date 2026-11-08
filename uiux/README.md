# Interface snapshots

Pictures of every screen on demo data (not real orders). Nothing here is ever deleted: each set is kept so the screens can be compared over time.

| Set | What it is | Where |
| --- | --- | --- |
| **1.0** | The app as it was at build 1006 (3 Nov 2026), before the UI/UX 2.0 work. **Frozen: never regenerate or edit.** 31 pictures | [1.0/README.md](1.0/README.md) |
| **2.0** | The app as the UI/UX 2.0 work changes it (plan: `audit/POA-UIUX.md`). Written by `npm run snapshots`; each earlier run of 2.0 is kept in `2.0/previous/` | [2.0/README.md](2.0/README.md) |

## Be honest about what 2.0 shows today

The 2.0 pictures in this folder were last taken in **phase 0 (InBul11)**, before the supervisor and merchandiser screens were reworked. They **do not show** the later work: the Violet theme and soft wash, the status stamp, the Today and Update hero cards, the board status tiles, the order-page bento, the Setup checklist, the sign-in and error changes. They are due to be retaken (`npm run snapshots`) once the screens settle; until then, treat them as the early 2.0 set, not the current look.

Where the current look is photographed instead (kept, not copied here):

| Folder | What it shows |
| --- | --- |
| `audit/redesign-supervisor/` | Today and Update, before and after the supervisor redesign (English and Tamil, keyboard up) |
| `audit/redesign-merchandiser/` | The board and the order page, before and after the dashboard redesign (1280 and 390 px) |
| `audit/theme-sweep/` | Before and after pictures of the remaining screens when the theme was swept |
| `audit/setup-phase5/` | The Setup checklist, the Add a person form and Activity, in each state |
| `audit/phone/` | Pictures taken on a real Android phone (phase 1) |

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
