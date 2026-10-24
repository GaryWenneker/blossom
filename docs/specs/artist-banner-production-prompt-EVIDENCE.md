# Evidence: artist banner prompts follow DNA and production

Spec: `/Users/gary/io/blossom/docs/specs/artist-banner-production-prompt.md`

Spec approval: the user replied `approved` on 2026-10-24.

Tier: 2.

Source state: branch `artist-banner-music-prompt`, HEAD `7967d76`. The banner change is uncommitted. This checkout also contains other uncommitted work. The suite below ran in that tree. Node `v26.8.2`.

## What the prompt now contains

Both artist-banner generations call `artistBannerPrompt`:

- Artists screen: `POST /api/studio/artists/:id/generate-photo`
- Studio project: `POST /api/studio/projects/:id/generate-art` with `kind: "artist-photo"`

The visual brief includes the artist name, genre, voice, and Artist DNA, then the songs being made (genre, additional styles, style, moods, suggested genre), analyzed Music DNA style for that artist name, and, for a project, that project's reference production style. A fixed sentence requires the pictured look to match the production: club, house, techno, or aggressive electronic work must not look soft, sweet, innocent, or acoustic. A caller-supplied sentence stays at the front and does not replace that block. Album cover prompts are unchanged.

## Spec mapping

| Behavior | Test |
|---|---|
| House DNA and song style are in the prompt; a soft portrait is not requested | `house production is named in the banner prompt and a soft portrait is not requested` |
| Acoustic song style is in the prompt | `acoustic production is named in the banner prompt` |
| Caller text stays, and DNA plus production are still appended | `a caller prompt stays and the production block is still appended` |
| No finished song uses genre and DNA only | `no finished song uses artist genre and DNA only` |
| Analyzed style is included; a reference artist name is not added | `analyzed recording style is included and a reference artist name is not invented` |
| One project does not include another song | `one project keeps only that project's songs` |
| Three newest songs; the fourth is dropped | `artist-screen selection keeps the three newest songs and drops the fourth` |
| Another artist's newer song is excluded | `artist-screen selection ignores a newer song from another artist` |
| Length stays at or under 4000 and the binding sentence remains | `the prompt stays within 4000 characters and never drops the binding sentence` and `capped DNA and production stay inside 4000 characters when every field is long` |
| Artist-screen HTTP prompt contains DNA, the empty-song sentence, and the binding sentence | `Artist photo API is authenticated, can generate directly for artists and can switch gallery backgrounds` |
| Cover prompt unchanged; project photo prompt starts with the brief and includes style, mood, DNA, and the binding sentence | `Studio generates and saves lyrics, Suno controls and both ChatGPT images without Draw Things` |
| A project with no artist does not generate | existing assertion in the artist photo API test (`409`, generation count stays 1) |

## Gauntlet

Final run after the last edit, in this order: `node --check` on the touched files, `node scripts/artist-banner-prompt-mutants.mjs`, `node --test`, then coverage of the new module.

| Layer | Command | Result |
|---|---|---|
| Syntax | `node --check` on `src/artist-banner-prompt.mjs`, `src/studio-api.mjs`, `test/artist-banner-prompt.test.mjs`, `test/studio-chatgpt-roundtrip.test.mjs`, `scripts/artist-banner-prompt-mutants.mjs` | exit 0 |
| Full suite | `node --test` | 314 pass, 0 fail, 0 skipped, 7125.996875 ms |
| Types | no TypeScript project | skipped |
| Lint | no ESLint script or dependency | skipped |
| Line coverage | `node --test --experimental-test-coverage --test-coverage-include=src/artist-banner-prompt.mjs test/artist-banner-prompt.test.mjs` | `artist-banner-prompt.mjs` line 100.00%, branch 80.95%, functions 100.00%, uncovered lines none |
| Mutation | `node scripts/artist-banner-prompt-mutants.mjs` | killed 6/6 (dna cap, drop binding, keep four songs, ignore artist boundary, drop empty-song sentence, ignore caller) |
| Mutation control | `node scripts/artist-banner-prompt-mutants.mjs --control` | exit 0 after reporting `SURVIVOR music cap loosen` and `control: known-bad survivor detected`. That mutant raises the music cap from 1000 to 1001, which these tests do not assert. The normal run does not include it. |
| Property tests | none | skipped. The length budget is an explicit example, not a generated property. |
| Real execution | HTTP tests call `StudioAPI.handle` | the prompt builder ran. ChatGPT itself was the test double, so no image was generated. |
| Supply chain | no new dependency | skipped |
| Suite order shuffle | no random-order runner | skipped |

Node's coverage report exits 0 even when branch coverage is below 100%. The changed-line figure for the new module is 100.00% with no uncovered lines. The branch figure is 80.95%. The uncovered branch is the fallback that clears the caller only when the capped identity and production block is already at the 4000-character ceiling. The longest capped block measured in the max-field test stays under that ceiling.

## Review rounds

| Round | Skills | Findings | Fixed |
|---|---|---|---|
| 1 | `old-coder` usable. `javascript-review` missing. `old-coder-api` not applied: request and response JSON shapes are unchanged. | 2 (1 major, 1 minor) | R1-1, R1-2 |
| 2 | same | 0 | — |

R1-1, major: `selectBannerSongs` kept the first three projects even when a newer project belonged to another artist. A new test failed, then the function gained an `artistId` filter, and `bannerPromptSources` passes that id.

R1-2, minor: the roundtrip test compiled `brief.style` as a regular expression. It now checks `startsWith` and `includes`.

## Known limits

- Raising the 1000-character music cap or the 800-character DNA cap until the identity block itself exceeds 4000 characters would return a prompt over the limit. The current caps do not reach that point.
- A Studio project whose artist row is gone throws while building the banner prompt.
- Stored additional styles are copied into the prompt, including a project's default styles.
- The mutation control proves the runner reports a survivor. It does not prove every possible bad edit is detected.
