# Artist discography

Open **Artists → Open discography** to organize an artist's original music.
The artist's wide banner sits above square cover cards, filters for albums,
EPs and singles, and a compact list of all their songs.

Use **New release** to create an album, EP or single with a title and optional
date. Open its card and choose **Add songs** to select several songs and their
recordings. Studio projects appear alongside standalone production tracks;
a linked production track appears once. A song without audio can be added as
a draft and assigned a recording later. The picker supports searching loaded
songs and loading further pages.

You can also use **Add to album / EP / single** in News to Song, **Add to album**
in Tracks & Suno, or the plus button beside a song in the artist's discography.
Choose an existing release or create a new one from the picker.

Inside a release, drag rows or use the up/down buttons to set the track order.
**Recording** explicitly chooses the take for that release. That choice does
not change when a new Suno take arrives, Studio's selected take changes, or the
take is removed from its source project. Local pinned files stay available to
the album. Removing a row only removes its album membership; the song, source
project and audio remain. One song can belong to both a single and an album.

Upload independent square PNG artwork (up to 20 MB, 12000×12000 pixels), or use
the selected cover of one of the album's songs. Artist banner photos stay
separate. Album title, type and date can be changed with **Edit release**.

Collections organize the local library. Creating an album does not publish it
or create a LabelGrid delivery. Existing rights review and distributor-release
workflows are unchanged. Each collection supports up to 200 entries, with up
to 100 additions per request; lists have cursors and pages of at most 100.
Revision checks reject stale edits instead of overwriting concurrent changes.

## Verification

Run `node scripts/verify-discography.mjs` for syntax checks, the full suite,
backend line coverage and five mutation checks. To require the real browser
test as well, set `CHROME_BIN` to a local Chromium/Chrome executable and run
`node scripts/verify-discography.mjs --require-browser`. The browser test uses
a temporary database, generated silent audio and fixture artwork; it exercises
create, bulk addition, ordering, recording selection, playback, unlinking,
cover upload, persistence and narrow layout. Its screenshots are retained by
the existing Node 22 GitHub test job.
