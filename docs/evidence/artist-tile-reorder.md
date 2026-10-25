# Evidence — artist roster tile order

Spec: `docs/specs/artist-tile-reorder.md`
Spec approval: not obtained (autonomous run).
Tier: 2. Isolation: current checkout. Source revision `3f1f481` plus this uncommitted change. The worktree also contains unrelated edits.
Node: v26.8.2

## Behaviors

| Behavior | Check |
|---|---|
| Index insert, no input mutation, permutation | `moveItem uses the album-track index insert and keeps a permutation` |
| Grip markup escapes the name and has no tile action | `drag handle names the artist and does not activate the tile` |
| Newest-first, exact permutation, rejected list leaves order, next artist is first | `new artists stay newest-first until the roster is reordered` |
| Old database gains order and a saved order survives reopen | `an existing artist table keeps newest-first until reorder survives reopen` |
| Auth 401, missing UI header 403, save, idempotent repeat, partial 400, no sort field, module served | `POST /api/artists/order saves a permutation for the signed-in admin` |
| Drop posts the moved ids, dragover allows the drop, search is restored | `dropping a grip on another tile saves that order and restores search` |
| Same-tile drop and a failed save do not reload; a non-grip drag does not save | `a failed or no-op drop does not reload the roster` |
| Album drag, create, focus, and photos stay available | `runtime: artist albums, bulk add, recording, drag/keyboard order, unlink, covers and mobile` |

## Gauntlet

| Layer | Command | Result |
|---|---|---|
| Full suite | `npm test` | 349 pass, 0 fail, duration_ms 7711.941083 |
| Syntax | `npm run check` | exit 0 |
| Types | — | skipped: the project uses `node --check`, not a typechecker |
| Line coverage | `node --test --experimental-test-coverage --test-coverage-lines=100 --test-coverage-include=public/artist-order.js test/artist-order.test.mjs` | exit 0. `public/artist-order.js` lines 100.00, branches 90.91, funcs 93.33, uncovered lines none |
| Mutation | `node scripts/verify-artist-order-mutations.mjs` | control survived; killed 5/5 (exits 1). A broken control (`return []`) printed `control mutant was killed; a no-op must stay green` and exited 1, then the control was restored |
| Properties | included in the moveItem test | 4×4 moves keep a permutation. No separate property library |
| Real drag | headless Chrome, origin matched to the server | `POST /api/artists/order` status 200. Visible and saved order changed from Beta, Alpha to Alpha, Beta. Page errors: none |
| Supply chain | — | no new dependencies |
| Suite order | — | skipped: the suite has no random-order runner |

## Review

No JavaScript review skill is installed (`javascript-review`: missing). Reviewed the diff directly. One round: the roster module was called without an import, and `image-paste.js` was imported but not served, so the Artists page stayed on “Loading your label...”. Both are fixed. Next round: no findings.

## Limits

- Dragging uses the pointer. There is no keyboard reorder.
- Touch drag was not verified.
- Two open Artists tabs: the last successful save wins. There is no roster revision.
- The `dragend` cleanup is registered on one line, so line coverage does not prove that callback ran.
