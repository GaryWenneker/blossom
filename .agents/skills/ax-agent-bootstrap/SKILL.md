---
name: ax-agent-bootstrap
description: Use when starting work in a repository that has Ax seed data.
---

purpose: initialize understanding of Ax architecture, runtime integration, rules, skills, and optimization without scanning the whole repository.
when_to_use: the first turn in a project, or when architecture ownership is unclear.
inputs: repository root and the user request.
outputs: a minimal context for that request.
constraints: inspect the repository structure, load architecture and runtime ownership, resolve the current project, resolve relevant graph entities, load applicable rules and skills, then begin the task. Do not scan the entire repository on every task.
related_entities: ax, pi, ax.context.
related_tools: ax bootstrap --verify, ax_context, ax_explore.

seed: ax-bootstrap
seedVersion: 2.0.0
