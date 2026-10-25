# Artist discography

Contract: the user approved the described album workflow with “Ga maar bouwen”,
then authorized merge after runtime verification without waiting for CI. Spotify
is the layout reference; retain Blossom's identity and artist media tools.

Implementation specification approval: not obtained separately (autonomous run).
Isolation: branch `feat/artist-albums-20261025` in a separate worktree based on
current main. No production data, provider accounts or deployment changes.

## Acceptance criteria

1. An artist has album, EP and single collections with title, optional release
   date, independent square cover, and an ordered track list.
2. Existing Studio projects and standalone production tracks are selectable;
   a linked project/production track appears once. Draft songs need no audio.
3. Add from a song, from an album, or create a collection from the song picker;
   bulk addition is atomic, repeat additions do not duplicate songs, and songs
   from another artist are rejected.
4. Drag ordering and keyboard move buttons persist a complete permutation.
   Removing an entry retains its source song, every take, and other collections.
5. Each entry pins its chosen recording. New imports, Studio selection changes
   and removal of a Studio asset do not replace or break pinned album media.
   Changing a pinned recording is an explicit album action.
6. Independent square cover upload and reuse of a song cover are supported;
   artist banners are never repurposed as square covers automatically.
7. Revision checks reject stale writes; invalid bulk operations roll back.
   Existing distributor releases and Studio save/generation contracts remain.
8. New internal JSON routes inherit administrator auth, origin/request protection
   and body limits. Reads are paginated/bounded; writes have batch/item limits.
9. Render dark artist/album hero, square cards, filter pills and compact track
   rows. Dialogs support Escape, labels and keyboard controls. Desktop and narrow
   mobile have no horizontal document overflow; retain visible action buttons.
10. Verify the actual authenticated application in Chromium: create, bulk add,
    select take, reorder, remove, reload, upload cover and play pinned audio;
    inspect desktop/mobile screenshots and browser errors before merge.

## Setup and checks

Use existing Node 24, node:test and playwright-core; download a local Chromium
browser for runtime verification. No new package dependencies. Reuse dependencies
from the existing checkout in this isolated worktree. Persist source tests,
browser tests and `scripts/verify-discography.mjs` plus an evidence report here.
Run baseline/full tests, syntax checks, focused V8 coverage and 3–5 manual
mutants with restoration. Verify a second process after database reopen and
review the diff for secrets and backward compatibility. Independent agent
verification is not performed; local automated/runtime evidence is the scope.

Failure model: partial bulk writes (transaction tests), stale ordering (revision
conflict test), unintended song deletion (detach invariants), changing selected
audio (pin regression), unsafe media access (auth/path/MIME tests), duplicate
songs (canonical key/unique constraint), UI-only apparent success (real browser
and post-reload assertions). Mac runtime and CI remain separately unverified.
