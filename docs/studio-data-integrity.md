# Studio history and data checks

Artists, song projects, production briefs and audio files are separate records. An artist can have no projects, and a production track in `brief` stage has no generated audio yet. Studio's project selector includes the artist and a short project ID to distinguish equal titles. Use **Projects, history & library checks** to search, load more projects, view history or inspect actual catalog counts.

## Safe editing

- A new ChatGPT action creates one project and keeps its returned ID throughout the operation.
- Lyric edits use a dedicated endpoint and preserve manual production controls.
- First-party saves include an expected revision. A stale edit or late AI response returns HTTP 409 rather than overwriting newer work.
- Historical generation parameters remain in their result snapshot; replaying them does not reset manual settings.
- Title, article, artist, production controls and linked DNA analysis changes can mark a brief stale. Regenerate the brief before paid generation. A focused check also highlights a requested string orchestra conflicting with a saved piano-only brief; it is not a general natural-language contradiction detector.
- Track content is not automatically rewritten when the project changes. Studio reports a mismatch with the historical linked track. Do not treat the currently edited brief as proof of what a previously generated recording contains.

## History and existing data

The migration is additive: it adds project revision/input metadata, version snapshots, retained Suno takes, ordering indexes and relationship guards. Existing project IDs, settings, results, track links and media remain intact. Existing records receive one initial snapshot. Earlier edits overwritten before this update cannot be recreated by the migration. Legacy briefs without recorded input hashes are labelled `legacy_unknown` rather than falsely certified as current.

New artist/result writes are transactional. Invalid parameters or failed writes roll back the entire update. New orphan artist/track references are prevented with database triggers; existing questionable references remain available for investigation. No equal-titled projects are deleted or merged automatically.

Project snapshots retain the reference profile and analysis IDs used at that moment. Source analyses remain in the existing Music DNA revision store. A changed analysis invalidates the current brief without rewriting historical snapshots.

Suno API takes retain the exact submitted preparation recipe, source project revision and brief fingerprint. A completed imported take permits a new take; an active or completed unimported task blocks another submission. The existing latest-job endpoint remains compatible. Explicit browser downloads and manual imports do not independently prove which provider task produced a selected file. Provider acceptance followed by a process crash before local receipt persistence still requires reconciliation with Suno; this change does not invent a provider idempotency capability.

## Read-only production diagnosis

Run this on the machine that owns the database, using the actual absolute paths:

```bash
npm run studio:diagnose -- --db /absolute/path/blossom.db --assets /absolute/path/assets
```

This command opens SQLite in read-only mode without constructing application stores or running migrations. It reports database integrity, artists including those with zero projects, project/track/audio counts, duplicate candidates, orphan relationships and missing project asset files. It does not repair or delete anything. The app's default database path remains relative to its working directory unless `BLOSSOM_DB` is configured; verify the launch configuration before interpreting an unexpectedly empty database.

Before installing schema changes on an existing catalog, keep a consistent SQLite backup (including proper WAL handling) and the media directory. Make recovery decisions only after comparing IDs, version snapshots, files and provider history. Never deduplicate on title alone.

## Additive HTTP endpoints

All endpoints use the existing authenticated local-admin boundary and POST request protection.

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/studio/projects/page?limit=50&cursor=...&q=...` | `{results,total,nextCursor}`; stable date/ID ordering; limit 1–150, optional title/artist search. |
| GET | `/api/studio/projects/:id` | One project including optional integrity and revision metadata. |
| GET | `/api/studio/projects/:id/history` | Stored project snapshots, newest first. |
| GET | `/api/studio/projects/:id/takes` | Retained Suno API tasks with their original recipes. |
| GET | `/api/studio/inventory` | Explicit catalog-wide diagnosis, including duplicate candidates and mismatch IDs. |
| POST | `/api/studio/projects/:id/lyrics` | `{lyrics,expectedRevision?}`; updates lyrics without reapplying generation controls. |

The existing `/api/studio/projects` response remains an array limited to 150 for compatibility. The first-party selector uses the paginated endpoint and offers search/load-more. Existing save/result routes accept optional revision checks without removing existing fields. MCP's existing response shapes remain unchanged; clients can inspect additive revision/integrity metadata. Historical snapshots and the explicit catalog-wide inventory can be large; use them on demand, not in a refresh/poll loop.

## Validation

```bash
npm run studio:check
```

This runs syntax checks, the full regression suite, a failing-on-threshold coverage gate for the new integrity module, four manual regression mutations with restoration, and whitespace checks. See the evidence report for actual results and unverified runtime/platform checks.
