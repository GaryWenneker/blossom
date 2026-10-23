# Reproducible Music DNA: reference-first, evidence-aware analysis

## Rule

All Blossom Music DNA analyses follow the AX convention titled
**Default Music DNA method for every track: evidence-first arrangement analysis**
(AX memory `876cd3c4-4f50-476c-b9bc-64e679ce03a4`).

An identical analysis request for the **same recording** must first retrieve the
previously validated reference snapshot, not ask a generative model to rewrite it.
The previously approved output is the source of truth for identical inputs.

For The Fixx, *The Sign of Fire*, YouTube video `vHJatlXEUG4`, the user-approved
golden output is the complete original v4 source audit:

`test/fixtures/music-dna/the-fixx-sign-of-fire.v4.json`

The SHA-256 of its original UTF-8 JSON bytes is:

`3e4d389249e841faf5a331fb25746529403fcaed5db51aa87b1186b0cfab74ef`

**This snapshot is intentionally a source audit, not a measured audio transcription.**

## Reverse-test procedure

1. Identify the actual recording/version, not just artist and title. Match the
   source's canonical ID, especially YouTube `vHJatlXEUG4`.
2. Query AX for the Music DNA method and, for an already-analyzed reference,
   the saved golden snapshot. For this recording, load the JSON fixture verbatim.
3. If the task is an **exact repeat without new evidence**, return the frozen
   profile, without changing wording, source order, nulls, confidence or metadata.
   The golden data has 11 root fields, 7 arrangement sections, 5 track roles,
   0 fake bar blocks, `schemaVersion: 1`, outer audit `version: "4.0"`.
4. To verify a candidate output's **exact field names and values**, run:

   ```sh
   node scripts/music-dna-regression.mjs path/to/candidate.json
   ```

   `PASS` requires structural identity, including array order and all values.
   Whitespace, JSON indentation and irrelevant key serialization order do not
   affect this semantic comparison; the golden fixture's SHA protects the
   immutable source bytes. A failed comparison reports the JSON property paths.
5. For actual newly decoded audio, different mastering/recording, corrected
   source evidence, or requested reanalysis, create a **new version** and keep
   the golden output unchanged. Do not overwrite a previously approved snapshot.

## Rules for other songs

Every new reference should have its own stable identifier, evidence/source
snapshot, validated structured profile, and golden fixture once accepted.
A **rule alone does not make generative output byte-identical**. Consistent
repeat output is achieved through a saved reference, canonical identity,
schema validation, version control and regression comparison.

When audio is unavailable, create rich documented structure phases, known
instrument roles, vocal observations supported by sources, harmonic candidates
and explicit uncertainty. Never pad with `not_analyzed` four-bar structures to
simulate a transcription. Bar-level techniques, transitions, instruments and
vocal events can only be reported as observed when source audio was actually
decoded and aligned or a reliable aligned score is present.

## Important limits

The published v4 source analysis has no decoded audio and its harmonic
candidates reflect conflicting third-party sources. Exact per-bar execution
is not verified. This test measures **reproducibility of an existing output**,
not independently whether the underlying musical assertions are true.
