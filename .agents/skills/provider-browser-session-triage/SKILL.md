---
name: provider-browser-session-triage
description: "Resolve Google, Spotify Facebook and ChatGPT Safari session issues"
alwaysApply: false
priority: 84
scope: project
group: integration
enabled: true
status: approved
triggers: ["login blocked","browser unsafe","Spotify Facebook","Safari sign-in","Connected status"]
tags: ["browser","sso","auth"]
---

# provider-browser-session-triage

## Procedure
1. Identify service, exact origin, browser/application, logged-in provider website vs developer API, and whether it is a normal or WebDriver-controlled browser.
2. For Google insecure-browser warnings, close prior Playwright-owned Chrome window and navigate via normal Safari/Chrome. A new tab in automated Chrome inherits the same browser environment.
3. For Spotify use official Spotify login and existing Facebook option only when supported by the account; distinguish Spotify Web Player from Spotify developer OAuth.
4. For ChatGPT consumer login, never imply Safari cookies are OpenAI API credits or automatically install the Blossom MCP plugin.
5. Browser window open and return does not prove sign-in. Present explicit user-confirmed state; persist only safe metadata, not cookies.
6. For supported API functionality, establish a separate formal OAuth/PKCE or API credential, with explicit scopes and check.
7. Test regular browser open, modal/refresh focus, first-click action, confirmation/revocation, provider isolation and no user data leakage.
## Code
src/browser-connections.mjs, src/native-browser.mjs, public/app.js and browser-status tests.
