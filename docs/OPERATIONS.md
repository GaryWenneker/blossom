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

## Existing Suno Google and Spotify Facebook account sign-ins

In **Connections → Suno · Google**, open the official Suno site, and choose the same Google account used for the existing Suno music library. Suno controls that single-sign-on flow. Browser sign-in is **not** an OAuth or API grant to Blossom; an official, separately authorized Suno API key is still required for future automatic song generation. Do not copy Google/Suno passwords, browser session cookies, Google access tokens or browser credentials into Blossom. Existing user-owned Suno exports can be imported manually through the existing Studio audio upload.

In **Connections → Spotify · Facebook**, create/configure a Spotify developer application (this needs an eligible Spotify developer account), save its Client ID and configure its redirect URI to exactly \`http://127.0.0.1:8787/auth/spotify/callback\` (or the configured HTTPS public origin). Choose **Connect Spotify · Choose Facebook**, which invokes Spotify's OAuth Authorization Code PKCE with \`show_dialog=true\`. On Spotify's own sign-in page, choose **Continue with Facebook** if it remains an enabled sign-in method for your original Spotify account. No Facebook credential or Facebook API token passes through Blossom. Once approved, Blossom verifies the Spotify user profile and saves the Spotify refresh token in its AES-encrypted local vault. Run **Verify connected Spotify account** to check the account identity.

Spotify states that existing Facebook login may be used but Facebook cannot currently be added as a new Spotify sign-in method when not already active. A social sign-in method cannot be forced with a Facebook-specific OAuth query parameter: the official Spotify screen makes that choice. The original account is preserved when the correct login is used. Google and Facebook sign-in alone cannot grant Blossom access to songs or recordings from Suno/Spotify.

References:
- Suno SSO: https://help.suno.com/en/articles/2553409
- Spotify Facebook login: https://support.spotify.com/nl/article/facebook-login-help/
- Spotify PKCE: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

## Supervised consumer Suno browser (Playwright Core)

Blossom's separate Suno Platform API is **not** available just because a user is signed into \`suno.com\` via Google. Use **News to Song → Open Suno (Playwright)** to start a visible Chrome browser controlled by local Playwright Core; complete your own Google SSO. Use **Fill Suno draft** only after logging in and navigating to \`https://suno.com/create\`. Blossom fills unique visible fields it recognizes (lyrics, styles, exclusions, title) and **never clicks Generate**. Review the entire blueprint in Blossom, set any model/sliders/mode fields manually, then submit the generation manually. The ordinary browser is still the authority for credit use, rules and results.

To prepare: run \`bash setup.sh\` to install \`playwright-core\` and Google Chrome on your Mac; the setup does not automatically sign in. The browser session is stored under the ignored local directory \`.data/suno-playwright-profile\`, which can contain personal browser session data; do not copy this directory into source control or share it. Only authenticated Studio UI actions can control the browser. This is an **assisted local browser workflow**, not a Suno API connection, continuous listener, music downloader or bulk-automation bridge.

Suno explicitly restricts robots and scraping in its current terms, effective September 2026. Use the assistant only when authorized by the service, and do not automate blocked operations. If Google refuses login from Playwright Chrome or Suno's UI changes, open \`suno.com\` normally and copy the fields from Blossom's blueprint; do not add stealth plugins or circumvent controls.

Reference: https://suno.com/terms-of-service

## Browser sign-in using Google-supported browsers

Blossom Connections opens Suno, Spotify and ChatGPT using an ordinary tab in the user's own default web browser, not a Playwright/WebDriver-controlled Chrome context. This fixes Google's "This browser or app may not be secure" sign-in failure. Use Google or Facebook on the service's official website as usual. Existing cookies are managed by the *same browser and browser profile*, so a valid login can be reused. Blossom never accesses, copies, imports or exports those cookies. The browser does not share any session with Blossom's backend. A separate developer API integration is still required for automated features.

**Suno Studio:** Open Suno in browser opens https://suno.com/create. View / copy Suno blueprint shows the saved parameters and lyrics; copy/paste them into Suno, review, and click Generate manually. The older WebDriver prefill route is not used by the normal application because Google blocks automation-controlled authentication. Avoid stealth flags or account bypasses.

**Connections:** The modal only explains how to sign in; it does not embed or validate Google's login. The local server's /api/browser-accounts/open endpoint returns only an allowlisted URL and does not launch Chrome or imply login. The login link opens from a real click in the web UI, including when accessing Blossom remotely through an approved gateway. The Close action does not close or clear the user's personal browser, and Blossom does not claim to know when browser sessions expire.

Spotify Web API requires a developer app and official OAuth PKCE even if Facebook browser login works. ChatGPT website login does not grant an OpenAI API key. Consumer Suno Google login does not grant access to platform.suno.com. Google documents supported browser login requirements at https://support.google.com/accounts/answer/7675428

## Google reports "This browser or app may not be secure" after logging in

Google can refuse sign-in from Chromium launched by Playwright/WebDriver. **Opening a new tab from an automated Chrome window is not an escape from the automation environment**, even if the link points to the genuine Suno website. This is why the previous window.open workaround did not always work.

On a Mac, Blossom Connections now provides **Open in Safari (Mac)** for Suno, Spotify and ChatGPT. This is a genuine macOS LaunchServices call (`/usr/bin/open -a Safari <allowlisted official URL>`) instead of Playwright. It runs only after an authenticated, request-protected, loopback-host local request. Remote/tunneled connections cannot trigger apps on the Mac. Safari uses its *own* normal browser profile, existing cookies and normal provider authentication. No cookies, passwords or session tokens leave Safari or become API credentials. If Safari does not have an existing session, sign in manually there. A Google error even when visiting Suno directly in Safari should be diagnosed as a separate Google/browser/network account issue, not solved by browser flag spoofing.

Blossom checks `navigator.webdriver` solely to **warn** that its own tab is in an automated browser, not to hide or modify that flag. While in an automated browser, standard in-browser sign-in is blocked in the Blossom UI and the Safari launcher is recommended. Studio's Suno button opens native Safari on localhost macOS; other environments show the copyable Suno blueprint and URL rather than a delayed popup blocked by the browser.

To verify which Blossom UI version is loaded, reload the web app and ensure the Connections panel shows the new **Open in Safari (Mac)** button. If it still shows the older Playwright or Chrome sign-in buttons, restart the launchd Blossom server after `git pull` and refresh the page. The browser that Playwright previously created can simply be closed. Do not modify Google anti-bot settings or copy Chrome profile data.

## Browser sign-in status after returning from Safari

Suno, Spotify and ChatGPT are logged into their own normal Safari/browser profiles; the external websites do not send Blossom a login or browser-window-closed callback. Blossom therefore **cannot safely or accurately detect actual login state or window closure** without an official OAuth integration or access to Safari's private session data.

The Connections screen now records a non-sensitive, local handoff state for each provider in the SQLite table `browser_account_handoffs`:
- **Not connected**: no handoff recorded
- **Waiting for confirmation**: browser launched; when returning to Blossom, choose **Ik ben ingelogd** or **Nog niet gelukt**
- **Confirmed by you**: explicit operator confirmation; this is not an automatically verified provider session or API authorization
- **Not confirmed**: operator did not complete login, or revoked prior confirmation

These statuses survive Blossom restarts. A new browser launch preserves an earlier manual confirmation until it is explicitly withdrawn. No cookies, passwords, profiles, tabs, tokens or private browser data are read or stored in the new status table.

On focus/visibility return, Blossom requests only its own saved handoff status and updates the cards. The modal remains open with guidance for confirmation. Closing Safari alone **does not and must not** mark the account connected. For Spotify API features, use the separately supported OAuth flow, whose token status can be verified; this manual browser status is only a convenience label. Other provider API features still require supported API access.

## Spotify Facebook account sign-in, like Suno

Blossom → Connections → Spotify uses the **same native Safari browser handoff and explicit return confirmation as Suno**. A user who has never confirmed Spotify login opens the official Dutch login page `https://accounts.spotify.com/nl/login`, where `Verdergaan met Facebook` can be chosen if that method remains active for the account. The user completes any login challenge in the ordinary Safari app and returns to Blossom to click `Ik ben ingelogd`. Blossom saves only that *user-reported* state.

