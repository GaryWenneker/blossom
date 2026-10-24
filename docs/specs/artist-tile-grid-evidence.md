# Evidence: artist tile grid and search

Tier 2. Spec: `/Users/gary/io/blossom/docs/specs/artist-tile-grid.md`
Spec approval: obtained (user: "Approved. Build it.").
Source: git `7967d76` plus uncommitted working tree. Node v26.8.2.
Isolation: this working tree. No new dependency. No commit.

## Behavior

| Spec | Test |
|---|---|
| Match name, genre, and country display name; ignore voice and language; trim the query | `search matches name, genre, and country display name, and ignores voice and language` |
| Roster `(N)` or `(M of N)`; empty text; `<img>` stays text; no empty text when the roster itself is empty | `roster count and empty text follow the query` |
| Hide non-matches, keep order, write the empty sentence as text | `painting a search result hides non-matches and writes the empty text as text` |
| Search field, tile buttons, photos dialog, DNA and prompt stay in the card details | `the artists page has a search field, tile actions, and keeps photo controls in the card details` |
| A name that looks like markup is escaped | `a name that looks like markup is escaped on the tile` |
| At 960px and up: 16:9 grid, details hidden, tile actions shown, dialog shows media and hides the bio | `wide screens use a 16:9 tile grid and narrow screens keep the banner details` |
| Create, edit, focus, select, delete, and generate requests stay the same | existing artist, focus, and banner tests in the full suite |

## Gauntlet

Final run after the last edit, including mutant restore:

- `node --check public/artists.js && node --check public/app.js && node --check test/artist-tile-grid.test.mjs` then `npm test`: 279 pass, 0 fail, duration 5987.67225 ms.
- Types: skipped. The project has no TypeScript checker.
- Lint: skipped. The project has no ESLint script. `node --check` is the syntax gate and passed.
- Changed-line coverage tool: skipped. No coverage tool is installed, and the spec adds no dependency.
- Mutation, manual, 4/4 killed by `node --test test/artist-tile-grid.test.mjs`, then restored:
  - substring match changed to a prefix match: exit 1
  - filtered count replaced with the unfiltered count: exit 1
  - wide-screen details forced to `display:block`: exit 1
  - empty-state assignment changed from `textContent` to `innerHTML`: exit 1
- Property tests: skipped. No property-test library. The named queries in the spec are asserted directly.
- Real execution: local preview of a copy of the roster, 9 artists. At 1440px the roster was 3 columns of 16:9 tiles with Edit artist, Generate banner, and Manage photos. Search `latin` showed Roster (2 of 9). Search `folk` showed `No artists match “folk”.` Manage photos opened `Photos — Maré Cielo` with the prompt and the empty-gallery hint, and not the DNA block. Closing it put the typed prompt back on that card. Edit artist opened the existing form filled with Evan Mercer. At 390px the tile actions were hidden, the banner details were visible, and the nine cards stacked in one column.
- Supply chain: no dependency change.
- Suite health: one `npm test` run. Not repeated in random order. No new flake observed.

## Review rounds

| Round | Skills | Findings | Fixed |
|---|---|---|---|
| 1 | `old-coder` usable. `old-coder-api` not applicable (no HTTP change). No JavaScript review skill is available (`missing`). Generic checklist used. | 0 | — |

## DNA excerpt

Added after the tile grid. A wide tile shows the first three lines of the artist DNA. Hover or keyboard focus opens a panel with the full note. Markup in the DNA stays text.

- Test: `a wide tile shows part of the artist DNA and keeps the full note for hover`
- Final suite after this change: `npm test` — 280 pass, 0 fail.
- Browser: at 1440px the excerpt is 54px tall while the note’s text is 159px tall. Forcing hover shows the full panel (`display:block`, 213px, scrollable).

The first hover panel hung out of the tile and covered the next row. That is corrected. The tile stays 324px tall with the pointer over the DNA. The popup stays inside that tile (`inside: true`), the nine cards do not overlap (`overlaps: 0`), and the buttons stay clear of the popup.

## Known limits

- The empty-state mutation was killed against a stand-in element, which proves the painter assigns `textContent`. It does not parse HTML.
- Escape and the dialog backdrop use the same `close` path as the Close button. The Close button was clicked in the browser. Escape and the backdrop were not clicked separately.
- Refresh the Artists page to load the new script and stylesheet.
