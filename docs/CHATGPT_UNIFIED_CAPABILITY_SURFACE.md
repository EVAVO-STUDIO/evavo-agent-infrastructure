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
- `evavo_surface_status` — inspect native and fallback readiness;
- `evavo_relay_prepare` — prepare a governed GitHub relay request when native execution transport is unavailable.

Compatibility names `evavo_fleet_capabilities` and `fleet_capabilities` remain available for the earlier `evavo-fleet-readonly` surface.

## What “available in every chat” means

There are two separate guarantees.

### Workspace/app availability

The `evavo-fabric` custom app should be connected at the ChatGPT account or workspace level rather than attached as an ad hoc server for one task. The existing `evavo-fleet-readonly` app identity is retained as a compatibility alias so the connection can be upgraded rather than duplicated.

Repository or workstation code cannot rewrite the tool inventory already frozen into an unattached server-side conversation. That boundary is recorded explicitly instead of being hidden by optimistic status text.

### Capability continuity inside an attached chat

Once the stable app surface is present, new EVAVO capabilities do not require new top-level ChatGPT tool names. `evavo_capabilities` discovers the current catalog and `evavo_capability_invoke` routes by admitted capability ID. An existing attached chat can therefore use capabilities added after the chat began, even when its visible tool-name inventory is cached.

Direct namespaced tools are also exposed for the current catalog when the host refreshes `tools/list`, but they are an ergonomic convenience rather than the continuity mechanism.

## Routing order

1. Direct typed child MCP tool when present.
2. `evavo_capability_invoke` through the canonical workstation fabric.
3. A prepared and separately submitted GitHub receipt-relay request.

The fallback is not an unrestricted shell. It accepts an admitted capability ID and structured arguments. Raw shell, raw PowerShell, caller-selected executables, caller-supplied script source and unregistered capability IDs are rejected.

## Existing chats without the native app namespace

A conversation that already has the connected GitHub app can use the governed issue relay while the native EVAVO app is unavailable. Agents should:

1. look for `evavo_capabilities` or the compatibility capability tool;
2. when absent, use the connected GitHub source to inspect the canonical EVAVO contracts and submit only a typed relay request;
3. reconcile the authoritative execution receipt before claiming an effect;
4. never ask the operator to paste a routine terminal command merely because the native namespace is absent.

This fallback cannot make a missing native namespace appear in the current ChatGPT UI. It provides real governed execution without falsely claiming session mutation.

## Safety and evidence

- Effectful capabilities require `reviewed` mode and bounded explicit user intent.
- Capability IDs must come from the live catalog.
- Child commands and paths come from the signed/reviewed server contract, never caller input.
- The router does not accept arbitrary commands, executables or script bodies.
- An issue being closed is terminality evidence only.
- An authoritative bound receipt is required before reporting execution.
- An uncertain physical effect is never automatically replayed.
- Credentials are redacted and must not be returned as capability output.
- GitHub Actions and Vercel are not execution authorities or required dependencies.

## Operator and agent rule

Before saying EVAVO cannot perform a workstation, repository, creative, model, security or studio task, call `evavo_capabilities` and inspect the relevant capability. Absence from the model's remembered tool list is not evidence that the capability does not exist.
