# ChatGPT + EVAVO Local Execution Architecture

Status: canonical design for hosted ChatGPT, local coding agents and the EVAVO Windows workstation.

## Goal

A chat should not depend on remembering which legacy receiver, script or storage path to use. EVAVO has one local execution authority and one recovery path. Hosted ChatGPT gets only the capability surface the product and security boundary can safely support.

## Canonical components

1. **Local execution MCP**
   - Owner: `evavo-agent-infrastructure`
   - Runtime: `mcp-server/local-agent-mcp.mjs`
   - Local transport: stdio
   - Receiver: authenticated loopback Local Agent REST on `127.0.0.1:4329`

2. **Windows node lifecycle / recovery**
   - Owner: `evavo-local-storage`
   - Entry point: `scripts/manage-autonomous-node.ps1`
   - Recovery chain: `diagnose -> repair -> restart -> acceptance`
   - Existing scheduled updater, heartbeat, watchdog and daily recovery remain the only persistent lifecycle owner.

3. **Chat readiness command**
   - Owner: `evavo-agent-infrastructure`
   - Entry point: `scripts/Ensure-EvavoChatLocalAgent.ps1`
   - Normal command: `pnpm chat:local-agent:ensure`
   - Explicit operator acceptance: `pnpm chat:local-agent:ensure-operator`
   - The command performs one bounded automatic repair attempt. It never loops indefinitely and never adds permanent-delete authority.

## Capability boundary

Normal MCP tools remain bounded:

- capability/status checks;
- fixed receiver-owned actions;
- bounded read/list operations;
- create-only writes to admitted non-Git roots;
- create-only local copies with destination SHA-256 verification.

`C:\GitRepos` is readable but is not a normal-token write root. Permanent delete is not part of the normal MCP authority.

The operator tool is a separate, explicitly enabled capability. It must never be exposed directly as an unauthenticated or public Internet endpoint.

## Hosted ChatGPT

Hosted ChatGPT should use a **remote/private MCP connection**, not attempt to spawn the local stdio process itself.

For a workstation/private-network MCP, prefer OpenAI Secure MCP Tunnel or another reviewed private tunnel supported by the ChatGPT product. Do not expose `127.0.0.1:4329`, its bearer credentials, or unrestricted shell execution through a public Cloudflare Worker.

The remote Chat-facing surface is a projection, not a second executor. It should delegate to the same canonical Local Agent authority and preserve the same receipts, logical roots and SHA-verification rules.

### Plan-aware behavior

ChatGPT product permissions are authoritative. If the current account/workspace permits only read/fetch custom MCP actions, the Chat projection must remain read-only even though the workstation itself supports effectful local execution. Full write/modify tools should only be published where the ChatGPT plan/workspace explicitly supports them.

This is intentional: repo code must not try to bypass ChatGPT product permissions.

## Self-healing behavior

`Ensure-EvavoChatLocalAgent.ps1` is the stable doctor contract:

1. run full MCP physical acceptance;
2. if healthy, return success immediately;
3. if unhealthy, collect autonomous-node diagnostics;
4. run Local Storage repair;
5. restart the autonomous node;
6. wait briefly for loopback REST readiness;
7. rerun the full MCP acceptance once;
8. return a machine-readable receipt and fail visibly if still unhealthy.

The acceptance test proves more than port availability. It verifies MCP identity, capability projection integrity, authenticated Local Agent status, bounded create-only write/read/list behavior and SHA-verified copy behavior.

## BeeStation transfer rule

For Drive/off-machine cleanup, the safe sequence is:

1. materialize/download to local staging;
2. copy to logical `beestation` through the canonical Local Agent;
3. require `destinationHashVerified=true` and record the SHA-256 receipt;
4. only then remove the cloud source when deletion was explicitly authorized.

Unique cloud data must not be deleted merely because a BeeStation destination was intended.

## Failure semantics

- No automatic replay of an operator command whose execution outcome is unknown.
- No infinite repair loop.
- No automatic force-push, hard reset, git clean or permanent deletion.
- No silent fallback from canonical BeeStation to an arbitrary local directory.
- No second persistent local shell service.
- No public Internet exposure of workstation credentials or shell authority.

## Client integration rule

Every EVAVO repo that needs local execution should point its `evavo-local-agent-executor` MCP entry at the canonical `evavo-agent-infrastructure/mcp-server/local-agent-mcp.mjs` implementation (directly or through the standard local path), rather than defining another effectful receiver.

Legacy/read-only receivers may remain for compatibility and inspection, but they must not be presented as the canonical execution authority.
