# Persistent partial update evidence

Base: `2151503411c83e64a39157881dd99cbdf2ee2034`. Isolated branch: `fix/studio-persistent-patches`. User authorized continued testing and persistent partial updates. Separate human spec approval was not obtained (autonomous run). No production database, credentials or paid providers were used.

## Confirmed defects and repair

Retesting showed that legacy partial saves still defaulted omitted title/article/source/artist fields to empty values, and normal input had no autosave. The new PATCH route updates only named fields, merges nested controls/result fields, enforces the existing authenticated request boundary, and records one atomic revision. A repeated acknowledged lyric edit is now a no-op.

The client buffers individual field changes, persists a browser draft until acknowledgement, serializes saves and retains typing during pending requests. It flushes before switching projects/routes or refreshing the form. Successful acknowledgement updates state/status without replacing the entire editor. A durable request ID protects new drafts against duplicate creation after lost acknowledgement. Disjoint stale changes merge only with matching field base values; same-field conflicts keep the draft and require an explicit choice between local and saved values.

## Final local run

`npm run studio:check` on Node.js v24.22.1 completed after the last code edit:

| Layer | Result |
|---|---|
| Full suite | 294 tests: **292 passed, 0 failed, 2 skipped** |
| Partial save/controller tests | **16 passed** |
| Existing integrity regression tests | **25 passed** |
| New modules' enforced coverage | **100% lines, 90.48% branches** combined; minimum gates: 100% lines / 85% branches |
| Server patch module | 100% lines / 92.41% branches |
| Browser persistence controller | 100% lines / 88.24% branches |
| Manual mutations | Existing 4/4 killed plus new **4/4 killed**, files restored |
| Syntax/whitespace | Passed |

Coverage percentages apply to the named new modules, not every changed UI/API line. The two local skips are Chromium geometry and the actual autosave browser test. CI's Node 22 job must execute those browser checks; the Node 24 job intentionally defers them to Node 22. See the PR checks for remote results. No new dependency or static typechecking/linter framework was introduced.

## Behavioral evidence

- `test/studio-partial-save.test.mjs`: omitted fields preserved, explicit clearing, nested preservation, no-op history, invalid inputs and audit rollback, exact stale-field preconditions, creation retry identity, actual on-disk close/reopen, HTTP authentication/header/origin enforcement.
- `test/studio-persistence.test.mjs`: changed-field payloads, durable backup cleanup only after acknowledgement, serial pending-request edits, reload after conflict, explicit conflict resolution, lost-acknowledgement retry with later edits, unavailable storage/network failures and typing during conflict resolution.
- `test/studio-autosave-browser.test.mjs`: real page input against the actual server, PATCH payload inspection, reload persistence, and flushing pending lyrics before selecting another project. The fixture configures its actual HTTP origin, not a relaxed security boundary.
- `scripts/verify-studio-partial-mutations.mjs`: removing result preservation, removing same-field checks, dropping in-flight typing and omitting the creation request ID each fail the real store/controller tests.

## Review and validation history

The seven initial backend regressions failed before implementation. The controller's first test run exposed lost later edits after a retried creation acknowledgement; that was corrected before integration. Some initial controller cases were written alongside the new module rather than independently observed RED; they are additionally checked by explicit manual mutants, so no blanket claim that every controller test had an initial RED run is made.

Integration review corrected a null initial rendered baseline, reuse of an already-created new-draft controller, migration of a pending new draft's storage key, synchronizing a clean controller after server-generated results, and preserving edits typed during explicit conflict resolution. The existing paste test's mock was updated to return the full project response that the actual API returns, rather than an ID-only stub; its sequence assertions remain intact.

One mutation run was interrupted by an execution-host error and left a deliberate mutant in the isolated checkout. The next baseline correctly failed; the original request-ID line was restored, all four mutations were rerun successfully, then the complete final command was run to completion. The incomplete run is not counted as passing evidence.

## Limits

Actual browser and Node 22 behavior are verified by CI separately from local results. Browser draft storage can be unavailable or cleared externally; Studio reports failure rather than guaranteeing persistence in that condition. Same-field conflicts are never silently resolved. Legacy clients omitting revision/base values remain backward compatible and should adopt PATCH preconditions. Existing production duplicates or previously overwritten songs are not claimed recovered. The Mac app must run the updated code before these behaviors apply there.
