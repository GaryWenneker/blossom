# Artist draft recording suggestions

Extends `docs/specs/artist-draft-from-music-dna.md`.

Spec approval: not obtained as a separate review. The user reported that `#artist-draft-recording-search` returns no suggestions and that Artist DNA must be built from the selected recordings.

## Behavior

- Typing a partial real artist or song name, at least two letters, lists analyzed Music DNA recordings whose artist or title starts with that fragment. The label stays `Artist — Title`.
- A recording with no current analysis is not a suggestion. When the fragment matches nothing analyzed, the note is `No analyzed recording for that search.`
- A recording already checked stays in the list when the next search does not include it.
- Checking a roster artist or an analyzed recording, one to three sources in total, fills genre and Artist DNA from those sources. A recording adds a `Recordings:` block and does not copy the real artist name or the song title into the DNA.
- If the DNA field already has text, that text stays and the new draft is added underneath it. A later draft in the same form replaces only the previously applied draft and keeps the typed text above it. An empty field is filled with the draft alone.
- The name field and the name-review checkbox stay untouched.
- `GET /api/music-dna/search` without `prefix=1` or `analyzed=1` keeps the previous exact-token search.

## Must not

- Do not invent musical traits for a recording that has no analysis.
- Do not copy a real name or title into Artist DNA.
- Do not save an artist from the search or the draft.
