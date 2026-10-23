# Blossom ↔ ChatGPT MCP via OAuth

The **News to Song** workflow can submit from the user's authenticated Chrome or Safari session, while ChatGPT writes finished song briefs and Music DNA into Blossom using MCP tools. No OpenAI API key or copy/paste is needed for this route. ChatGPT must be linked to Blossom as an MCP app with write permission.

## Architecture

- Blossom admin/UI stays on `http://127.0.0.1:8787`.
- ChatGPT uses `https://blossom.wenneker.dev/mcp`.
- OAuth issuer: `https://blossom.wenneker.dev`.
- The local database persists OAuth client registrations and hashed, expiring access and rotating refresh tokens.
- OAuth 2.1 authorization-code/PKCE S256 + Dynamic Client Registration (DCR) are implemented.
- The user's Blossom admin username/password authorize the connection **once** on the trusted Blossom OAuth page; ChatGPT credentials are never accessed by Blossom.
- Existing local read/write MCP bearer tokens remain compatible. Do not share them.

## 1. Install locally

Run:

```bash
git pull origin main
bash setup.sh --headless
```

The installer will add `BLOSSOM_MCP_PUBLIC_URL=https://blossom.wenneker.dev` to `.env` if it is missing. This is **not** the general `BLOSSOM_PUBLIC_URL`, which remains loopback. Don't put tokens or passwords in Git.

## 2. Cloudflare Tunnel route

In Cloudflare Zero Trust → Networks → Tunnels → the existing tunnel → **Public hostnames**, configure:

- Hostname: `blossom.wenneker.dev`
- Service type: HTTP
- Service URL: `http://127.0.0.1:8787` (only if `cloudflared` runs on this same Mac)
- Additional application/origin setting, **HTTP Host Header**: `blossom.wenneker.dev`

If the tunnel is locally managed, its ingress configuration can contain:

```yaml
ingress:
  - hostname: blossom.wenneker.dev
    service: http://127.0.0.1:8787
    originRequest:
      httpHostHeader: blossom.wenneker.dev
  - service: http_status:404
```

Use this only within an already configured tunnel; preserve its existing tunnel ID and credentials. The public hostname MUST preserve the Host header: Blossom rejects ordinary admin/API routes when the public hostname is used. Do not configure Cloudflare Access to intercept the OAuth well-known endpoints or the OAuth token endpoint, or ChatGPT discovery will fail; authorization and tokens are managed by Blossom.

Cloudflare must forward the following paths without rewriting URLs:
`/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`,
`/.well-known/oauth-authorization-server`, `/oauth/register`,
`/oauth/authorize`, `/oauth/token`, and `/mcp`.

## 3. Verify before creating the plugin

Run from the Mac:

```bash
curl -i https://blossom.wenneker.dev/.well-known/oauth-authorization-server
curl -i https://blossom.wenneker.dev/.well-known/oauth-protected-resource
curl -i https://blossom.wenneker.dev/mcp
curl -i https://blossom.wenneker.dev/\ncurl -i https://blossom.wenneker.dev/healthz\ncurl -i https://blossom.wenneker.dev/login
```

Expected responses: 200 JSON for both well-known endpoints, 200 HTML for `/`, 200 JSON for `/healthz`, 405 for GET `/mcp`, and 404 for public `/login`. If you get a Cloudflare HTML challenge, 502, 1033, or a network error, fix the tunnel before creating the ChatGPT plugin.

## 4. Add the ChatGPT plugin

From ChatGPT → Plugins → **Add custom MCP server**:

- Name: `Blossom`.
- Optional description: `Music DNA analysis, cataloguing Spotify references, and generating original News-to-Song briefs in my Blossom Studio.`
- Connection: **Server URL** `https://blossom.wenneker.dev/mcp`.
- Authentication: **OAuth**, with automatic discovery. Do **not** manually enter an API token.
- Review the server permissions and create the plugin.

ChatGPT registers as a public OAuth client using DCR, requests PKCE S256, and opens a page at `blossom.wenneker.dev/oauth/authorize`. Sign in once with your **Blossom** admin credentials and approve access. OAuth access tokens and rotating refresh tokens allow continued use without repeated input.

If tools do not appear, inspect whether your ChatGPT plan/workspace supports custom MCP tools and write access. A ChatGPT website login by itself is NOT OAuth authorization for Blossom.

## 5. News to Song

