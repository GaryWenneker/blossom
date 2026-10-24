# Music DNA in-progress list: scroll and order

Tier 2. Spec approval: not obtained (autonomous run). The request was to stop the in-progress list jumping back to the top while scrolling, and to show the most recently added recordings first.

Isolation: this working tree. No checkpoint commits. No new dependencies.

## Order

On the Music DNA page, the In progress list shows unfinished work.

- A Spotify Liked Songs import that is still in progress stays the first row.
- Queued and running recordings follow, newest `createdAt` first. An older running recording stays below a recording queued later.
- Recordings with no `createdAt` keep their incoming order.
- Completed and failed jobs stay out of this list.
- The one-second refresh still replaces the section markup. It does not change this order.

## Scroll

The list (`.dna-activity-list`) is the only scroller, capped at 140px.

- A refresh while the list is scrolled to the top leaves it at the top, so the newest row stays in view.
- A refresh while a row is scrolled into view keeps that same row against the top of the visible area, including when a newer recording is inserted above it.
- If that row has left the list, the previous scroll offset is kept instead of resetting to zero.
- This holds for the activity repaint and for a full Music DNA redraw.

## Does not change

- The worker still claims the oldest queued job.
- `jobs()` still returns a status filter oldest-first. The page sorts for display.
- Registration, the catalog, and the top-bar analysis queue are unchanged.
