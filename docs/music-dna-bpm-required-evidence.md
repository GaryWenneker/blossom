# EVIDENCE: every musical analysis includes a BPM

Spec: `/Users/gary/io/blossom/docs/music-dna-bpm-required-spec.md`

Spec approval: not obtained (autonomous run). Confidence is lower because the same agent wrote the spec and the code.

Tier: 2. Isolation: current checkout. HEAD `3f1f481` plus a dirty worktree that also contains unrelated local edits. This change does not claim those other files.

Node: v26.8.2. No new dependencies.

## Behaviors

| Spec | Test |
|---|---|
| 1. Prompt requires a BPM and does not say `or null` | `a catalog analysis is rejected unless it includes a BPM from 20 to 350` |
| 2. Finite BPM in 20–350 is kept, including 20, 350, 98.6, and `"120"` | same test |
| 3. Missing, null, non-numeric, boolean, empty, below 20, or above 350 throws `/omitted a BPM/` | same test |
| 4. `saveAnalysis` without BPM throws `/BPM is required/` and stores nothing | `a musical analysis without a BPM is not stored` |
| 5. Signal-only PCM measurement may omit BPM | `Worker only processes authorized local audio and stores measured rather than fabricated DNA` (`analysis.bpm === null`) |
| 6. Catalog method stays `chatgpt-catalog` with `measurements: null` | `a ChatGPT reply becomes catalog DNA and cannot claim an audio measurement` |
| 7. Stored history is not rewritten and no jobs are queued by this change | no migration; not executed against the live library |

## Gauntlet

| Layer | Command | Result |
|---|---|---|
| Full suite | `node --test` | 339 pass, 0 fail, duration_ms 7410.610625 |
| Syntax | `node --check` on `src/music-dna.mjs`, `src/music-dna-chatgpt.mjs`, the touched tests, and `scripts/music-dna-bpm-mutants.mjs` | exit 0 (`CHECK_OK`) |
| Types | skipped | plain JavaScript, no `tsc` in this repository |
| Lint | skipped | no ESLint script; `npm run check` is `node --check` |
| Coverage | `node --test --experimental-test-coverage --test-coverage-lines=90` on the two source files and their direct tests | exit 0. `music-dna-chatgpt.mjs` line 97.54% branch 83.33% funcs 100%. `music-dna.mjs` line 97.57% branch 82.81% funcs 98.33%. Uncovered lines are pre-existing (115–117, 11–12, 530–532, 597–601, 626–631), not `catalogBpm` or `bpmForAnalysis`. This gate is file-level, not a changed-line diff |
| Mutation | `node scripts/music-dna-bpm-mutants.mjs` | killed 7/7, exit 0 |
| Mutation control | `node scripts/music-dna-bpm-mutants.mjs --control` | exit 1 (`SURVIVED` no-op). With `if (failed) process.exit(1)` removed, the same control exited 0. That shows the exit check is what fails the control; it does not prove every possible bypass |
| Property tests | skipped | BPM is a bounded number, covered by explicit edges 20 and 350 |
| Supply chain | skipped | dependency set unchanged |
| Real browser | skipped | the library column already prints `analysis.bpm`. This change does not alter saved rows, so the open page cannot show new BPM values until those recordings are analyzed again |

## Review rounds

| Round | Skills | Findings | Fixed |
|---|---|---|---|
| 1 | `old-coder` usable, `old-coder-api` usable, `javascript-review` missing | 1 minor: inclusive bounds 20 and 350 were specified and not asserted | added those asserts and two mutants (`<= 20`, `>= 350`) |
| 2 | same | 0 | — |

## API

Internal save path. `bpm` is now required for every musical analysis. Signal-only PCM stays optional. First-party fixtures that omitted BPM now send one. No new route, auth change, or pagination change.

## Known limit

Analyses already stored without a BPM stay that way. Blossom does not invent a tempo for them.
