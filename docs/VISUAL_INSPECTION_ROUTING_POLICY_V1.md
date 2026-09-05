# EVAVO Visual Inspection Routing Policy v1

Browser and desktop visual inspection are capability-routing problems, not Remote Desktop Commander availability checks.

## Canonical browser visual paths

EVAVO deliberately keeps two native browser-visual authorities because they solve different jobs and provide independent fallback value.

For direct browser perception and pixel inspection, evaluate `browser.visual-inspect` in this order:

1. EVAVO Computer Agent native Playwright screenshot capture with screenshot SHA-256 evidence.
2. EVAVO Computer Agent Visual Review retained-evidence MCP.
3. EVAVO Computer Agent typed relay.
4. EVAVO Computer Agent structured Workstation Bridge or durable local execution.
5. Local Compute through `browser.visual-bootstrap` only when the native Computer Agent visual runtime needs bounded repair or startup.
6. External remote-desktop tooling such as Desktop Commander only after native EVAVO routes are unavailable and only when that external route is actually useful for the requested surface.

For autonomous visual QA, comparison and retest campaigns, resolve the separate `browser.visual-qa` capability owned by Automated Testing. Its native Playwright visual-QA lane captures a real PNG, binds the screenshot SHA-256 and byte length, retains source-bound observation and layout evidence, checks geometry and can detect known visual defects. ChatGPT may reach that campaign authority through the typed relay or zero-cost issue queue; local agents may use the specialist MCP, Workstation Bridge or durable local execution.

A `browser.visual-qa` pass is automated QA evidence. It does not become human UX, brand, aesthetic or creative approval. Likewise, successful `browser.visual-bootstrap` only proves the native runtime was repaired or started; it does not prove a target screenshot was inspected.

Desktop Commander is not a canonical visual-inspection or visual-QA authority and its availability does not define MSI power state, browser availability, screenshot capability, Computer Agent readiness, Automated Testing readiness, Local Compute readiness, or local-verification state.

## Pixel-inspection proof

A claim of direct browser pixel inspection requires evidence for the actual captured image, not merely DOM state or a connector heartbeat. The minimum proof is:

- a PNG capture from the admitted browser surface;
- SHA-256 calculated from the exact PNG bytes;
- captured byte length;
- a retained or directly returned pixel-byte source available to the reviewing agent;
- when evidence is retained through another provider, digest and byte-length agreement between capture and retained evidence;
- exact target/source identity and a fresh receipt for runtime-readiness claims.

Semantic DOM evidence, accessibility state, hit-test evidence and screenshot pixels should be fused when available. DOM evidence supplements pixels; it does not substitute for pixels when the task explicitly requires visual inspection.

For an Automated Testing visual-QA claim, additionally require the campaign/doctor receipt to revalidate its source identity, screenshot digest and bytes, observation digest, layout digest, viewport relationship and any campaign-owned visual assertions. A queue issue or worker heartbeat is not visual-QA completion evidence.

## Required status language

Do not write:

> I cannot inspect the browser screenshot because the MSI connector is unavailable.

Do not write:

> I have not had pixel-by-pixel browser screenshot inspection because the MSI workstation connector is unavailable.

Do not write:

> The MSI is offline, so visual QA cannot run.

unless independent machine-state evidence actually proves the MSI itself is offline.

When one route is unavailable, report the route rather than the workstation:

> The attempted visual-inspection route is unavailable. Native Computer Agent Playwright, Visual Review, typed-relay, structured-bridge, Automated Testing visual-QA and repair routes must be evaluated before declaring browser pixel inspection unavailable.

When no admitted route is currently usable:

> No admitted visual-inspection route is currently reachable from this agent. This does not establish that the MSI or browser is offline.

## Truth boundaries

Source presence is not a physical runtime pass. A routing configuration is not a screenshot receipt. A digest without accessible pixel bytes is not direct pixel inspection. A connector heartbeat is not browser visual proof. A visual-QA queue acceptance is not a completed visual-QA run.

Conversely, the absence of a specific remote-desktop connector is not evidence that native browser screenshot capture is unavailable. Runtime status must be derived per capability and per route.

## Ownership

- Computer Agent owns browser/Windows perception, direct screenshot evidence, GUI semantics and visual interaction.
- Automated Testing owns autonomous visual-QA campaigns, findings, comparison, defect evidence and retest state.
- Local Compute owns bounded local execution and bootstrap/repair substrate used by the visual authorities; it does not absorb their domain ownership.
- Agent Infrastructure owns client-facing capability discovery and routing.
- Workstation Manager owns workstation resource state and admission.
- Desktop Commander is an optional external fallback and is never screenshot-truth, QA-completion or machine-health authority.
