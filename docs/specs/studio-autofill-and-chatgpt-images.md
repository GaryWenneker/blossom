# SPEC — Studio auto-fill and ChatGPT images

Status: waiting for approval. No implementation until this file is approved.

Tier: 2. Isolation: the current working tree. A fresh worktree would miss the uncommitted studio UI and the signed-in browser profile this feature has to use.

## Goal

News to Song fills the empty project fields from the current article and the ChatGPT song brief. Album art and the artist photo are generated in the signed-in ChatGPT browser session through Playwright. Draw Things is no longer called for those two assets.

## Scenarios

1. Importing an article URL while the title is empty or `Untitled project` sets the project title to the imported headline.
2. Pasting article text of at least 80 characters, with no URL import, sets the title to the first line of that text, cut on a word boundary at 80 characters, when the title is empty or `Untitled project`.
3. A title the operator typed, other than empty or `Untitled project` or the last auto-filled value, is left unchanged when a new brief arrives.
4. Saving a ChatGPT brief replaces `parameters.imagePrompt` with `coverPrompt` and `parameters.artistPhotoPrompt` with `artistPhotoPrompt`, including when those parameter fields already hold an older headline.
5. Saving a ChatGPT brief sets the project title to `titles[0]` when the current title is empty, `Untitled project`, or equal to the last auto-filled title.
6. Saving a ChatGPT brief sets genre to `suggestedGenre` when genre is still `Country Pop` or the last auto-filled genre, and `suggestedGenre` is non-empty.
7. Saving a ChatGPT brief sets additional styles from the brief `style` string, split on commas, at most 16 items of 100 characters, when additional styles are still `Americana, Acoustic` or the last auto-filled list.
8. Saving a ChatGPT brief sets exclude styles from `exclusions` under the same rule, using the default `imitated voices, unlicensed samples` as the untouched baseline.
9. `POST /api/studio/projects/:id/generate-art` with `kind` `cover` or `artist-photo` asks the ChatGPT Playwright session for one image and stores that file as the project asset. It does not call Draw Things.
10. The image prompt sent to ChatGPT is the current artwork or portrait prompt plus an instruction to produce one square image with no text, letters, or watermark.
11. A ChatGPT reply with no downloadable image returns HTTP 502 and stores no asset.
12. A missing ChatGPT sign-in returns HTTP 409 `chatgpt_login_required` and stores no asset.
13. Prepare all runs the ChatGPT brief, applies scenarios 3–8, then generates the cover and the artist photo through the same ChatGPT image path. It does not call the local model, the OpenAI API, or Draw Things.
14. The asset panel label reads ChatGPT. The status line no longer reports Draw Things availability.
15. The non-functional article tab strip and artwork tab strip are removed. Both prompts stay visible. Music DNA stays in the generation-parameters column.

## Invariants

- Suno stays a manual handoff. This change does not click Generate in Suno.
- Draw Things module and its existing unit tests stay. Studio stops calling it.
- Browser cookies are not read or exported.
- An operator-chosen artist is not replaced. If the roster has exactly one artist and the field is empty, that artist is selected.
- Existing ChatGPT lyrics parsing tests keep their current assertions.
- Distribution, market intelligence, and Music DNA behavior stay as they are.

## Setup

- No new dependencies. Playwright is already used for ChatGPT lyrics.
- No checkpoint commits unless you ask for them.
- Files expected to change: `src/chatgpt-playwright.mjs`, `src/studio.mjs`, `src/studio-api.mjs`, `public/studio.js`, `test/chatgpt-playwright.test.mjs`, `test/studio.test.mjs`, `docs/OPERATIONS.md`, and an evidence file next to this spec.
