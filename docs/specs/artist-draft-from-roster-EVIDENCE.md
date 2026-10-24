# Evidence — Draft a new artist from roster DNA and songs

Tier 2. Spec approval: obtained (user: "Approved. Build this spec.").
Source state: git HEAD `7967d76`, plus the uncommitted artist-draft files. Node v26.8.2.
Entry point: `npm test && npm run check && node scripts/artist-draft-mutants.mjs`
Independent verification: not performed.

## Spec → test

| Scenario | Test | Status |
|---|---|---|
| Two artists produce one draft | test/artist-draft.test.mjs "two artists with different genres" | pass |
| Shared fields keep the first spelling | "shared fields stay as stored on the first artist" | pass |
| Mixed voices | "mixed voices become mixed" | pass |
| Three newest songs | "only the three newest songs with production are used" | pass |
| No usable songs | "an artist with no usable songs still contributes DNA" | pass |
| Twelve countries | "countries stop at twelve" | pass |
| Genre cut at 100 | "a joined genre is cut at 100 characters" | pass |
| DNA limit 3000 | "a long draft stays within the Artist DNA limit" | pass |
| Bad selection | "bad selection is rejected and nothing is saved" | pass |
| Dialog fill leaves name and review box | "the create dialog applies a draft" | pass |
| Fourth source stays unchecked | "a fourth draft source stays unchecked" | pass |
| Picker is in the create dialog | "the create dialog lists roster artists and a draft button" | pass |
| Edit hides the picker | "editing an artist hides the draft picker" | pass |
| Authenticated read, public host 404 | "the draft route is an authenticated read" | pass |
| Must not call a model, copy lyrics or names, or save on draft | the draft tests above | pass |

## Gauntlet

Final run after the last edit.

| Layer | Command | Result |
|---|---|---|
| Tests | npm test | 366 passed, 0 failed |
| Syntax | npm run check | exit 0 |
| Types | — | N/A: this project has no typechecker |
| Lint | — | N/A: this project has no linter |
| Changed-line coverage | node --test --experimental-test-coverage --test-coverage-include=src/artist-draft.mjs test/artist-draft.test.mjs | lines 100%, branches 84.62%, functions 100% |
| Mutation | node scripts/artist-draft-mutants.mjs | killed 6/6 |
| Mutation control | node scripts/artist-draft-mutants.mjs --control | exit 0, one equivalent survivor detected |
| Control is not vacuous | same command with the survivor replaced by DNA_LIMIT = 2999 | exit 1, that mutant was killed |
| Property tests | — | N/A: no property library; the concrete cases cover the merge rules |
| Real execution | temporary server on 127.0.0.1:8791 | Create artist, two roster artists checked, draft filled genre, voice, language, countries, and DNA. Name stayed "Lumen Park". The review box stayed unchecked. Roster stayed at 2. DNA did not contain either source name, the song title, or the lyric |
| Supply chain | — | no new dependencies |
| Suite health | — | N/A: no random-order runner. The suite passed once, in order |

## Review rounds

| Round | Skills | Findings | Fixed |
|---|---|---|---|
| 1 | old-coder usable, old-coder-api usable, javascript-review missing | 1 major: the draft button stayed disabled because a NodeList has no filter/some. 1 minor: a long id list was queried before it was rejected | both fixed, then the suite was run again |
| 2 | same | 0 | — |

## API gates

Internal admin route, additive. POST /api/artists/draft matches the existing POST plus `x-blossom-request` rule. It writes nothing, so it needs no idempotency key. Session cookie is the same gate as the other artist routes. The public host still returns 404. The response is one draft, not a page.

## Known limits

Selection order is the order of the roster checkboxes, newest artist first. A draft does not invent a name. Restart the local Blossom server and reload Artists to use the new dialog.
