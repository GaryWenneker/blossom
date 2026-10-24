---
name: mcp-oauth-diagnosis
description: "Trace Blossom ChatGPT MCP setup from discovery to tool use without leaking secrets"
alwaysApply: false
priority: 85
scope: project
group: integration
enabled: true
status: approved
triggers: ["Blossom MCP","Connect hangs","OAuth","consent denied","token_issued","tools_listed"]
tags: ["mcp","oauth","diagnostic"]
---

# mcp-oauth-diagnosis

## Diagnostic stages
1. Check HTTPS public OAuth discovery and protected resource metadata both return HTTP 200 JSON with correct issuer/resource.
2. Verify unauthenticated JSON-RPC POST /mcp returns HTTP 401 with WWW-Authenticate bearer resource_metadata and declared scopes. A 401 here is expected, not a connection failure.
3. Inspect local authenticated GET /api/oauth/diagnostics event history (not only latestStage). Never share code, verifier, state, redirect query or token values.
4. Interpret: client_registered => client known; consent_shown => form shown; consent_denied => explicit denial submitted; consent_redirected => 303 sent; token_issued => grant exchanged; mcp_connected => initialize reached; tools_listed => tool scan reached.
5. Read-only blossom:read cannot save projects; explicitly request, approve and test blossom:write.
6. If consent redirected but token not issued, check ChatGPT callback origin/path, browser navigation and server token endpoint availability without logging sensitive query strings. A repeated form cannot renew a grant.
7. If token issued but no tools_listed, inspect MCP protocol version, bearer token scope, initialize response, tool schemas and standard HTTP/SSE semantics.
8. Even with tools_listed, finish plugin creation/enablement in ChatGPT if available to account. Verify actual app/tool access using studio_project_get before attempting writes.

## Code
src/mcp-oauth.mjs; src/music-dna-mcp.mjs; docs/chatgpt-mcp-oauth.md; test/mcp-oauth.test.mjs.
