# Persistent partial Studio updates

User request: retest the behavior and make changes persistent with partial updates. Autonomous implementation authorized; separate spec approval not obtained. Follow the existing Old Coder workflow in an isolated feature branch from current main. No new dependencies; no production data modifications or paid provider operations.

## Acceptance criteria

1. An omitted project field never clears an existing value. Explicit empty text clears only that field. Nested parameter/result patches preserve unrelated fields and never replay generation controls.
2. Authenticated `PATCH /api/studio/projects/:id` accepts `{changes,expectedRevision?,baseValues?}`. Reject unknown/read-only fields, invalid values, null blocks and unsafe origins/headers. Failure is atomic. No-op patches do not create revisions/history.
3. Stale updates without field preconditions fail with 409. With exact base values, disjoint edits merge; same-field conflicts remain visible and retain local drafts. No blind conflict retry.
4. UI edits automatically persist after a short debounce. Only changed fields are sent. Save requests are serialized; typing while a request is pending is retained and saved afterward.
5. Project/route changes and refresh flush pending work before replacing the form. Drafts are retained locally across reload/network errors until server acknowledgement. A failed browser-storage write is reported honestly. No unconditional successful-save message.
6. New draft creation uses a durable client request ID so a retried request cannot create a second project. Acknowledgement loss followed by further edits still preserves those edits.
7. UI shows Pending/Saving/Saved/Not saved status. Same-field conflicts offer explicit keep-local or use-saved resolution; neither silently discards content.
8. An on-disk database and a real HTTP server prove partial edits survive close/reopen. Test actual browser input, reload and project switch when Chromium is available in CI; declare local skips.

## Failure model and validation

Stale full-form overwrite, null/omitted confusion, nested JSON replacement, lost acknowledgement, overlapping requests, browser refresh wiping drafts, duplicate creation, partial commit/audit failure and PATCH CSRF bypass must each have a behavioral regression. Use the existing full suite, syntax gate, focused coverage/mutation checks and Node 22/24 CI. Preserve API compatibility, artist/track/media relationships, existing secrets and all historical records. Publish a reviewed commit/PR after checks; distinguish repository changes from Mac runtime verification.
