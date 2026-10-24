# Studio integrity repair evidence

## Outcome and source

The repair prevents the reproduced wrong-project/double-save paths, stale control replay, non-atomic artist/result writes and silent late-result replacement. It adds immutable project snapshots, input/reference provenance, catalog diagnostics, cursor pagination and retained Suno API takes. Existing user records are preserved; ambiguous historical duplicates are not automatically repaired.

Source base: `7967d76599fd75895ec79f4c7b7ceff9b1743240`. The implementation is the commit containing this report, on `fix/studio-data-integrity`. No user working tree or production database was modified during development. The source was tested in the isolated checkout that is being published, with npm dependencies installed there and no private `.env` or live service state copied in.

Workflow: Old Coder Tier 3, with HTTP compatibility review. Spec approval: **not obtained (autonomous run)**; implementation was authorized by the user's request to continue investigation and apply the diagnosed changes. The separate spec was written before implementation. This is lower assurance than independent human review of the executable spec. Independent agent verification was not performed; review below was by the implementing agent.

## Final fresh validation

Runtime: Node.js v24.22.1. Entry point: `npm run studio:check` (also `node scripts/check-studio-integrity.mjs`). The final run completed after the last production/test source edit.

| Layer | Actual final result |
|---|---|
| Repository syntax checks | Passed, including all added runtime and diagnostic scripts. |
| Full regression suite | **277 tests: 276 passed, 0 failed, 1 skipped.** |
| New integrity regression suite | **25 passed, 0 failed**, including real authenticated HTTP requests against the local test server. |
| New integrity module coverage gate | **100% lines, 89.87% branches, 96.30% functions**; enforced thresholds are 100% lines and 85% branches. |
| Manual mutation gate | **4 executed, 4 killed**, original files restored and compared byte-for-byte. |
| Generated sequence invariant check | 30 deterministic edits preserve all 31 snapshots and reject every stale revision. |
| SQLite migration/restart | Legacy on-disk fixture reopened twice; original content and IDs retained, one initial snapshot, orphan preserved for diagnosis. |
| Read-only CLI real execution | Spawned against an actual legacy fixture database; output verified and schema unchanged. |
| Whitespace | `git diff --check` passed. |

Coverage scope is deliberately narrow: the enforced percentage applies to the newly introduced `src/studio-integrity.mjs`, **not all changed lines in UI/API modules**. Those are covered by behavioral regressions and the full existing suite, but no 100% changed-line coverage claim is made for them. The repository is JavaScript and does not have a static TypeScript checker or dedicated linter; its existing syntax gate was used rather than introducing a new toolchain. No dependencies were added or changed.

The coverage threshold failure path was exercised with a 100% branch requirement; the command returned nonzero on the known uncovered branches. This proves that threshold violation reaches the gate's failure path, not that coverage detects every defect. The mutation script first requires a passing unmodified baseline, requires exactly one replacement location per mutation, executes each mutant, rejects timeouts, then restores originals in `finally`.

## Specification-to-test mapping

Tests are in `test/studio-integrity.test.mjs` unless otherwise stated.

| Specification | Behavioral evidence |
|---|---|
| Single create / correct ID | Both populated and empty new-project ChatGPT cases; missing-selected-project case; artist-defaults case. |
| Lyric/control separation | Historical generation-control replay test; authenticated HTTP lyric endpoint preserves instrumental/female settings. |
| Stale-save protection | 409 save/result tests; delayed HTTP AI response after manual edit; 30-edit invariant sequence. |
| Atomic persistence | Invalid-parameter artist test; injected audit failure rolls back artist, result and versions. |
| Immutable history / migration | History/track test; legacy on-disk reopen test; immutable edit sequence. |
| Track provenance | Historical take source revision test; mismatch shown rather than rewriting the track. |
| Asset/brief freshness | Title/instruction fingerprint test; explicit identical regeneration test; existing asset test now correctly identifies old printed titles as earlier artwork. |
| Catalog beyond 150 | 153 equal-timestamp projects visited once through cursors; invalid bounds/cursor tests. |
| Actual inventory | Artist with zero projects included; duplicate candidate grouping; no audit side effects; legacy orphan reported. |
| Multiple API takes | Active duplicate rejected; second completed take allowed; earlier recipe retained. Existing HTTP Suno import suite remains green. |
| Relationship protection | Direct new orphan inserts/updates rejected; legacy orphan retained. |
| Usable artist linkage | New artist select option is added before assignment; legacy selected photo can be linked inside the outer transaction. |
| DNA provenance | Historical analysis ID retained; a new analysis invalidates current input; stale response rejected even without project-row revision change. |
| Read-only production tooling | CLI spawn verifies counts and unchanged schema; missing required database option fails. |
| Focused conflict reporting | String-orchestra request against a saved solo-piano/exclusion direction produces a recipe warning. |

