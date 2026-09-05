# EVAVO ChatGPT unified capability surface

Status: canonical implementation contract

The canonical server is `mcp-server/chatgpt-unified-capability-mcp.mjs`, governed by `config/chatgpt-unified-capability-surface.v1.json`.

## Goal

Attach one stable EVAVO app surface to ChatGPT once, then allow the EVAVO capability fleet to grow without requiring a new top-level ChatGPT tool for every model, repository, studio or workstation function.

The stable surface provides:

- `evavo_capabilities` — discover every admitted capability and its availability;
- `evavo_capability_describe` — inspect one capability's schema, authority and effect classification;
- `evavo_capability_refresh` — refresh child MCP catalogs;
- `evavo_capability_invoke` — invoke an admitted typed capability by ID;
- `evavo_surface_status` — inspect native and remote-fallback readiness;
- `evavo_relay_prepare` — prepare a governed structured fallback request without executing arbitrary commands.

Compatibility names `evavo_fleet_capabilities` and `fleet_capabilities` remain available for the earlier `evavo-fleet-readonly` surface.

## What “available in every chat” means

### Workspace/app availability

The `evavo-fabric` custom app should be connected at the ChatGPT account or workspace level rather than attached as an ad hoc server for one task. The existing `evavo-fleet-readonly` identity is retained as a compatibility alias so the connection can be upgraded rather than duplicated.

Repository or workstation code cannot rewrite the tool inventory already frozen into an unattached server-side conversation. This boundary must be reported truthfully.

### Capability continuity inside an attached chat

Once the stable app surface is present, new EVAVO capabilities do not require new top-level ChatGPT tool names. `evavo_capabilities` discovers the current catalog and `evavo_capability_invoke` routes by admitted capability ID. Direct namespaced tools may also be exposed when the host refreshes `tools/list`, but they are an ergonomic convenience rather than the continuity mechanism.

## Routing order

For an admitted operation, use the first eligible EVAVO-owned route:

1. Direct typed child MCP tool when present.
2. `evavo_capability_invoke` through the canonical workstation fabric.
3. **`cloudflare-typed-relay`** for remote effectful workstation work when commissioned and fresh. This is an outbound-workstation WebSocket path with a fixed typed action allowlist and correlated receipts.
4. The governed GitHub receipt relay as an asynchronous fallback when the typed relay is unavailable or insufficient for the admitted operation.
5. EVAVO Computer Agent, S3 HID, Comet KVM or out-of-band recovery only when narrower in-band routes cannot complete the task.

Desktop Commander and other external desktop-control products are not admitted routes and are not recovery fallbacks.

## Existing chats without the native app namespace

A conversation cannot gain a native app namespace merely because repository code changed. If `evavo-fabric` is absent:

1. use a currently attached EVAVO typed relay surface if one is available;
2. otherwise use connected GitHub only to inspect the canonical contracts and submit the bounded Local Compute receipt-relay fallback;
3. reconcile an authoritative correlated execution receipt before claiming an effect;
4. never ask the operator to paste a routine terminal command merely because the native namespace is absent.

The fallback cannot mutate the ChatGPT UI or pretend a missing namespace is connected. It only provides governed transport for an admitted request.

## Relay truth model

A remote request must distinguish transport progress from execution outcome. At minimum the relay must preserve whether a request was never sent, may have been delivered, and reached a correlated terminal receipt. A deadline or disconnect after delivery is an uncertain outcome until reconciled; it is not safe to replay automatically.

A transport returning HTTP 2xx, a WebSocket accepting a message, Task Scheduler reporting a task, a GitHub issue closing, or a process exiting zero does not by itself prove the intended workstation postcondition.

## Safety and evidence

- Effectful capabilities require reviewed mode and bounded explicit user intent.
- Capability IDs must come from the admitted catalog or fixed local relay allowlist.
- Child commands and paths come from reviewed server contracts, never caller input.
- Arbitrary shell, raw PowerShell, caller-selected executables and caller-supplied script bodies are rejected.
- An authoritative correlated receipt is required before reporting execution.
- Any possibly committed effect with missing or contradictory terminal evidence requires postcondition reconciliation before another attempt.
- Credentials are redacted and must not be returned as capability output.
- GitHub Actions and Vercel are not execution authorities or required dependencies.

## Operator and agent rule

Before saying EVAVO cannot perform a workstation, repository, creative, model, security or studio task, inspect `evavo_capabilities` and all eligible native EVAVO transports. Failure of one transport never means the MSI is offline without independent machine-level evidence.
