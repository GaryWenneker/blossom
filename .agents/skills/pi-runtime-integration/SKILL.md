---
name: pi-runtime-integration
description: Use when a change touches how Ax observes a Pi run.
---

purpose: keep Pi as the execution runtime and Ax as the observer.
when_to_use: Pi events, sessions, or tool lifecycle cross into Ax.
inputs: Pi public events and the project root.
outputs: normalized Ax events and derived metrics.
constraints: do not fork Pi, do not copy the transcript, fail open.
related_entities: pi, ax.adapter, ax.agent-event.
related_tools: ax agent economics.

seed: ax-bootstrap
seedVersion: 2.0.0
