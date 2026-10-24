# Evidence — Draft from analyzed Music DNA recordings

Tier 2. Spec approval: obtained (user selected "Approved. Build this: search analyzed recordings in the same section, at most three sources in total, and keep real names out of the DNA.").
Node v26.8.2. Source state: uncommitted working tree. Independent verification: not performed.

## Spec → test

| Scenario | Test | Status |
|---|---|---|
| Recording traits, no real name | "an analyzed recording drafts traits without the real name" | pass |
| Voice, language, and countries stay | "a recording does not change voice language or countries" | pass |
| Shared genre and three-source cap | "roster and recording share one genre and a three source limit" | pass |
| Search lists analyzed songs only | "a recording search lists analyzed songs and says when none are analyzed" | pass |
| Route reads a recording and saves nothing | "the draft route reads an analyzed recording and does not save an artist" | pass |
| Roster drafts still hold | the earlier roster tests in test/artist-draft.test.mjs | pass |

## Gauntlet

| Layer | Command | Result |
|---|---|---|
| Tests | npm test | 371 passed, 0 failed |
| Syntax | node --check on the edited files | exit 0 |
| Mutation | node scripts/artist-draft-mutants.mjs | killed 7/7 |
| Mutation control | node scripts/artist-draft-mutants.mjs --control | one equivalent survivor detected |
| Types, lint, property tests | — | this project has no typechecker, linter, or property library |

## Known limits

Search only finds recordings already analyzed in Music DNA. A name with no analysis produces "No analyzed recording for that search." Restart the local Blossom server and reload Artists to use the new search.
