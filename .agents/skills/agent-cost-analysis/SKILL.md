---
name: agent-cost-analysis
description: Use when explaining session or budget cost.
---

purpose: attribute cost to session, turn, model, and tool-induced context.
when_to_use: a cost or budget question.
inputs: persisted usage and budget settings.
outputs: spent, remaining, and projected figures.
constraints: do not invent a euro amount without usdPerEur. Do not change the model automatically.
related_entities: ax.cost, ax.budget, model.
related_tools: ax agent economics, ax budget.

seed: ax-bootstrap
seedVersion: 2.0.0
