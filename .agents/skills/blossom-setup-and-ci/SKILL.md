---
name: blossom-setup-and-ci
description: "Run Mac installer and green trunk-based development safely"
alwaysApply: false
priority: 84
scope: project
group: engineering
enabled: true
status: approved
triggers: ["setup.sh","Ratatui","Node 22","CI","merge","deploy"]
tags: ["setup","ci","release"]
---

# blossom-setup-and-ci

## Workflow
1. Inspect git status, currently active branch, current origin/main, existing running services and env without displaying secrets. Protect uncommitted local work.
2. Before changes run AX preflight scoped to Blossom, inspect matching rules/skills and affected tests. Reuse existing architecture.
3. Implement on an updated feature branch; add tests for behavior and regressions rather than merely changing UI text.
4. Run npm run check and npm test; ensure GitHub Node.js 22/24, public MCP/OAuth and Ratatui installer jobs are green. Record optional FFmpeg/audio smoke limitations.
5. For native service setup, use bash setup.sh or --headless as supported, ensure .env and SQLite preserved. Separate downloading local models from base setup where explicit.
6. Merge only after green checks and explicit approval when required by repository; report actual merge commit, not just PR creation.
7. On user's Mac, update through safe fast-forward, restart io.wenneker.blossom.server if installed and verify local and Cloudflare /healthz. CI cannot substitute for checking Mac launchd/cloudflared.
8. Never claim a tunnel, Netlify release, ChatGPT connector or provider browser login has been deployed or verified unless live evidence exists.
