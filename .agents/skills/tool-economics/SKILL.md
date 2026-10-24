---
name: tool-economics
description: Use when attributing tool output to context cost.
---

purpose: measure output tokens and separate them from model cost.
when_to_use: a tool result may be delivered to a model.
inputs: tool name, output size, session, turn.
outputs: an economics record and any advisory alternative.
constraints: do not price tool runtime as model tokens.
related_entities: ax.tool-economics, tool.output, token.cost.
related_tools: ax agent economics.

seed: ax-bootstrap
seedVersion: 2.0.0
