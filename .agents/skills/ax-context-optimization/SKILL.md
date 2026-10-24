---
name: ax-context-optimization
description: "Use when selecting Ax context for a turn."
alwaysApply: false
priority: 50
enabled: true
status: approved
scope: project
group: session-protocol
---

purpose: supply relevant graph, memory, rules, and skills inside the context budget.
when_to_use: a turn needs repository knowledge.
inputs: intent, changed files, budget.
outputs: ordered context sections.
constraints: do not scan the whole repository and do not drop mandatory rules.
related_entities: ax.context, ax.graph, ax.memory.
related_tools: ax_context, ax_explore.

seed: ax-bootstrap
seedVersion: 2.0.0