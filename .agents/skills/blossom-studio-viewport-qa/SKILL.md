---
name: blossom-studio-viewport-qa
description: "Review compact Blossom Studio and Connections UI against mockup"
alwaysApply: false
priority: 84
scope: project
group: design
enabled: true
status: approved
triggers: ["mock-up","viewport","no vertical scroll","Connections","mobile UI"]
tags: ["ui","a11y","playwright"]
---

# blossom-studio-viewport-qa

## Procedure
1. Inspect current public/index.html, public/studio.js, public/app.js, public/viewport.css and any screenshots available in the active task. Do not invent a new visual mockup when asked to implement.
2. Confirm panel layout fits desktop viewport without document-level vertical scroll; allow independently bounded inner content when essential.
3. Test all workflows: article URL import, create/regenerate, DNA selection, lyrics edit, Suno fields, tracks/artwork, Safari login and modal statuses.
4. In normal workflows one click must trigger a visible loading/awaited state, show errors and avoid duplicate requests. Never leave dead buttons.
5. Validate narrow mobile and short-height screens, keyboard tab/Escape, focus, contrast, labels, reduced motion, long errors and dialogs.
6. Use local Playwright for layout and interaction regression, but never automate Google or other identity providers' login flows.
7. Include before/after screenshots and tests only when generated and grounded; keep branding audio-related and professional.
