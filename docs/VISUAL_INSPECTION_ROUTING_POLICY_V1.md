# EVAVO Visual Inspection Routing Policy v1

Browser and desktop visual inspection are capability-routing problems, not Remote Desktop Commander availability checks.

## Canonical browser visual path

For browser visual QA, agents must evaluate routes in this order:

1. EVAVO Computer Agent native Playwright screenshot capture with screenshot SHA-256 evidence.
2. EVAVO Computer Agent Visual Review retained-evidence MCP.
3. EVAVO Computer Agent typed relay.
4. EVAVO Computer Agent structured Workstation Bridge or durable local execution.
5. Local Compute / GitHub issue queue only to bootstrap or repair the native Computer Agent visual path.
6. External remote-desktop tooling such as Desktop Commander only after native EVAVO routes are unavailable and only when that external route is actually useful for the requested surface.

Desktop Commander is not a canonical visual-inspection authority and its availability does not define MSI power state, browser availability, screenshot capability, Computer Agent readiness, Local Compute readiness, or local-verification state.

## Pixel-inspection proof

A claim of direct browser pixel inspection requires evidence for the actual captured image, not merely DOM state or a connector heartbeat. The minimum proof is:

- a PNG capture from the admitted browser surface;
- SHA-256 calculated from the exact PNG bytes;
- captured byte length;
- a retained or directly returned pixel-byte source available to the reviewing agent;
- when evidence is retained through another provider, digest and byte-length agreement between capture and retained evidence;
- exact target/source identity and a fresh receipt for runtime-readiness claims.

Semantic DOM evidence, accessibility state, hit-test evidence and screenshot pixels should be fused when available. DOM evidence supplements pixels; it does not substitute for pixels when the task explicitly requires visual inspection.

## Required status language

Do not write:

> I cannot inspect the browser screenshot because the MSI connector is unavailable.

Do not write:

> The MSI is offline, so visual QA cannot run.

unless independent machine-state evidence actually proves the MSI itself is offline.

When one route is unavailable, report the route rather than the workstation:

> The attempted visual-inspection route is unavailable. Native Computer Agent Playwright, Visual Review, typed-relay, structured-bridge and repair routes must be evaluated before declaring browser pixel inspection unavailable.

When no admitted route is currently usable:

> No admitted visual-inspection route is currently reachable from this agent. This does not establish that the MSI or browser is offline.

## Truth boundaries

Source presence is not a physical runtime pass. A routing configuration is not a screenshot receipt. A digest without accessible pixel bytes is not direct pixel inspection. A connector heartbeat is not browser visual proof.

Conversely, the absence of a specific remote-desktop connector is not evidence that native browser screenshot capture is unavailable. Runtime status must be derived per capability and per route.

## Ownership

- Computer Agent owns browser/Windows perception, screenshot evidence, GUI semantics and visual interaction.
- Automated Testing owns QA campaigns, findings, comparison and retest state.
- Local Compute owns bounded local execution and visual/model compute used by Computer Agent.
- Agent Infrastructure owns client-facing capability discovery and routing.
- Workstation Manager owns workstation resource state and admission.
- Desktop Commander is an optional external fallback and is never machine-health authority.
