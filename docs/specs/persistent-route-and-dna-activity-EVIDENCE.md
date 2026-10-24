# Evidence — persistent route and Music DNA in-progress status

Spec: `/Users/gary/io/blossom/docs/specs/persistent-route-and-dna-activity.md`

Spec approval: not obtained (autonomous run). Confidence is lower because the same author wrote the spec and the code.

Source: git `9e98a3f` plus uncommitted working-tree edits. Node v26.8.2. No new dependencies.

## Behaviors

| Behavior | Test |
|---|---|
| Known hash restores that page; anything else opens News to Song | `test/route.test.mjs` |
| Studio pane tabs are not pages | `test/route.test.mjs` |
| App reads the hash, listens for `hashchange`, and polls open jobs with `limit=200` | `test/route.test.mjs` |
| In-progress region lists queued and running jobs, escapes names, hides finished jobs, and shows a percent only when one exists | `test/music-dna-catalog.test.mjs` |
| Summary counts (`1 importing`, `1 running`, `1 queued`) | `test/music-dna-catalog.test.mjs` |
| Job listings include artist and title; limit 2 returns 2; limit 0 and 501 are rejected | `test/music-dna.test.mjs` |
| Registration stays off the page; the page does not say "Analysis queue" | `test/music-dna-catalog.test.mjs` |

## Gauntlet

| Layer | Command | Result |
|---|---|---|
| Full suite | `npm test` (`node --test`) | 191 pass, 0 fail, duration 6437.5515 ms |
| Syntax | `npm run check` | exit 0 |
| Types | skipped | plain JavaScript, no typecheck script |
| Lint | skipped | no ESLint; `npm run check` is the syntax gate |
| Coverage fail-under | skipped | repo has no coverage threshold command. An earlier `node --test --experimental-test-coverage` on the route and Music DNA files reported `public/route.js` 100% lines, 92.31% branches |
| Mutation | 5 hand mutants, each restored | 5/5 killed: unknown hash, studio pane tab, percent clamp, completed jobs, missing artist/title. The invalid-limit check was seen failing before it was added |
| Property tests | skipped | no parser or numeric invariant beyond the clamped percent |
| Live server | login, then `GET /route.js`, `GET /app.js`, `GET /api/music-dna/jobs?status=queued&limit=200` | route 200 `text/javascript`, app contains `pageFromHash(location.hash)`, jobs 200 with 94/94 named queued recordings |
| Browser | opened `http://127.0.0.1:8787/#music-dna` | landed on `/login#music-dna`. This browser has no session, so the Music DNA screen itself was not clicked |
| Supply chain | skipped | no dependency change |
| Suite order | skipped | `node --test` has no random-order flag in this repo |

## Review rounds

| Round | Skills | Findings | Fixed |
|---|---|---|---|
| 1 | `old-coder` usable, `old-coder-api` usable, `javascript-review` missing. Plain JavaScript reviewed with the generic checklist | 1 major: the open list used the default 50-job cap while 94 jobs were queued | raised the poll to `limit=200` and added a count line |
| 2 | same | 0 | — |

## Limits

- An analysis job has no progress percent. Only the Spotify Liked Songs import shows one, and only in the browser session that started it.
- The open list stops at 200 jobs per status.
- A failed status poll leaves the previous text in place.
- Signing in still goes to `/`, so a brand-new login does not restore the hash.
