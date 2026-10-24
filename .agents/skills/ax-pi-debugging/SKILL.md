---
name: ax-pi-debugging
description: Use when Ax observation fails and Pi must keep running.
---

purpose: diagnose AX_PI_INTEGRATION_ERROR without stopping Pi.
when_to_use: economics, context, or telemetry recording failed.
inputs: the error line and whether strict mode is off.
outputs: a degraded Ax result and a continuing Pi run.
constraints: fail open unless strict mode was explicitly enabled.
related_entities: pi, ax.adapter.
related_tools: ax agent economics.

seed: ax-bootstrap
seedVersion: 2.0.0
