# Draft from analyzed Music DNA recordings

Spec approval: obtained. The user selected "Approved. Build this: search analyzed recordings in the same section, at most three sources in total, and keep real names out of the DNA."

Extends `docs/specs/artist-draft-from-roster.md`. Roster drafts stay as they are.

## Behavior

- The create-artist fieldset keeps the roster checkboxes and adds a search of analyzed Music DNA recordings.
- A result is shown as `Artist — Title` and can be checked. Recordings with no analysis are not choices. An empty analyzed result says `No analyzed recording for that search.`
- Roster artists and recordings together are one to three sources. A fourth check unchecks itself.
- `POST /api/artists/draft` accepts `recordingIds` with `artistIds`. It writes nothing.
- Genre joins roster genres and recording genres, first spelling, cut at 100 characters.
- DNA adds a `Recordings:` block from genre, mood, tempo, instruments, vocal character, and production. It does not include the real artist name, the recording title, lyrics, or a melody.
- Voice, language, and countries change only when a roster artist is selected. A recording-only draft omits those fields, and the form leaves them as they are.
- The name field and the name-review checkbox stay untouched.
- A missing recording is 404 `Recording not found`. An unanalyzed recording is 404 `Recording is not analyzed`. A duplicate recording id is 400 `Duplicate recording`.

## Must not

- Do not call a model or invent a likeness when nothing is analyzed.
- Do not copy a real name into Artist DNA.
- Do not change `POST /api/artists` or the public-host 404.
