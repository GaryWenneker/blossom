# SPEC: every musical analysis includes a BPM

Tier: 2. Spec approval: not obtained (autonomous run).

Isolation: the current checkout, no worktree. The Music DNA library the user is looking at is served from this tree. A separate worktree would not change that server.

No new dependencies. No git commits unless asked.

## API scope

Internal local REST and MCP (`music_dna_save_analysis` and `POST` analysis save). Existing surface. Callers are this repository. Tightening `bpm` from optional to required is a breaking validation change requested for this product. First-party callers are updated in the same change. Signal-only PCM measurements stay optional.

Gates: Boring — same field name `bpm`. Compatibility — intentional tighten, internal callers updated, signal-only unchanged. Authentication / authorization / idempotency / pagination / expensive fields / leakage — unchanged, not part of this change.

## Behaviors

1. `dnaPrompt` for a recording asks for `bpm (required number from 20 to 350, never null)` and does not say `or null`.
2. `analysisFromReply` keeps a finite BPM inside 20–350, including `98.6` and the numeric string `"120"`.
3. `analysisFromReply` throws `DomainError` matching `/omitted a BPM/` when BPM is missing, `null`, non-numeric, below 20, or above 350. It does not return an analysis object.
4. `MusicDNA.saveAnalysis` throws `DomainError` matching `/BPM is required/` when a musical analysis omits `bpm`, and it does not store a version.
5. `MusicDNA.saveAnalysis` still accepts `bpm: null` when `analysisMethod` is exactly `decoded PCM signal measurements (no instrument or vocal classification)`.
6. A saved ChatGPT catalog analysis still has `analysisMethod` `chatgpt-catalog`, `measurements: null`, and the supplied BPM. This change does not invent a BPM and does not label catalog tempo as audio-observed.
7. Already stored analysis versions are left unchanged. This change does not rewrite history and does not queue new ChatGPT jobs.

## Must not

- Do not fill a missing BPM with a guessed number.
- Do not require BPM on the signal-only PCM analyzer. That path does not measure tempo (`test/music-audio.test.mjs` keeps `analysis.bpm === null`).
- Do not change job-queue counts, ChatGPT conversation URL rules, or section/bar validation.