The existing **Extract with ChatGPT** button submits a Studio project to the signed-in ordinary browser. ChatGPT needs the connected Blossom app in that conversation to call `studio_project_get` and `studio_project_save_result`. Blossom polls for the saved project result.

Browser Apple Events and browser prompt autofill are best-effort and sensitive to ChatGPT UI changes. OAuth linking alone does not guarantee unattended browser automation. Verify an end-to-end project save before relying on this unattended.

## Security

Never disable MCP authorization or make public write tools anonymous. The public hostname should expose only MCP/OAuth routes, not the rest of Blossom. OAuth authorization codes are single-use and short-lived; access tokens expire after one hour and refresh tokens rotate. Review Cloudflare Tunnel origin routing after any configuration change.
\n\nIf the site is inaccessible, run `npm run tunnel:check` **on the Mac running Blossom**. It reports independent local server, Host-routing, DNS, cloudflared process, remote gateway and OAuth checks without displaying secrets. `setup.sh` installs the binary but does not provision/start an authenticated Cloudflare Tunnel connector. Cloudflare Zero Trust must show the preexisting tunnel connected; the public hostname must point to HTTP `127.0.0.1:8787` on that same Mac and preserve the public Host header. The landing page is not the admin application; local Studio remains at `http://127.0.0.1:8787/`.\n

## OAuth goedgekeurd maar Blossom ontbreekt in ChatGPT

Het Blossom-toestemmingsscherm is **niet** de laatste installatiehandeling. Na **Verbinden met ChatGPT** stuurt Blossom een HTTP 303 terug naar de exact geregistreerde callback op chatgpt.com. ChatGPT moet vervolgens de autorisatiecode via `POST /oauth/token` inwisselen, een MCP-toolscan uitvoeren en de gebruiker moet in het aanmaakscherm nog **Create as a plugin** bevestigen. Opnieuw op de oude toestemming klikken geeft correct **Toestemming al verwerkt**; begin dan liever opnieuw vanuit ChatGPT.

Bij een bestaande ChatGPT-verbinding: open **Plugins → Add custom MCP server** op het web, voer `https://blossom.wenneker.dev/mcp` in, kies OAuth en controleer de gevraagde rechten. Na de toestemming: terug naar hetzelfde ChatGPT-aanmaakscherm, wacht tot de toolscan klaar is en kies **Create as a plugin**. Een browser-login bij ChatGPT of een Blossom-OAuth-toestemming maakt niet uit zichzelf een geïnstalleerde plugin.

Voor een diagnose: open lokaal `http://127.0.0.1:8787/`, log in als Blossom-beheerder en ga naar **Connections → Blossom MCP-koppeling met ChatGPT controleren → Controleer laatste verbindingsstap**. Of haal `GET /api/oauth/diagnostics` op vanuit een bestaande ingelogde lokale Blossom-sessie. Deze route is nooit beschikbaar via de publieke Cloudflare-host.

De meest recente fasen betekenen:

- `consent_redirected`: Blossom heeft naar ChatGPT terugverwezen; er is nog geen bewezen tokenuitwisseling
- `token_issued`: ChatGPT of een andere geregistreerde OAuth-client heeft een code ingewisseld
- `mcp_connected`: een OAuth-client heeft de MCP-initialisatie bereikt
- `tools_listed`: een OAuth-client heeft de beschikbare tools opgehaald; de stap **Create as a plugin** in ChatGPT blijft noodzakelijk
- `token_rejected`: code-/PKCE-/resourcecontrole mislukt en een nieuwe koppeling kan nodig zijn

De diagnose registreert geen wachtwoorden, OAuth-codes, tokens, PKCE-verifiers of ChatGPT-cookies. De toestemming **Alleen lezen** kan geen `studio_project_save_result` uitvoeren: daarvoor moet ChatGPT expliciet `blossom:write` aanvragen en moet je dat in de Blossom-toestemming zien en goedkeuren. Blossom vraagt bij een onbevoegde MCP-aanroep nu zowel lees- als schrijfrechten aan als OAuth-scopehint, maar geeft nooit méér rechten uit dan ChatGPT werkelijk aanvraagt en jij toestaat.

Als `consent_redirected` blijft staan, zonder `token_issued`, controleer dan de callback in het ChatGPT-tabblad of de browserontwikkelaarstools. Een ChatGPT 503, verdwenen OAuth-state of een niet-beschikbare plug-infunctie kun je niet oplossen door de Blossom-toestemming opnieuw te versturen. Maak een nieuwe koppeling vanuit ChatGPT en controleer de platformmelding.