## Review and failures addressed

| Review stage | Findings and resolution |
|---|---|
| Initial diagnosis | Wrong-ID fallback, nested UI save, stale result replay, non-atomic artist writes and missing version boundaries reproduced before repairs. |
| Implementation review 1 | Artist-defaults route bypassed active-ID updates; new select option was missing; identical regeneration could keep an old input hash. Added focused tests and fixed each. |
| Implementation review 2 | Wrapping project writes in a transaction conflicted with a nested artist-image transaction. Added a legacy-photo test; converted image selection to composable savepoints. |
| Final adversarial pass | Hostile pagination inputs, stale revisions, invalid lists/controls, late DNA context and injected audit failure are covered. Final review found no additional actionable defect within the specified scope. |

Initial baseline: 252 tests, 249 passed, 2 failed, 1 skipped. Both failures were stale fake-browser assertions expecting downloads disabled while the shipped explicit MP3-download workflow enabled them. That assertion now tests the existing download contract; visible browser/manual login/host restrictions were retained. The asset-title expectation was intentionally tightened under the new freshness contract.

The first gauntlet attempt named the manual mutation script `test-studio-mutations.mjs`, which made Node auto-discover it during the full parallel suite. It was renamed `verify-studio-mutations.mjs` so mutation only runs in its explicit, sequential gate. An incomplete intermediate command log was not used as evidence; the final complete run includes every named layer and the mutation restoration summary.

## HTTP compatibility/security review

- Existing list/result/save/MCP response shapes and statuses remain available. Revision, integrity and recipe provenance fields are additive. The dedicated lyric and paginated/inventory/history/take routes are additive.
- New endpoints inherit the existing authenticated local-admin boundary and request protection. Unauthorized reads were checked against an actual test server; existing public isolation and OAuth tests passed.
- First-party edits and generation callbacks use revision/input checks. Legacy clients omitting optional revision metadata retain last-write-wins behavior for compatibility; they should adopt revision checks.
- An active/unimported Suno task blocks another API submission. Old completed imported tasks remain stored. No unverified provider parameters, OAuth changes or credentials were introduced.
- Existing rate limits and authorization infrastructure were not redesigned. Catalog inventory and history are explicit, potentially large read operations, not poll-loop defaults. This is not a claim of new per-consumer API rate limiting.

## Limits and deployment distinction

- One rendered viewport test was skipped locally because Chromium is not installed. Static viewport constraints passed; real geometry remains for CI's Chromium job.
- Rust/Cargo is unavailable locally; the installer build remains for GitHub CI. Node 22 execution also remains for CI.
- No live Suno/ChatGPT generation, Cloudflare smoke or Mac launchd verification was performed. These are separate from local repository correctness.
- The actual production database is not available here. The new read-only command is ready to enumerate it on the owning machine. Missing historical tracks or previously overwritten content are not claimed recovered.
- Legacy briefs without provenance remain `legacy_unknown`. Existing content is preserved, not retroactively certified or reconstructed.
- The focused instruction warning is not a complete semantic contradiction detector.
- Manual/browser-selected MP3 imports cannot independently establish provider task identity. Provider acceptance followed by a crash before saving its receipt still requires reconciliation; no unsupported provider idempotency capability is claimed.
- Migration rollback was exercised with disposable SQLite fixtures and failed writes. No destructive schema downgrade is offered; retain a consistent database/media backup before installing on the Mac.