Once user-confirmed, `Open Spotify in Safari` opens `https://open.spotify.com/` in the **same** Safari profile. The user may choose `Opnieuw aanmelden via Facebook` to go back to the official login page and reset the local handoff to awaiting confirmation. Other providers' handoff records are left alone.

Without a local Safari launcher, Blossom opens these same allowlisted URLs in a normal browser tab (not Playwright). It chooses the sign-in page for an unconfirmed account and Web Player after user confirmation. Saved Safari cookies are handled by Safari and cannot be read or validated by Blossom. There is no automatic window-close or SSO callback, and no Spotify developer Client ID is needed for browser-only access. Official Spotify Web API operations still require a Spotify developer application and OAuth.

Spotify's official support page says Facebook cannot be newly added as a login method; `Verdergaan met Facebook` applies only where a previously established Facebook login is still available: https://support.spotify.com/nl/article/facebook-login-help/

## Local background AI instead of ChatGPT Safari automation

Blossom no longer opens/controls a ChatGPT web browser for the News to Song Extract action. It uses the official local Ollama HTTP API bound to loopback when no OpenAI API key is configured. The local generation engine is not branded ChatGPT and cannot access any ChatGPT conversation or session. The old browser handoff code may remain for independent compatibility tests, but the default Studio action and its legacy endpoint do **not** invoke it.

