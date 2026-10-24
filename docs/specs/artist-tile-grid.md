# Artist tile grid and search

Tier 2. Spec approval: obtained (user: "Approved. Build it.").

Isolation: this working tree. Uncommitted artist UI already lives here, and a fresh worktree would drop it. No checkpoint commits unless asked. No new dependencies. No new HTTP endpoint.

The Artists page currently stacks one full-width banner per person. Each banner is up to 560px tall and then shows DNA, tags, generate, and the photo strip, so a wide screen shows about one artist.

## Wide screens

At a viewport width of 960px or more, the roster is a grid of compact tiles. `repeat(auto-fill, minmax(280px, 1fr))` fills the content width, so a laptop shows at least two columns and a wide desktop shows more.

Each tile shows:

- the selected banner as a 16:9 crop, using that photo's saved focus (`object-position`). No banner yet: the existing initial placeholder.
- the artist name
- the primary genre
- three buttons: `Edit artist`, `Generate banner`, `Manage photos`

The tile does not show the country tags, the name-reviewed tag, the custom-prompt field, or the photo strip.

The tile does show the artist DNA. The first three lines are visible. The rest is clipped. Hovering that text, or focusing it with the keyboard, opens a popup with the full DNA. The popup floats inside that same tile on a blurred background at 50% opacity, with light text so the note stays readable. It does not change the tile’s size and it does not cover neighboring tiles. The panel is not a second copy for assistive technology: the visible excerpt element already contains the full note, and the hover panel is hidden from it. Markup in the DNA is shown as text.

`Edit artist` opens the existing create/edit dialog. DNA, countries, voice, language, and the name-reviewed checkbox stay there.

`Generate banner` uses the same generate action as today. It sends that artist's custom prompt. The prompt starts empty, so a click with no typed prompt generates the same way as an empty prompt does today.

`Manage photos` opens one dialog for that artist. The dialog title is `Photos — {name}`. It contains the photo strip (use as background, set focus, remove), the optional custom-prompt field, and the existing hint when the artist has no photos. Close, Escape, and the backdrop dismiss it and change nothing. The prompt text the user typed stays, so a later `Generate banner` on the tile still sends it.

## Narrow screens

Below 960px the roster stays the current one-column banner: tall hero, DNA, tags, edit, generate, custom prompt, and photo strip on the card. `Manage photos` is not shown there, because those controls are already on the card.

## Search

Both widths show a text field above the roster, labelled `Search artists`, placeholder `Name, genre, or country`.

- Matching is client-side. Nothing is requested from the server.
- The query is trimmed. An empty query shows every artist.
- Comparison is case-insensitive. A tile matches when the name, the genre, or any country display name contains the query as a substring. Language and voice are not searched.
- `merc` matches Evan Mercer. `COUNTRY` matches genre Country Pop. `united` matches a country named United States. `zzz` matches nobody. A query of spaces matches everybody.
- Unfiltered heading stays `Roster (8)` for eight artists. A filter that leaves two shows `Roster (2 of 8)`.
- No matches: the grid shows `No artists match “{query}”.` The Create artist button stays. The query is text, so a query of `<img>` does not insert an element.
- Order stays the roster order. Filtering hides non-matches; it does not remove them or sort them.
- Typing in search does not close Create, Edit, focus, or Manage photos.

## Does not change

- Create, edit, focus, select, delete, and generate requests, status codes, and stored fields.
- Photo focus math and the focus dialog.
- The Studio artist-photo preview.
- Public MCP and OAuth routes.
- Album covers.

## Setup

Files the work may change: `public/artists.js`, `public/app.js`, `public/viewport.css`, a new `test/artist-tile-grid.test.mjs`, and `test/viewport.test.mjs` only if a width assertion is added there. No package install. No git commit unless asked.
