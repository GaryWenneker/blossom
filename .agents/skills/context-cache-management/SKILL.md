---
name: context-cache-management
description: "Use when context cache keys or invalidation change."
alwaysApply: false
priority: 50
enabled: true
status: approved
scope: project
group: session-protocol
---

purpose: reuse context until project, git, intent, graph, policy, or skill inputs change.
when_to_use: a cache hit or invalidation bug.
inputs: cache key parts.
outputs: hit or invalidated entries.
constraints: do not invalidate the entire cache for an unrelated file.
related_entities: ax.context-cache, repository, ax.graph.
related_tools: ax_context.

seed: ax-bootstrap
seedVersion: 2.0.0