Provision once with `bash scripts/setup-local-ai.sh` (installs Ollama, starts its background service, pulls the default `qwen3:8b` model, multiple GB). Access to localhost:11434 is limited to loopback in Blossom's provider configuration. Override model via `BLOSSOM_LOCAL_AI_MODEL`; if the model is missing, `GET /api/studio/status` returns `localAI.available=false` and diagnostic instructions. No browser or API key is a dependency for this local path. `POST /api/studio/projects/{id}/chatgpt-extract` is a legacy compatibility alias for the local inference route; it no longer launches a Safari tab.

Article URLs are fetched only from public HTTP(S) pages, with limited response body, DNS allowlist, no local/private hosts or unsafe redirects. The source text is untrusted input. If content is behind a paywall or JavaScript login the user must paste authorized text manually. On generation, Blossom stores the article and locally generated brief using existing Studio persistence. OpenAI API credentials remain an optional alternative and are never implicitly derived from cookies.

Local generation can take several minutes depending on machine, model size and source text. Once on a Mac with a compatible local model installed, no browser windows should appear during the Extract action. Inspect `.data/logs/server.log` for failed local model requests; retries do not silently fabricate lyrics.


## Diagnosing the public ChatGPT MCP OAuth connection

The Studio web UI stays on `http://127.0.0.1:8787`; the separate MCP
resource and OAuth provider use `BLOSSOM_MCP_PUBLIC_URL=https://blossom.wenneker.dev`.
Do not change `BLOSSOM_PUBLIC_URL` to the Cloudflare hostname. Cloudflare must
forward `/mcp`, `/oauth/*` and `/.well-known/oauth-*` to the same running
Blossom process and persisted SQLite database. Cloudflare Access authentication
or an HTML challenge must not intercept machine-to-machine OAuth discovery or
registration. Keep authentication through Blossom's OAuth grant and access
control. Do not broadly expose the administrator UI or add a public bypass for it.

Run the real HTTPS path test, which needs no administrator password:

```bash
node scripts/test-mcp-remote.mjs https://blossom.wenneker.dev
```

It validates OAuth discovery, MCP authentication challenge, ChatGPT client
registration, creation of an authorization page, the matching POST to decline
that exact consent (safe; issues no token), the redirect to ChatGPT, and safe
handling of a repeated submission. A failure in the public GET -> POST step is
evidence of inconsistent routing, instance/database changes, or a proxy
intercept. The test does not prove approval with an actual password or that
ChatGPT installed the app; those require an end-user authorization.

The approval form is valid for twenty minutes. Repeating a completed approval
does not issue another grant, and an expired form requires starting a fresh
connection from ChatGPT. Check the Blossom process is running with the intended
database and avoid routing different OAuth requests to different instances.
