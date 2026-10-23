# Operations and release safety

1. Set a unique admin password in your secret manager or shell environment. Do not commit credentials.
2. Run `npm run check && npm test`.
3. Start Blossom bound to `127.0.0.1`; use a secure VPN or HTTPS proxy for remote access.
4. Run `npm run seed` only if you want the eight illustrative, **unverified** artist proposals.
5. Create an artist with a distinctive, reviewed identity and original music brief.
6. Produce the audio using an authorized Suno account. Record human contributions and check the applicable license.
7. Progress through the track state machine; only mark approved with a real HTTPS asset reference and all documented reviews completed.
8. In LabelGrid, prepare a real release and upload the required audio, artwork, metadata and credits.
9. Attach its actual ID in Blossom; explicitly check DSP readiness items.
10. Configure the LabelGrid API token and **sandbox** first. Use Validate and check results.
11. Approve delivery separately. For live publishing, enable `BLOSSOM_ALLOW_LIVE_DISTRIBUTION=true` on a deliberate production deployment.
12. Confirm the publication. If status becomes `needs_reconciliation`, manually check the provider. Never auto-resubmit an ambiguous request.

## Safety tests

- Invalid state transition and missing rights block advancement.
- Missing asset or release checklist prevents delivery.
- No LabelGrid token prevents provider calls.
- Live publishing disabled by default.
- Dual/failed submissions trigger a reconciliation hold.
- Terms-change holds block publication.

## Limitations and go-live checklist

Do not expose the MVP directly on the internet. For real distribution, verify contracts, legal rights, source authenticity, account permissions, DSP acceptance of AI music, user authentication, error alerts and recovery. The first pilot deliberately has no claim of 24/7 operation or automatic Suno access.

For monitoring, set `BLOSSOM_MONITOR_ENABLED=true`; confirm changes by reviewing original documents. Snapshot changes are not legal advice. Use an external scheduler and delivery channel for actual always-on notifications.

## Web login / provider connection operations

1. Set `BLOSSOM_ADMIN_PASSWORD` to a unique strong value (12+ chars) and optionally `BLOSSOM_ADMIN_USERNAME` (defaults to admin). Open `/login` and save a matching 1Password login entry.
2. Generate a vault key using `npm run vault:key`, save it independently in 1Password or a deployment secret manager, and set `BLOSSOM_VAULT_KEY` in the server environment. Losing the key makes existing encrypted credentials unrecoverable.
3. Configure `BLOSSOM_PUBLIC_URL` as `http://127.0.0.1:8787` locally, or a HTTPS origin externally. Spotify OAuth requires an exact redirect allowlist entry ending in `/auth/spotify/callback`.
4. In Connections enter your Suno email and only an official authorized Suno Platform API key (if provided). Do not paste your Suno website password.
5. Enter a Spotify developer Client ID and click Connect with Spotify. Authorize on Spotify's actual site. Blossom stores the refresh token encrypted and can disconnect the connection; it never receives a Spotify website password.
6. Sign out to invalidate the session. Never share your database and encryption key together, or put either in Git. Validate a restore from backups before relying on saved account connections.

`BLOSSOM_VAULT_KEY` must not be logged or committed. The initial account integration does not perform Suno generation and Spotify OAuth cannot distribute music; LabelGrid remains the publishing integration.

## Creative Studio operator guide

1. Update `main`, run `npm run check && npm test`.
2. Save an OpenAI API key in the encrypted Connections page, or set `OPENAI_API_KEY` in the server environment. Configure `BLOSSOM_OPENAI_MODEL` if needed. API billing is independent of your ChatGPT plan.
3. Install the official `draw-things-cli`, inspect `generate --help`, set `BLOSSOM_DRAW_MODEL` to an available model, and restart the Mac-hosted Blossom server.
4. Open News to Song; choose artist, paste source article, select duration preset and configure the sound. Save project.
5. Use Extract with AI to create lyrics/styles/prompts. Review, correct and save lyrics before using them commercially.
6. Create linked track; copy Suno blueprint into the authorized Suno session (no unsupported automated Suno login).
7. Generate cover/portrait locally or upload your obtained Suno audio as MP3/WAV. Confirm output belongs to the right project.
8. Before distributing, do originality, licensing, name/likeness and metadata reviews. Spotify playlist pitching is manual and not guaranteed.

**Host caveat:** Draw Things executes on the server host, not the browser user's machine. For the Mac GPU to be used, run this Node app locally on that Mac. Limit file uploads to 40 MB; keep the local .data directory private and back it up.
