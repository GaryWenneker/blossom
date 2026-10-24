# Evidence — Music DNA recording sheet

Tier 2. Spec approval: the user selected "Approve and build the glass sheet" for `docs/specs/music-dna-recording-sheet.md`.

Source: git `7967d76` plus uncommitted edits in `public/music-dna.js`, `public/music-dna.css`, `test/music-dna-catalog.test.mjs`, this spec, and `scripts/music-dna-sheet-mutants.mjs`. Node.js v26.8.2. No new dependencies.

## Spec mapping

| Scenario | Test |
|---|---|
| 1. Hue, year, source, light title before open | `a catalog row shows its hue, year, and source before it is opened` |
| 2. Genre chips, awaiting, failed | existing failed/awaiting test plus the row test |
| 3. Glass dialog with stored profile fields | `the recording sheet is a glass dialog of stored DNA, with evidence color and no lyrics` |
| 4. Open tiles, no details element | same |
| 5. Source-inferred catalog color and audio-observed bar cell | same |
| 6. No lyric body; the not-stored sentence is present | same |
| 7. Hue plate, no img | same (`>TF<`, no img) |
| 8. Close removes the sheet; Analyze stays outside | `closing the recording sheet removes it, and Analyze stays outside the dialog` plus the Enter test's close listener |
| 9. Search, register, Spotify still render | existing catalog and Spotify tests |

## Gauntlet

| Layer | Command | Result |
|---|---|---|
| Full suite | `node --test` | 391 pass, 0 fail, duration 7311.954958 ms |
| Syntax | `node --check public/music-dna.js` | exit 0 |
| Lint | — | skipped: this package has no ESLint script |
| Types | — | skipped: the UI module is plain JavaScript |
| Coverage fail-under | `node --test --experimental-test-coverage --test-coverage-include=public/music-dna.js test/music-dna-catalog.test.mjs` | prints file line 71.47%, branch 84.13%, funcs 85.33%, and exits 0. It is not a changed-line fail-under gate, so it is not counted as one |
| Mutation | `node scripts/music-dna-sheet-mutants.mjs` | KILLED 4/4 (catalog heard, lyrics sentence, audio color, initials), exit 0 |
| Mutation control | `node scripts/music-dna-sheet-mutants.mjs --control` | exit 2, `control: survivor detected` (a legend-only wording change the tests do not assert) |
| Properties | — | skipped: no new parser or numeric invariant |
| Real UI | local `http://127.0.0.1:8787/#music-dna` | row text included `1995 · metadata` and genre chips. Opening Nightcrawlers showed a dialog with `open=true`, background `rgba(16, 22, 20, 0.5)`, backdrop `rgba(8, 14, 12, 0.5)` and `blur(10px)`. `dialog.close()` removed it. Analyze did not open it. The page itself did not scroll |
| Supply chain | — | skipped: dependency set unchanged |
| Randomized order | — | skipped: the runner has no random-order flag |

## Review rounds

| Round | Skills | Findings | Fixed |
|---|---|---|---|
| 1 | `old-coder` usable. `javascript-review` missing. `old-coder-api` not applicable (no HTTP change) | 1 major: the sheet clipped fields below 720px (`overflow: hidden`) | sheet body scrolls inside the dialog |
| 2 | same | 0 | — |

## Known limits

- Music DNA profiles do not store cover art or lyrics. The sheet uses a hue plate and does not fetch either.
- A long analysis scrolls inside the sheet. There is no collapsed raw-JSON block.
- The browser key helper used here does not deliver a real Escape to a native dialog. Closing was checked by `dialog.close()`, which is the event Escape fires, and by the unit test on that listener.
- `musicDnaChrome`'s `showModal` line is exercised by the live page (`dialog.open === true`), not by the coverage run.
