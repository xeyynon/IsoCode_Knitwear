# Interface snapshots

Pictures of every screen on demo data (not real orders). Nothing here is ever deleted: each set is kept so the screens can be compared over time.

| Set | What it is | Where |
| --- | --- | --- |
| **1.0** | The app as it was at build 1006 (3 Nov 2026), before the UI/UX 2.0 work. **Frozen: never regenerate or edit.** 31 pictures | [1.0/README.md](1.0/README.md) |
| **2.0** | The app as the UI/UX 2.0 work changes it (plan: `audit/POA-UIUX.md`). Written by `npm run snapshots`; each earlier run of 2.0 is kept in `2.0/previous/` | `2.0/README.md` (created by the first run) |

```bash
npm run dev:api                  # terminal 1
npm run dev -w @isocode/web      # terminal 2
npm run snapshots                # terminal 3: writes uiux/2.0, keeps the earlier 2.0 set in uiux/2.0/previous/, and writes uiux/2.0/CHANGES.md (what changed since)
npm run diff                     # compare 2.0 with the set kept before it (or any two folders), reading only
```

The screenshots taken during the audits (before and during the work) are in `audit/`, and are kept too.
