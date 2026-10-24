# Why ChatGPT can still see 12 old Blossom MCP tools after a git update

## Verified problem in the previous setup

Before this fix, `scripts/setup-blossom.mjs` accepted any `/healthz`
response with `status: "ok"` as proof that the **current** version was
running. It also **silently skipped replacing an existing unmanaged server**
on port 8787. A successful checkout, `bash setup.sh`, and reconnect in
ChatGPT could therefore leave the old running process serving its original
**12 tools**.

The correct `main` branch includes **14 tools**, including
`spotify_liked_tracks` and `spotify_liked_import_page`.

The previous MCP `initialize` response also hardcoded `version: "0.1.0"`.
That made new/old server instances look identical to a client.

## Fix

- The server publishes a nonsecret MCP tool count and a SHA-256-derived
  **tool-contract fingerprint** in both local and public `GET /healthz`.
  This identifies the actual process, not the git checkout on disk.
- MCP `initialize` now publishes a dynamic version tied to that fingerprint.
- Setup now checks the *authenticated*, live `POST /mcp` `tools/list` response,
  including every expected tool name, in order, with the existing write token.
  A stale or differently configured process can no longer pass installation.
- If an unmanaged process already occupies port 8787 and no Blossom LaunchAgent
  is present, setup fails with a diagnostic instead of silently leaving it
  running. We do **not** forcibly kill a process just because it owns a port.
- GitHub's public OAuth smoke test logs actual Cloudflare fingerprint and
  expected fingerprint. Public deployment may legitimately lag `main` until
  the owner updates their Mac; such lag is a warning, not evidence of a
  broken build.
- Diagnostic commands do not print, log, forward to Cloudflare, or store
  private bearer tokens.

## On your Mac

After merging this fix and pulling the new `main`:

```bash
cd ~/io/blossom
git pull --ff-only origin main
bash setup.sh --headless
npm run mcp:diagnose
```

The final command checks:
1. Your **local** server's fingerprint and authenticated 14-tool `tools/list`.
2. Your **public** `https://blossom.wenneker.dev/healthz` response to confirm
   Cloudflare actually reaches a server with the same tool contract.

The expected output shape is:

```text
LOCAL: OK | 14 MCP tools | Spotify Liked Songs available | fingerprint <20 hex chars>
PUBLIC: OK | fingerprint <same fingerprint> | count 14 | reachable true
```

If local fails, identify **who is listening** on port 8787:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
launchctl print gui/$(id -u)/io.wenneker.blossom.server
```

A local process launched in another terminal or from another checkout can
capture that port. Stop that instance through the service/terminal that owns
it, then rerun setup. Do not blindly run `kill -9` against arbitrary PIDs.

If **local passes but public fails**, inspect the existing Cloudflare tunnel
route for `blossom.wenneker.dev`: it may point to another Mac, an old
container/service, or a different origin port, or a cached edge route.
The expected destination is your Mac's `http://127.0.0.1:8787`.
Also run `npm run tunnel:check` for public routing diagnostics.

If **both pass but the current ChatGPT conversation still shows 12 tools**,
the server is ruled out at the contract level. Check a **new ChatGPT
conversation** to distinguish a conversation-bound tool snapshot from a
stale installed plugin definition. If even a new conversation is stale,
investigate the plugin's registered MCP URL and OpenAI-side tool discovery.
Do not repeatedly rotate credentials or delete the plugin until the
local/public version mismatch is ruled out.

The new MCP tool list being visible is independent of whether Spotify has
granted the additional `user-library-read` OAuth scope. After tool
discovery works, Spotify still requires separate account authorization.
Metadata import does not mean a real audio DNA analysis occurred.

## Privacy

The public fingerprint and tool count are an aggregate, source-derived
capability identifier with no credentials, song contents, account identity,
authorization data, recordings, or user-specific values. Admin interfaces
remain loopback-only. The local `tools/list` request sends the already
configured MCP write token **only** to `127.0.0.1:8787`; never to the
public Cloudflare host or ChatGPT.
