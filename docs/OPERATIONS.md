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
