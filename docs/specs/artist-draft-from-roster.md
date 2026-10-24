# SPEC — Draft a new artist from roster DNA and songs

- Tier: 2
- Spec approval: obtained (user: "Approved. Build this spec.")
- Isolation: this working tree. A fresh worktree has no `node_modules` or local `.data`, so the suite cannot run there without a reinstall. The change lands in the tree that already runs the tests.
- Setup plan:
  - Tools to install: none
  - Git: no checkpoint commits unless you ask for them
  - Files the gauntlet will add, by path:
    - `src/artist-draft.mjs` — pure draft function
    - `test/artist-draft.test.mjs` — scenarios below
    - `scripts/artist-draft-mutants.mjs` — manual mutation runner, restored after each mutant
    - `docs/specs/artist-draft-from-roster-EVIDENCE.md` — written after the gauntlet, not before
  - Files the implementation will edit: `src/server.mjs`, `public/artists.js`, `package.json` (`check` script only, so the new files are syntax-checked)
  - New dependencies: none
  - Entry point after implementation: `npm test && npm run check && node scripts/artist-draft-mutants.mjs`

## Product

On Create artist, you can pick one to three artists already on the Blossom roster. Blossom fills primary genre, language, voice, countries, and Artist DNA from those artists' DNA and the production of their songs. You type a new name, review every field, and save with the existing create action. The draft itself saves nothing.

Music DNA catalog tracks are out of scope. No model is called. The draft is deterministic.

## Behavior

Feature: Draft a fictional artist from existing roster artists

  Scenario: Two artists with different genres produce one editable draft
    Given artist A "Mira Solenne", genre "Alternative pop", language "en", countries GB and US, voice "female", DNA "Close female lead, 86 BPM."
    And A has a newest project with genre "Alternative pop", additional style "intimate", style "soft drum machine", moods "reflective", suggested genre "alt pop", title "Night Window", and lyrics "secret chorus"
    And artist B genre "Latin pop fusion", language "es", countries ES and US, voice "mixed", DNA "Nylon guitar, 102 BPM."
    And B has one project with genre "Latin pop" and mood "warm"
    When the draft is requested for A then B
    Then genre is "Alternative pop / Latin pop fusion"
    And voice is "mixed"
    And language is "en"
    And countries are GB, US, ES, in that order
    And countriesTruncated is false
    And sources are A with songCount 1, then B with songCount 1
    And the DNA text is exactly:

      Musical traits for a new fictional artist. Do not copy a source name, lyric, melody, or vocal identity.

      Genre: Alternative pop / Latin pop fusion
      Voice: mixed
      Languages: en, es

      Traits 1
      DNA: Close female lead, 86 BPM.
      Songs:
      - genre Alternative pop; additional styles intimate; style soft drum machine; moods reflective; suggested genre alt pop

      Traits 2
      DNA: Nylon guitar, 102 BPM.
      Songs:
      - genre Latin pop; moods warm

    And the draft JSON does not contain "Mira Solenne", "Night Window", or "secret chorus"
    And the artist table and project table are unchanged

  Scenario: Shared fields stay as stored on the first artist
    Given two artists whose genres differ only by case, "Alternative pop" and "alternative pop"
    And both voices are "female" and both languages are "EN" and "en"
    When the draft is requested in that order
    Then genre is "Alternative pop"
    And voice is "female"
    And language is "EN"
    And the DNA Languages line is "Languages: EN"

  Scenario: Mixed voices become mixed
    Given one artist with voice "instrumental" and one with voice "female"
    When the draft is requested
    Then voice is "mixed"

  Scenario: Only the three newest songs with production are used
    Given one artist with four projects, newest first: an empty production project, then three projects that each have a style "one", "two", and "three"
    And a fifth older project with style "four"
    When the draft is requested
    Then songCount is 3
    And the song lines are style one, style two, and style three
    And "four" is absent
    And the empty project contributes no line

  Scenario: An artist with no usable songs still contributes DNA
    Given one artist with DNA "Felt piano, 72 BPM." and no projects
    When the draft is requested
    Then songCount is 0
    And the DNA contains "Songs: none"
    And the DNA contains "Felt piano, 72 BPM."

  Scenario: Countries stop at twelve
    Given three artists whose combined country lists contain 13 distinct codes, in selection order
    When the draft is requested
    Then countries has length 12
    And the 13th code is absent
    And countriesTruncated is true

  Scenario: A long draft stays within the Artist DNA limit
    Given one artist whose DNA is 4000 characters and who has one production song
    When the draft is requested
    Then dna.length is 3000
    And dna ends with "..."
    And the song line is absent, because song lines are removed before the text is cut
    Given instead a 2900-character DNA and one short song line that fits under 3000 with the header
    Then the song line is kept and the DNA is not cut

  Scenario: Bad selection is rejected and nothing is saved
    Given a roster of two artists
    When the draft is requested with no ids, with four ids, with the same id twice, or with an unknown id
    Then the errors are, in order, 400 "Choose one to three artists", 400 "Choose one to three artists", 400 "Duplicate artist", and 404 "Artist not found"
    And the artist count is unchanged

  Scenario: The create dialog can request a draft and still saves only on submit
    Given the Create artist dialog is open for a new artist and the name field is "Lumen Park"
    When two roster artists are checked and Draft from selected artists is used
    Then genre, language, voice, country checkboxes, and Artist DNA match the draft
    And the name stays "Lumen Park"
    And the fictional-name checkbox stays unchecked
    And no artist has been created
    When a fourth artist is checked
    Then that box stays unchecked and the page says "Choose at most three artists"
    When the dialog is opened to edit an existing artist
    Then the roster picker and the draft button are not shown
    And submitting the create form still uses the existing POST /api/artists create

  Scenario: The draft route is an authenticated read
    Given a logged-in local admin session
    When POST /api/artists/draft is called with `{ "artistIds": ["<id of A>"] }` and header `x-blossom-request: ui`
    Then the response is 200 and the body is the draft, with no name field
    When the same call has no session
    Then the response is 401 and no artist is created
    And on the public Cloudflare host this path is not allowlisted: it returns 404, the same as POST /api/artists

