---
name: local-ai-headless-generation
description: "Configure and verify background lyrics generation via local Ollama"
alwaysApply: false
priority: 84
scope: project
group: ai
enabled: true
status: approved
triggers: ["local AI","Ollama","invisible","no browser","no API key"]
tags: ["ollama","generation","offline"]
---

# local-ai-headless-generation

## Workflow
1. Ask which inference engine is desired: official OpenAI API with credential versus actual local model. Explain that ChatGPT website login is not an API.
2. On a compatible Mac, use scripts/setup-local-ai.sh for explicit one-time Ollama service and model download; disclose multi-GB disk use.
3. Check localhost Ollama /api/tags, model availability and configured model; do not silently install, change or download model when a user asks only to generate.
4. Call the local /api/chat using structured result schema, source article and original music settings. Preserve model version, request status and validation.
5. Never launch Safari/Playwright or use cookies as a fallback for headless generation. Avoid remote untrusted inference base URLs.
6. Validate exact song brief fields, update the intended Studio project, read back saved result, and provide error if model is absent, slow or failed.
7. Before asserting it is currently the default Studio route, inspect src/studio-api.mjs and public/studio.js on main: provider/UI routing has changed repeatedly.
8. Verify test/local-ai.test.mjs and real Mac smoke separately. Document model limitations relative to ChatGPT.
