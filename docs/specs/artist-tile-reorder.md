# Artist roster tile order

Spec approval: not obtained (autonomous run).
Tier: 2. Isolation: current checkout, because the running local Artists page is what this change has to affect.

## API

Internal admin surface, same session cookie, origin check, and `X-Blossom-Request: ui` as `POST /api/artists`.

`POST /api/artists/order` with `{ "ids": ["..."] }` replaces the roster order. `ids` must be an exact permutation of every artist id. Success returns `200` and the same artist objects as `GET /api/artists`, in the saved order, without a `sortOrder` or `sort_order` field. A partial, duplicate, or unknown list returns `400` and leaves the saved order unchanged. Repeating the same `ids` is idempotent. Unauthenticated calls return `401`. A signed-in call without the UI header returns `403`.

`GET /api/artists` stays an unbounded list, matching the existing roster endpoint. There is no roster revision: the last successful save wins. Creating an artist still places that artist first.

## Behaviors

1. `moveItem(["a","b","c","d"], "a", "c")` returns `["b","c","a","d"]` and does not mutate the input. `moveItem(["a","b","c","d"], "d", "b")` returns `["a","d","b","c"]`. The same id, or an unknown id, returns a copy of the input. Every move is a permutation of the input.
2. Before any manual order, artists are newest first. After `reorderArtists`, `artists()` returns that exact order. A rejected reorder does not change it. The next created artist is first. An existing database without `sort_order` keeps newest-first until a reorder, and the saved order survives reopening the database.
3. On the Artists roster, each tile has a grip labeled `Drag to reorder <name>`. Dragging over another tile allows the drop. Dropping that grip on another tile saves the order with `POST /api/artists/order` and reloads. Dropping a tile on itself does not call the API. A failed save shows the error and does not reload. A non-empty artist search is restored after a successful reload. The grip does not open the artist. Open discography, Generate banner, and Manage photos stay on their own controls.

## Must not change

- Album track drag-and-drop and its `POST /api/albums/:id/reorder` contract.
- Artist create fields, banner focus, and photo management.
- Public gateway routes. This endpoint stays on the authenticated admin API.

## Setup

- No new dependencies.
- No git commits unless asked.
- Files: `public/artist-order.js` (served to the signed-in admin as `/artist-order.js`), `public/app.js`, `public/viewport.css`, `src/storage.mjs`, `src/server.mjs`, `test/artist-order.test.mjs`, `scripts/verify-artist-order-mutations.mjs`, `package.json`, `docs/AX-BLOSSOM-KNOWLEDGE.md`, `docs/evidence/artist-tile-reorder.md`.
