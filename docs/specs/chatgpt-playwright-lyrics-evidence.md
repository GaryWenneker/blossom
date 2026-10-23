# EVIDENCE — ChatGPT lyrics via a saved Chrome profile

- Spec: `/Users/gary/io/blossom/docs/specs/chatgpt-playwright-lyrics.md`
- Spec approval: obtained. The user wrote `go!` on 2026-10-23.
- Tier: 2
- Isolation: none. The approved spec keeps the work on this checkout so the Chrome profile can live in gitignored `.data/`.
- Source: git `196545f55cfb54f62751be8b1064f0340c070064`, plus uncommitted feature files. Not committed.
- Node: v26.8.2
- Fresh run: 2026-10-23, after the last edit (the held-window test).

File hashes (sha256):

| File | sha256 |
|---|---|
| `src/chatgpt-playwright.mjs` | `e9f6f683afa965e38eeacd91447f96ea0c7208555ffa4ba0a8381245514105fc` |
| `src/studio-api.mjs` | `2aad48236ac9623bf6831d4c871504974a6142dde8835905ea0d5b2aa785eeb0` |
| `src/server.mjs` | `81b6d828e99efec09784e8300401b58b8402b3661fc232ff3fcc85bbdb39c3e4` |
| `public/studio.js` | `342505f7b8b734254e50ba553b93a571bca7659484b117e5046458ceec8ae770` |
| `public/app.js` | `58c94e828542cb82e43db4babfbff143ca701b5eaff94e764c3879794d2b946d` |
| `test/chatgpt-playwright.test.mjs` | `dcf1c112ffbad24422400d0c43e09a9108bdf16dd1b6570d250eb7069af45d57` |
| `scripts/chatgpt-lyrics-mutants.mjs` | `fcbe15f7f0c382c042485b984577a96c6a3466983732f3979587b0647c98e7f4` |

Rerun from the repo: `npm test && npm run check && node --test --experimental-test-coverage --test-coverage-include='src/chatgpt-playwright.mjs' test/chatgpt-playwright.test.mjs && node scripts/chatgpt-lyrics-mutants.mjs --control; node scripts/chatgpt-lyrics-mutants.mjs`. The control command is expected to exit 1.

## Spec mapping

| Behavior | Test |
|---|---|
| A paste shorter than 80 characters does not start ChatGPT | `a short paste does not start ChatGPT` |
| A URL paste and an 80-character paste do start it | `a URL paste and a text block qualify` |
| Prompt carries the article and production context, and not cookie, password, or api_key | `the prompt carries the article and production context and nothing secret` |
| Dutch source asks for Dutch lyrics; English does not | `an English article does not demand Dutch lyrics` |
| Fenced JSON is accepted; a brief without lyrics is rejected | `the reply parser accepts fenced JSON and rejects a brief without lyrics` |
| First use opens a visible window on https://chatgpt.com/ and returns no lyrics | `first use opens a visible login window and does not return lyrics` |
| After the composer has been seen, the run is headless and does not call bringToFront | `a saved session runs headless and does not bring the window forward` |
| A headless page with no composer opens a visible window and saves nothing | `a headless session without a composer opens a visible window and returns no brief` |
| A held visible window is closed before the next headless launch | `a held login window is closed before the next headless launch` |
| Unreadable reply is 502 `chatgpt_reply_invalid`; a second run while busy is 409 `chatgpt_busy` | `an unreadable reply fails and a second run while busy is rejected` |
| Empty article and empty URL are rejected before launch | `an empty source is rejected before the browser starts` |
| Chrome channel, downloads off, service workers blocked, non-directory profile refused, off-site page refused | `Chrome launches only against chatgpt.com and refuses a non-directory profile` and `Chrome error paths stay on chatgpt.com and reuse a visible window` |
| Studio labels are English; a URL paste imports, then calls chatgpt-lyrics; a short article paste does not | `the Studio screen asks for ChatGPT and a URL paste imports before generation` |
| A signed-in page is filled and the brief is read | `a signed-in Chrome profile submits the prompt and reads the brief` |
| Route is 401 without a session, 403 on a foreign Origin, 200 with a brief; legacy chatgpt-extract stays local | `chatgpt-lyrics saves a brief and keeps the guards` |
| Login, busy, and invalid replies leave lyrics empty; a blank project is 400 | `login, busy, invalid replies and an empty project leave lyrics unchanged` |

Negative constraints: no cookie copy (launch options and prompt assertions), no Ollama fallback on this route (the fake driver is the only generator the route calls), no brief overwrite on 409/502 (lyrics stay empty), `chatgpt-extract` still does not launch the driver (asserted in the route test; `test/chatgpt-safari.test.mjs` also stayed green inside `npm test`).

## Gauntlet

