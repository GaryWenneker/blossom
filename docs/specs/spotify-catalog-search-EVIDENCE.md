# Evidence Report — Spotify catalog search and add (Tier 2)

- Spec approval: obtained. The user selected "Approve this spec — build it" for `/Users/gary/io/blossom/docs/specs/spotify-catalog-search.md`.
- Source state: HEAD `9e98a3f`, plus uncommitted working-tree edits. This report is about those edits, not the commit alone.
- Toolchain: Node.js v26.8.2. No new dependencies.
- Entry point: `npm test` (`node --test`).
- Independent verification: not performed (Tier 2).

## Spec → Test mapping

| Scenario | Test | Status |
|---|---|---|
| Search returns tracks and albums | `test/spotify-catalog.test.mjs` :: Search returns tracks and albums | pass |
| Empty and overlong queries are refused | `test/spotify-catalog.test.mjs` :: Empty and overlong queries are refused | pass |
| Add one track | `test/spotify-catalog.test.mjs` :: Add one track | pass |
| Adding the same track again is a duplicate | `test/spotify-catalog.test.mjs` :: Adding the same track again is a duplicate | pass |
| Add an album imports each track | `test/spotify-catalog.test.mjs` :: Add an album imports each track | pass |
| An album over 500 tracks imports nothing | `test/spotify-catalog.test.mjs` :: An album over 500 tracks imports nothing | pass |
| A bad id never leaves api.spotify.com | `test/spotify-catalog.test.mjs` :: A bad id never leaves api.spotify.com | pass |
| The library page offers Spotify search without removing Liked Songs | `test/music-dna-catalog.test.mjs` :: The library page offers Spotify search without removing Liked Songs | pass |
| Must NOT: Liked Songs routes, scopes, and placeholder stay | `test/spotify-liked.test.mjs` (5 tests) and the library markup test | pass |
| Must NOT: no second profile for the same Spotify URL | duplicate track and album tests | pass |
| Must NOT: no Spotify audio analysis | Add one track asserts `analysis` null and `analysisVersion` 0 | pass |
| Must NOT: no MCP tool | no MCP tool was added; existing MCP liked-songs test still passes | pass |
| Must NOT: do not follow a client or Spotify URL | bad-id test and album tests assert no `evil.example` request | pass |

## Gauntlet (final fresh run)

| Layer | Command | Result |
|---|---|---|
| Tests | `npm test` | 191 passed, 0 failed |
| Types | none | N-A: this package has no typechecker |
| Lint + syntax | `node --check` on the edited JS files | exit 0. No ESLint script in package.json |
| Changed-line coverage | `node --test --experimental-test-coverage --test-coverage-lines=100 --test-coverage-include=src/spotify-catalog.mjs test/spotify-catalog.test.mjs` | exit 0. `spotify-catalog.mjs` line 100% (branch 81.48%, funcs 100%) |
| Coverage negative control | same command with `--test-coverage-include=src/spotify.mjs` | exit 1. Reported line coverage 50.48%, under the threshold of 100 |
| Mutation | five hand-applied mutants, each restored | 5/5 killed (search cap 9, album cap 5000, skipped id check, any host allowed, "Already in the library." rewritten) |
| Property-based | none | N-A: no property-test dependency, and the spec forbids new packages |
| Real execution | browser on `http://127.0.0.1:8799/#music-dna` with a fake Spotify fetcher | signed in, searched "Reach the Beach", saw 1 track and 1 album, Add created "The Fixx · One Thing Leads to Another" and "Added 1 recording.", Add album then said "Already in the library." Liked Songs still showed "No sync started yet." |
| Supply chain | no dependency change | new deps: none |
| Suite health | `node --test --test-randomize --test-random-seed=20261024` on the three Music DNA / Spotify test files | 27 passed, 0 failed |

## Review rounds

| Round | Skills (status) | Findings | Fixed |
|---|---|---|---|
| 1 | `old-coder` usable, `old-coder-api` usable, JavaScript review skill missing, React not applicable | 0 | none |

The plural "1 track" / "1 album" wording was fixed before this gauntlet, after a failing test.

## Layers not run as specified

- N-A: static types, property-based tests. This repo has neither tool, and the spec adds no dependency.
- SUBSTITUTED: lint is `node --check`, because `package.json` has no ESLint script. That catches syntax, not style.

## Known limits

- Search returns at most 8 tracks and 8 albums. There is no second page.
- An album with more than 500 tracks is refused and imports nothing.
- If an album import fails after some tracks are saved, those tracks stay. A retry does not duplicate them. Same behavior as Liked Songs.
- Spotify audio is not downloaded. New recordings stay metadata-only until you supply audio.
- `spotify-catalog.mjs` branch coverage is 81.48%. The untested branches are defensive (empty page, oversized page, a batch of only local tracks).
- No new application rate limiter. Spotify HTTP 429 is returned with the existing retry message.