## Must NOT

- Do not call ChatGPT, Ollama, or any other model.
- Do not copy lyrics, titles, concepts, article text, cover prompts, or source artist names into genre, language, voice, countries, or DNA.
- Do not create, update, or delete an artist or a project while drafting.
- Do not attach the source songs to the new artist.
- Do not change the POST /api/artists create body or the POST /api/artists/{id} update body.
- Do not auto-check "I reviewed this name".
- Do not read or write Music DNA profiles.
- Do not add a dependency.

## Setup notes for the route

`POST /api/artists/{uuid}` is the existing update route. `draft` is not a UUID, so `POST /api/artists/draft` needs its own branch and must be handled before the not-found response. It loads each selected artist with `store.artist` and that artist's projects by `artist_id`, ordered by `updated_at` descending. It must not use `studio.projects()`, because that list stops at 150 rows.

A song is usable when at least one of these is non-empty after trim: `parameters.genre`, any `parameters.additionalStyles` entry, `result.style`, any `result.moods` entry, `result.suggestedGenre`. Song lines keep only the non-empty ones, in that order, joined like `genre Latin pop; moods warm`.

Genre equality is trimmed and case-insensitive. The stored spelling of the first selected artist wins when they match. Otherwise unique genres are joined with ` / ` in selection order and cut at 100 characters. Voice is the shared value, or `mixed` when they differ. Language is the first artist's trimmed language. The DNA `Languages:` line lists each selected language once, in selection order.

If the built text is longer than 3000 characters, remove song lines from the end until it fits. A source whose songs were all removed reads `Songs: none`. If it is still longer than 3000, keep the first 2997 characters and add `...`.

## Revisions

- 2026-10-24: Initial spec from the roster-source choice and the full-draft choice. Not yet approved.
- 2026-10-24: Approved. The 2900-character example does not fit under the required header, so the fitting case is any draft whose header, DNA, and whole song lines are at most 3000 characters. A 4000-character DNA still ends at 3000 characters with `...`, and song lines are removed before that cut.
