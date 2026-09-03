# Menu bar card — acceptance checklist

Run before tagging `card-v*`. Everything here needs a real desktop, which is why it is a list and
not a test: anchoring, tray behaviour and dismissal are the parts of a status-bar app that CI
cannot see and that break most often.

Everything below the line is covered by `npm test -w desktop` and `npm test -w cli` and does not
need to be checked by hand — see the note at the end.

## Setup

```sh
npm run build -w desktop
cd desktop && ../node_modules/.bin/electron .   # unpackaged, fastest loop
# or, for the real artifact:
npm run package -w desktop                       # writes desktop/release/
```

`codex-kaboo card --json` prints exactly the payload the card renders. When a number on screen
looks wrong, check it there first — if it is wrong in both, the bug is in the data layer, not the
UI.

## Checklist

| #   | Check                                                                                                            | ✓   |
| --- | ---------------------------------------------------------------------------------------------------------------- | --- |
| 1   | Click the tray icon → the card appears anchored under it, ~6 px gap, fully on screen                            |     |
| 2   | Click the icon a second time → hides cleanly, no flicker, no hide-then-reopen                                   |     |
| 3   | Click outside the card, or switch apps → hides                                                                  |     |
| 4   | Second display, and the icon at the far right of the menu bar → the card stays on that display and inside it    |     |
| 5   | On a MacBook with a notch → the top edge sits below the menu bar, never under the notch                         |     |
| 6   | Run a Codex session → the chart moves within ~5 s; leave it idle → current TPS falls back to 0                  |     |
| 7   | Launch with no `~/.codex-kaboo/config.json` → "Not connected yet" with the login command, no crash               |     |
| 8   | Turn off the network → the age label climbs, the cached numbers stay, no red error                              |     |
| 9   | `Sync now` → the age resets and the totals advance                                                              |     |
| 10  | `Sync now` while a scheduled sync is mid-flight → "A scheduled sync is already running", `state.json` intact    |     |
| 11  | Log out, log in as a different user → no number from the previous account is ever visible, not even for a frame |     |
| 12  | Resize the card, quit, relaunch → the height, the selected tab and the settings all survive                     |     |
| 13  | Settings → Start at login, then reboot → the icon appears with no window in front of you                        |     |
| 14  | Repeat 1–4 on Windows, and on Linux with the AppIndicator extension enabled                                     |     |

Row 10 is the one with teeth: the card runs the collector's own `runSync`, which takes
`~/.codex-kaboo/sync.lock`, and a card that wrote `state.json` behind a running sync would corrupt
the file that tracks what has already been uploaded.

## Already covered by tests — do not re-check by hand

- Anchor geometry: both screen edges, tray at top vs bottom, a second display, and the empty tray
  bounds some Linux desktops report (`desktop/test/anchor.test.ts`).
- Every state the card can be handed, rendered to HTML: no login, no totals, no quota reading, an
  idle chart, a sync in flight, a sync the lock turned away (`desktop/test/render.test.tsx`).
- Settings: defaults, an unknown field, an out-of-range height, a corrupt file
  (`desktop/test/settings.test.ts`).
- The live sampler: first-sight baselining, append-only reads, cumulative `token_count` vs
  per-response `token_usage_record`, a rewritten file, retention (`cli/test/card/sampler.test.ts`).
- The snapshot cache: round-trip, corrupt file, another account's cache, the offline fallback
  (`cli/test/card/card-command.test.ts`).
