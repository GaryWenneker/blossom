# Evidence — ChatGPT MCP adjustments

Spec: `/Users/gary/io/blossom/docs/specs/mcp-autonomous-operations.md`

Spec approval: not obtained (autonomous run). Tier 2.

## Mapping

| Scenario | Check |
|---|---|
| Catalog lists write and read actions and the five withheld groups | `operation catalog exposes label adjustments and withholds secrets` |
| Read token sees `blossom_operations` and `blossom_invoke` and cannot create an artist | `read token can see the catalog tools and cannot create an artist` |
| Write token creates an artist and lists it | `write token creates an artist and lists it` |
| Unknown operations, credential fields, and distribute without PUBLISH are rejected | `unknown operations and credential fields are rejected` |
| Previous MCP tool names remain, and the live manifest count matches source | `test/mcp-deploy-consistency.test.mjs` |
| Official Suno HTTP behavior stays intact after the shared methods | `test/studio-suno-platform.test.mjs` |

## Final run

After the last source edit:

- `node --test` — 362 pass, 0 fail, duration_ms 7417.975042
- `npm run check` — exit 0
- `node --input-type=module` catalog count — 54 operations (29 write, 25 read), 16 MCP tools, withheld: credentials, browser_automation, binary_media, website_lyrics, gateway_admin

## Manual mutants

Each mutant was restored before the final suite. The suite killed all three:

1. Write gate forced off — read-token test failed.
2. Credential key check forced off — credential rejection was missing.
3. PUBLISH comparison inverted — distribute without PUBLISH no longer mentioned PUBLISH.

## Skipped

- Changed-line coverage tool: this repo has no coverage gate.
- Mutation tool: none configured; three hand mutants above.
- Live ChatGPT and the public tunnel: not restarted or rescanned. A running Blossom process keeps the previous tool list until it is restarted.

## Limits

ChatGPT still cannot upload audio or images, open Safari, read or save API keys, or drive the ChatGPT, Suno, or Spotify websites. Spotify playback controls are not in the catalog. Distributor submission still needs live distribution enabled and confirmation `PUBLISH`.
