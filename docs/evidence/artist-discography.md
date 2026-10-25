# Artist discography verification

Verified source: commit `89071c1bfd7b08d39d3aeeda067464f533fd4a91`, tree
`0bce71bb3d7fb7833cd5f3fd9a63e8bb67c8a49f`. The commit adding this report
changes documentation only. Contract: [artist-discography SPEC](../specs/artist-discography.md).
Tier 3 for persistent relationships, concurrent edits and media retention.
Separate specification approval was not obtained (autonomous run); the user
approved the described feature and merge after successful runtime checks.

## Fresh results

| Layer | Command / evidence | Result |
| --- | --- | --- |
| Syntax | `npm run check` | Exit 0 on Node 24 locally and Node 22/24 on GitHub |
| Local suite | `node scripts/verify-discography.mjs` | 307 tests: 304 passed, 0 failed, 3 browser checks skipped locally |
| Real browser and full regression suite | [Node 22 run, job 121109335348](https://github.com/GaryWenneker/blossom/actions/runs/40173551912/job/121109335348) | **307 passed, 0 failed, 0 skipped** |
| Node 24 | [Run 40173551912](https://github.com/GaryWenneker/blossom/actions/runs/40173551912) | Test job passed; browser checks intentionally owned by Node 22 |
| New backend/API coverage | Verifier's native V8 line threshold of 100% | Both modules 100% lines/functions; combined branches 88% |
| Mutation | Same verifier; fresh Node process and source hash checks for each mutant | 5/5 killed; original restored; 10 focused tests passed afterward |
| Ordering properties | 30 deterministic generated permutations, seed 25026 | Exact order and membership preserved |
| Runtime media | Actual authenticated HTTP and Chromium playback of generated WAV | Passed, including pinned media after source removal and byte-range responses |
| Runtime UI | Chromium against the actual Node server and SQLite store | Create, bulk add, move/drag, pin, reload, playback, upload cover, detach, single membership and Escape passed |
| Layout | Actual 1440×1000 and 390×844 screenshots; narrow horizontal-overflow assertion | Screenshots inspected; no horizontal document overflow |
| Other existing jobs | Same GitHub run | Installer and public MCP/OAuth jobs passed |
| Dependency / secret diff | Reviewed committed files; unchanged dependency set; existing secret safety job | No new dependencies, credentials, user database or private media committed |

Rerun everything with `node scripts/verify-discography.mjs --require-browser`
and `CHROME_BIN` pointing to a local Chrome/Chromium executable. The browser
test uses only a temporary database, generated silent WAV and fixture PNG.

## Contract mapping

| SPEC clauses | Concrete checks |
| --- | --- |
| 1: release metadata / kinds | `collections validate artist, kind, date and title`; browser creation and editing dialog |
| 2: existing songs and drafts | `catalog includes drafts, canonicalizes linked production tracks and paginates` |
| 3: addition / artist scope / atomicity | `bulk addition is idempotent, artist-scoped and all-or-nothing`; browser bulk addition and creation from a song |
| 4: order / detach | `reorder accepts only exact permutations...`; generated permutations; live move, drag and unlink |
| 5: stable recording | `album recording is pinned through import...`; `recording selection rejects cross-project assets...`; live playback after Studio selection and removal |
| 6: covers | Authenticated HTTP upload, rectangular-cover rejection and selected song-cover reuse; live browser upload |
| 7: compatibility / revisions | Stale metadata and reorder rejection, atomic rollback, reopen and migration tests; all existing release/Studio tests remain green |
| 8: protected API | Anonymous read 401, missing request header 403, unsupported method 405, invalid input 400, pagination bounds and range tests |
| 9: design / access | Actual screenshots, mobile overflow assertion, labelled controls, keyboard ordering and Escape |
| 10: actual runtime | Passing Chromium scenario in job 121109335348; no fixture-API substitution |

## Review and honest limits

| Review round | Findings and resolution |
| --- | --- |
| 1 | Corrected recording caption for external audio and retained an explicit take choice when creating a release from the picker |
| 2 | Corrected browser fixture origin and made ordering expectations independent of random song IDs |
| Runtime rounds | Three Playwright locators also matched an empty-state button, dialog label or filter group; scoped them to the intended controls without weakening behavioral assertions |
| Final review | No remaining finding; complete runtime and regression suite passed |

Local Chromium launch was blocked by the execution environment; browser
verification ran in the existing GitHub Node 22 job instead. This is evidence
for the checked source with temporary data, not proof that Gary's Mac service
has updated. Native macOS service operation, production provider generation
and distribution were not exercised. Independent agent verification was not
performed. No separate TypeScript/lint toolchain exists in this JavaScript
project; existing syntax checks and runtime tests were used. Coverage figures
apply to the two new backend/API modules, not all client UI branches.
