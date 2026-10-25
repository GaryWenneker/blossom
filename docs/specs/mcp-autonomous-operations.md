# SPEC — ChatGPT can adjust Blossom through MCP

Tier 2. Isolation: this working tree, because the change is the Blossom MCP contract the running app loads. No new dependencies.

Spec approval: not obtained (autonomous run). The request was to investigate adjustable Blossom behavior and add the MCP extension.

## What ChatGPT can already do

Existing tools stay: Studio project list/get, save a structured song brief, Spotify Liked Songs read/import, and Music DNA search, get, versions, jobs, add, save analysis, import batch, claim, and complete.

## What this adds

Two tools:

- `blossom_operations` (read): the catalog of adjustable actions, each with a description and input schema, plus a withheld list.
- `blossom_invoke` (available to read and write tokens): runs one catalog action. Write actions require `blossom:write` or the MCP write token.

## Scenarios

1. A read token calling `tools/list` sees `blossom_operations` and `blossom_invoke`, and every previous tool name is still present.
2. `blossom_operations` returns `artist_create` with `write: true` and `label_summary` with `write: false`.
3. The withheld list names credentials, browser automation, binary media, website lyrics, and gateway admin. No catalog name contains `password`, `apiKey`, `token`, or `cookie`.
4. A read token invoking `artist_create` is rejected and creates no artist.
5. A write token invoking `artist_create` with name `Nocturne Vale`, genre `ambient`, language `instrumental`, countries `["CH"]`, voice `instrumental`, and DNA `Soft drones` returns that artist, and `artists_list` includes the same id.
6. Invoking an unknown operation, including `connections_save`, is rejected.
7. `release_distribute` without `confirmation: "PUBLISH"` is rejected with a message that includes `PUBLISH`.
8. Invoke input that contains `apiKey` or `password` is rejected and is not stored.

## Must not change

- OAuth scopes: `blossom:read` still cannot write. A scope hint does not grant write.
- Credential routes, Safari/Playwright handoff, and binary upload routes stay off MCP.
- Existing MCP tool names and their input schemas stay.
- Live distribution still requires server `allowLive` and the confirmation string `PUBLISH`.

## Setup

No new packages. Tests: `node --test test/mcp-operations.test.mjs`. Syntax check gains `src/mcp-operations.mjs` and `test/mcp-operations.test.mjs`.
