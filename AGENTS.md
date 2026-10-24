# Blossom agent instructions

This repository has project-scoped AX rules and skills.

1. Start with .agents/rules/blossom-project-scope.mdc and the relevant topic-specific rules in .agents/rules.
2. Load relevant workflows from .agents/skills/<name>/SKILL.md. These instructions are for Blossom only.
3. Read docs/AX-BLOSSOM-KNOWLEDGE.md for product intent, source-of-truth constraints and recent integration gotchas.
4. If connected AX is pointed at some other project (for example the AX source repository), do not persist Blossom policies there. Load/index this repository as the AX project first.
5. Inspect current code and test artifacts before declaring provider login, OAuth, MCP, Studio generation, Cloudflare health or distribution completed.
6. Never copy auth secrets into model context, source files, policy or example text.
7. Use English for policy files and code comments; communicate with users in their requested language.
