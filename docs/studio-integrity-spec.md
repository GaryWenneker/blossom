# Studio data integrity repair specification

Authorization: user requested continued investigation and implementation of the diagnosed repairs. Work proceeds autonomously against the published diagnosis; separate human spec approval was not obtained. Tier 3: unintended data overwrite, concurrent edits and additive migrations.

## Setup and boundaries

- Isolated checkout on `fix/studio-data-integrity` from current main; preserve other working trees.
- Use existing Node.js test runner, SQLite and dependencies; no new runtime packages.
- Persist regression tests in `test/studio-integrity.test.mjs` and API/UI regression tests as needed.
- Persist implementation and documentation in this repository, with a reviewable commit and pull request after validation.
- Do not modify the running Mac database, secrets, provider accounts, or submit paid music generations. Do not deduplicate/delete/merge historical user content automatically.
- Keep existing HTTP/MCP response shapes; use additive optional fields and new endpoints for pagination, history and inventory.

## Executable acceptance criteria

1. New-project ChatGPT action performs one creation with empty or populated lists; unrelated projects stay unchanged. A missing selected project never silently selects another record for writing.
2. Saving lyrics does not reapply old generation parameters. A repeated old result parameter block does not reset manually corrected controls.
3. Optional expected revision rejects stale saves/AI responses with 409 and leaves all data unchanged.
4. Invalid AI results create no artist, partial result or audit side effect; valid result/artist updates commit atomically.
5. Full immutable project snapshots survive subsequent edits and restart. Existing projects migrate once without losing IDs, settings, assets, track links or results.
6. Track source snapshots are explicit; later project edits report mismatch rather than silently rewriting historical tracks or approved work.
7. Asset freshness includes title, controls and prompts. Current-generation recipes surface stale briefs and instruction conflicts; the UI requires resolving stale input before paid generation.
8. A new paginated project collection has deterministic cursor ordering, validated bounds, total and nextCursor; the existing list remains an array. Every project remains accessible beyond record 150.
9. A read-only inventory reports actual artists (including artists without projects), projects, briefs, audio, duplicate candidates and orphan/mismatch findings without repairing them.
10. Multiple completed Suno takes can be retained. An active job remains protected from duplicate submission; every retained take stores its immutable recipe. Import uses the submitted recipe/brief fingerprint, not subsequently edited controls.
11. New invalid artist/track relationships are prevented while existing questionable records remain available for diagnosis.
12. UI shows artist, short project ID/status, historical brief state and separate actual audio/brief counts; title changes are deliberate and old project titles are not overwritten automatically.
13. Input fingerprints and history retain linked reference analysis IDs and weights. Changing reference selection or updating a DNA analysis invalidates the old input; late responses cannot silently apply that old context.

## Failure model and checks

- Wrong ID / duplicate create: actual UI action tests with real in-memory Store.
- Stale replay / late response: revision conflict tests, manual-edit preservation and recipe tests.
- Partial writes: invalid parameter and injected audit failure rollback tests.
- Migration data loss: on-disk legacy database fixture, reopen twice and compare content/links/counts.
- Historical drift: immutable snapshot and retained Suno recipe tests.
- Hidden catalog rows: more than 150 records, equal timestamps, cursor boundary and hostile input tests.
- Broken existing consumers: full `npm test`, `npm run check`, existing MCP/OAuth and asset suites.
- Release confidence: manual adversarial review, targeted manual mutations, coverage report where available; disclose environmental limitations.

## Definition of completion

All repair regression tests pass, no new baseline failures, changes reviewed, documentation and reproducible evidence recorded. Distinguish local checks, GitHub CI, repository merge and actual Mac runtime verification.

## Investigation addendum

Baseline: 252 tests, 249 passed, 2 failed, 1 skipped. Both failures originate in the fake Suno browser expecting `acceptDownloads=false`; the shipped MP3 download workflow already sets it to true. Align that assertion with the existing explicit-download contract; keep visible-browser, host restrictions and manual login checks unchanged. The existing cover test expected a retitled cover to remain current; the new acceptance criterion intentionally identifies the old printed title as earlier artwork.
