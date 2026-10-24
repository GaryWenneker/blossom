---
name: cloudflare-mcp-gateway-diagnosis
description: "Diagnose Blossom public Cloudflare Tunnel and protected gateway"
alwaysApply: false
priority: 84
scope: project
group: integration
enabled: true
status: approved
triggers: ["Cloudflare","blossom.wenneker.dev","site offline","502","1033"]
tags: ["cloudflare","gateway","diagnosis"]
---

# cloudflare-mcp-gateway-diagnosis

## Diagnostic workflow
1. On the host Mac run npm run tunnel:check. Do not confuse inability to load Studio at the public host with broken MCP service.
2. Verify local 127.0.0.1:8787 server; then request / on the public Host via local origin. Keep public admin routes blocked.
3. Verify Cloudflare DNS/HTTPS, existing tunnel connector, public hostname mapping to http://127.0.0.1:8787 and Host header blossom.wenneker.dev.
4. Check /healthz and /.well-known/oauth-authorization-server plus /.well-known/oauth-protected-resource: 200 JSON.
5. POST unauthenticated JSON-RPC initialize to /mcp: expect 401 plus WWW-Authenticate, not 200. Next OAuth/token/MCP steps are separate.
6. If 502/530/1033 investigate connector/origin; if 404 investigate virtual-host route; if 403 investigate Cloudflare Access/WAF challenge, retaining protection for admin paths.
7. Never provision a duplicate tunnel, expose local admin, reveal tunnel credentials or disable Cloudflare protections globally without authorization.
8. After fix verify actual public gateway and ChatGPT connection separately.
## References
scripts/check-public-tunnel.mjs, src/server.mjs, docs/chatgpt-mcp-oauth.md.
