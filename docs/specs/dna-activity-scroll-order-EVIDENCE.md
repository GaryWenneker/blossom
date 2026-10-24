# Evidence — Music DNA in-progress list scroll and order

Tier 2. Spec approval: not obtained (autonomous run). Confidence is lower because the spec was not approved before the code.

Spec: `docs/specs/dna-activity-scroll-order.md`

Source: HEAD `7967d76` plus uncommitted files. Blob hashes:

- `public/music-dna.js` `aac1bc08800398ef4fbc1bc7da70f3424f92a09d`
- `public/app.js` `77b024c1551881948df6d4aef118a859023cb620`
- `test/music-dna-activity-scroll.test.mjs` `6cffc56c55e700c5c910c2f39c8e51fda79aee29`
- `scripts/dna-activity-scroll-mutants.mjs` `225caebc54d2adc1f0e156782e58888165e9c07f`
- `docs/specs/dna-activity-scroll-order.md` `c01f475f491dbc8408f3e5f7d76b7f85da1fa63d`

Node `v26.8.2`. No new dependencies. Isolation: this working tree.

## Behaviors

| Behavior | Test |
|---|---|
| Newest `createdAt` is above older recordings. An active Spotify import stays first. Undated jobs keep incoming order. | `newest open recordings are listed above older ones, under an active Spotify import` |
| A scrolled row stays in view when a newer row is inserted above it. | `refreshing in-progress keeps the scrolled recording in view` |
| A list already at the top stays at the top when a newer row arrives. | `refreshing in-progress stays at the top when the reader is already there` |
| A row that leaves the list does not reset the offset to zero. | `refreshing in-progress keeps the old offset when the visible row is gone` |
| A full Music DNA redraw captures scroll before `view.innerHTML` and restores after. | `a full Music DNA redraw restores activity scroll around the view replace` |

The last check reads `public/app.js` and checks call order. It does not execute `render()`. The one-second refresh is `paintDnaActivity`, which the other tests and the browser check execute.

Unchanged: `jobs()` still returns a status filter oldest-first. The worker still claims the oldest queued job. Existing catalog assertions in `test/music-dna-catalog.test.mjs` still pass, including three unfinished rows and escaped names.

## Gauntlet

Fresh run after the last code edit (`node --test`, Node v26.8.2): **376 pass, 0 fail**, `duration_ms 7392.469625`.

`node --check` on `public/music-dna.js`, `public/app.js`, `test/music-dna-activity-scroll.test.mjs`, and `scripts/dna-activity-scroll-mutants.mjs`: exit 0.

`node scripts/dna-activity-scroll-mutants.mjs`: **killed 5/5** (each exit 1).

`node scripts/dna-activity-scroll-mutants.mjs --control` on the restored source: **control green: 5**.

Negative control: with `data-key` renamed to `data-row` in the activity markup, `--control` exited 1 (`CONTROL FAIL` on all 5). The markup was restored afterward; the suite above is from that restored tree.

## Review rounds

| Round | Skills (status) | Findings | Fixed |
|---|---|---|---|
| 1 | `old-coder` usable. `old-coder-api` not applicable (no HTTP change). `typescript-review` and `react-review` missing for this plain browser script; generic checklist used. | 0 | — |

## Skipped

- Coverage: no coverage tool in this repo.
- ESLint: no project lint script. `node --check` is the static check that exists.
- Property tests: the order is one timestamp comparison, covered by the examples above.
- Randomized suite order: `node --test` has no random-order runner here.
- Production bundle: these scripts are served as files. No frontend build.

## Live page

On `http://127.0.0.1:8787/#music-dna`, after a reload, the open list was newest-first: 67 rows, first `createdAt` `2026-10-24T15:33:17.923Z`, last `2026-10-24T06:30:36.489Z`, monotonic. Scrolled to 240px on Alice In Chains — Would? (2022 Remaster), key `511c51c2-b311-4e53-a506-17e037c0dba7`. After 1.5 seconds the same key was still at scroll 240. The first row stayed Skunk Anansie — Hedonism, not the running job.

## Limits

The activity poll still asks for 200 queued and 200 running jobs. `jobs()` returns the oldest 200 of a status. A queue larger than 200 would not include the newest rows in that response. The live queue was under 200.

A full catalog redraw while scrolled was not clicked in the browser. The poll path, which was the jump, was.
