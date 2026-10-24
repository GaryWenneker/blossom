# Persistent route and Music DNA in-progress status

Tier 2. Spec approval: not obtained (autonomous run). The request was to keep the current page across refresh and to show in-progress Music DNA work, with a percent only when one is known.

Isolation: this working tree. A fresh worktree would omit the uncommitted Music DNA changes this behavior sits on. No checkpoint commits. No new dependencies.

## Route

The dashboard is one HTML document at `/`. Pages are `studio`, `music-dna`, `overview`, `artists`, `tracks`, `releases`, `intelligence`, `genres`, `connections`, and `compliance`.

- `#music-dna` opens Music DNA. The same form applies to every page above.
- An empty hash, or a hash that is not one of those pages, opens News to Song (`studio`).
- Choosing a page writes that hash with `history.pushState`, so Back and Forward return to the previous page.
- Refresh on `/#music-dna` opens Music DNA again. Refresh on `/` opens News to Song.
- `?spotify=connected` still opens Connections and then replaces the URL with `/`.
- A control with `data-action="studio-bottom-tab"` does not change the page or the hash. It keeps switching the studio pane.

## In progress

On the Music DNA page, an "In progress" region lists work that is not finished.

- Each queued or running analysis job shows `Artist — Title`, the status `Queued` or `Running`, and a percent. A queued job is 0% until analysis starts. A running ChatGPT job shows the callback percent.
- Start analysis runs queued recordings that have no reference audio through ChatGPT, one at a time, without bringing the browser forward. The page re-reads open jobs about every second.
- Completed and failed jobs stay out of this region. They remain in the top-bar Analysis queue.
- Spotify Liked Songs import, while running or paused in this browser session, shows `Importing` or `Paused`. When the library total is greater than zero, it also shows `round(received / total * 100)`, clamped to 0–100.
- When nothing is in progress, the region says `Nothing in progress.`
- Names and errors are HTML-escaped.
- While Music DNA is the open page, open jobs are re-read about every second and the region updates without reloading the catalog. A failed poll leaves the last statuses in place.
- Each poll asks for up to 200 queued jobs and 200 running jobs. The region starts with a count such as `94 queued`. `jobs()` rejects a limit below 1 or above 500.
- `GET /api/music-dna/jobs` includes `artist`, `title`, `hasAudio`, and `progress` for each job. Missing profiles use empty strings.

## Does not change

- Registration stays in its dialog.
- The page does not contain the heading `Analysis queue`.
- Unknown job statuses are still rejected by `jobs()`.
- No new package. `POST /api/music-dna/jobs/start` starts the background ChatGPT analysis and returns immediately.