| Layer | Command | Result |
|---|---|---|
| Full suite | `npm test` (`node --test`) | 137 pass, 0 fail, 0 skipped, 6176 ms |
| Syntax | `npm run check` | exit 0 |
| Changed-line coverage | `node --test --experimental-test-coverage --test-coverage-include='src/chatgpt-playwright.mjs' test/chatgpt-playwright.test.mjs` | `chatgpt-playwright.mjs` line 100.00%, branch 85.86%, funcs 88.00%, uncovered lines none. Focused file: 17 pass, 0 fail |
| Mutation | `node scripts/chatgpt-lyrics-mutants.mjs` | `5/5 killed, source restored`, exit 0. Mutants: forced headed launch, paste threshold 1, lyrics type check removed, busy lock removed, Dutch detector forced false |
| Mutation checker control | `node scripts/chatgpt-lyrics-mutants.mjs --control` | exit 1, `SURVIVED viewport` then `control survivor detected, checker fails closed`. The viewport width change is behavior-neutral, so a green suite is the expected survivor, and the script treats that survivor as a failed control |
| Throwaway mutant for the new test | one-off `if (headless)` → `if (false)` in `open`, then the same test file | `a held login window is closed before the next headless launch` failed (events stopped at `close:false`). Source restored; `if (headless)` is present again |
| Real execution | Studio at `http://127.0.0.1:8787/`, signed in, News to Song | See below |
| Supply chain | no new dependency | `package.json` dependencies unchanged. The check-script line was extended so `node --check` includes the new files |

Skipped, with reason:

- Formatter and a separate linter: the repo's `check` script is `node --check` only.
- Property-based tests: no property library is installed, and the spec authorizes no new dependency. Parser cases cover a fenced brief, a missing lyrics field, and length-capped fields.
- Randomized suite order: the project test runner has no shuffle flag. One fresh run was deterministic (137/137).
- Independent verification: Tier 2. Not performed.

The `Blossom request failed` lines in the suite output are the existing logger printing expected DomainErrors (invalid ChatGPT reply, locked vault, unknown LabelGrid outcome). Those tests passed.

## Live Studio

The launchd server was restarted so it loaded the new route. On the existing Untitled project:

- Generate with an article URL and an empty article field: `POST /api/studio/projects/8ff577bc-32aa-4d45-807f-88e6379099a8/chatgpt-lyrics` returned 422. The toast was the existing importer message that the article could not be read. Chrome was not opened. Lyrics stayed empty.
- Generate after the article field held a paragraph of more than 80 characters: the same route returned 409. The toast was `Sign in to ChatGPT in the opened Chrome window, then paste again.` The profile directory `.data/chatgpt-playwright-profile` was created as mode `0700`. Lyrics stayed empty.

ChatGPT itself was not signed in during this run, so a completed lyric was not written into the live project. The signed-in parse path is the fake-page test above. The Chrome window from that 409 was left open for the one-time sign-in.

## API review

Scope: internal · existing surface, one additive route.

`POST /api/studio/projects/{id}/chatgpt-lyrics` uses the same session cookie, Origin check, and `X-Blossom-Request: ui` header as the other Studio posts. A missing project is the existing 404. The body is the existing project object. `error.code` is added only when the error has a code. `chatgpt-extract` is unchanged.

Gates: Boring ✓ · Compatibility ✓ · Authentication ✓ · Authorization ✓ · Idempotency ✓ (a retry rewrites the brief; a concurrent call is 409 `chatgpt_busy`; the spec accepts that duplicate) · Blast radius ✓ (one Chrome profile, one run at a time) · Pagination N/A · Expensive fields N/A · No implementation leakage ✓ (the login error does not include the profile path).

## Review rounds

No `javascript-review`, `typescript-review`, or `react-review` skill applies: the UI is plain browser JavaScript, not TypeScript or React. Those stacks were reviewed with the generic checklist (errors propagated, names match the file, no leftover debug, behavior stays inside the spec, new branches tested).

| Round | Skills (status) | Findings | Fixed |
|---|---|---|---|
| 1 | `old-coder` usable, `old-coder-api` usable | 1 minor: the Studio paste test assigned `globalThis.document` and did not restore it | restored or deleted in `finally` |
| 2 | `old-coder` usable, `old-coder-api` usable | 1 minor: `src/chatgpt-playwright.mjs:140` closed a held window before a headless launch and had no test | `a held login window is closed before the next headless launch`; throwaway mutant killed it |
| 3 | `old-coder` usable, `old-coder-api` usable | 0 | — |

## Known limits

- ChatGPT can show a login wall to a headless Chrome. That run becomes a visible window and 409, and it does not save lyrics.
- The composer, send, and assistant selectors can break when ChatGPT changes its page. The run then fails instead of inventing a brief.
- Branch coverage is 85.86% with every line executed. Some branches share a line the reporter does not list separately.
- Prepare all, and the AI assistant, still use the local model or an OpenAI API key.
- The green Connections confirmation is still a manual note. This path does not read that Safari session.

Uncommitted files outside this change were left as they were: `src/mcp-oauth.mjs`, `test/mcp-oauth.test.mjs`, `docs/chatgpt-mcp-oauth.md`, and the untracked agent-policy files.
