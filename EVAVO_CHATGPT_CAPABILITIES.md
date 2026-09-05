# EVAVO ChatGPT capabilities

This is the stable discovery entrypoint for ChatGPT conversations that can access the EVAVO fabric.

## Native EVAVO app

The canonical app identity is **`evavo-fabric`**. The previous **`evavo-fleet-readonly`** identity remains a compatibility alias for the same server.

Use these stable tools:

- `evavo_capabilities`
- `evavo_capability_describe`
- `evavo_capability_refresh`
- `evavo_capability_invoke`
- `evavo_surface_status`
- `evavo_relay_prepare`

Always call `evavo_capabilities` before saying that an EVAVO workstation, repository, model, creative, security or studio capability is unavailable.

New capabilities live behind the stable catalog/router. They do not require a new top-level ChatGPT function name, so an attached conversation can discover capabilities introduced after that conversation began.

## Remote effectful routing

For effectful workstation work from ChatGPT, use EVAVO-owned routes only:

1. A directly attached native EVAVO capability or typed child MCP when available.
2. The commissioned **`cloudflare-typed-relay`** for remote effectful execution. The Windows workstation connection is outbound WebSocket only and the relay accepts only fixed, typed, locally admitted actions.
3. The governed GitHub receipt relay as an **asynchronous fallback** when the typed relay is unavailable or does not admit the requested operation.
4. Governed S3 HID, Comet KVM or EVAVO out-of-band recovery only when narrower in-band EVAVO routes are unavailable or insufficient.

Desktop Commander and other external desktop-control products are not admitted routes, are not fallbacks, and are not required for local verification.

## Existing chat without the native namespace

A repository commit cannot inject a new native app namespace into an already established server-side conversation. When the visible `evavo-fabric` namespace is absent, first use a commissioned EVAVO Cloudflare typed-relay surface if the current chat exposes it. If that route is not attached, the connected GitHub app can prepare and submit the governed Local Compute receipt relay.

For the GitHub fallback:

1. Read the exact current `main` versions of `config/chatgpt-unified-capability-surface.v1.json`, `config/chatgpt-unified-mcp-registration.v1.json` and `docs/CHATGPT_UNIFIED_CAPABILITY_SURFACE.md`.
2. Use only the catalog-admitted typed dispatcher owned by Local Compute and its exact current trusted digest.
3. Submit a bounded structured request with an admitted capability ID and explicit user intent.
4. Reconcile the authoritative correlated terminal receipt before claiming execution.

Neither fallback accepts arbitrary shell, raw PowerShell, caller-selected executables, caller-supplied script source or an unregistered capability ID.

## Persistent discovery

The Windows same-user capability-catalog resident keeps a redacted schema catalog under the installed EVAVO unified surface. Cached entries are discovery-only and deliberately marked unavailable. They become invocable only when a live admitted transport returns.

A temporary Local Agent, relay or tunnel outage therefore does not make known capabilities disappear, while stale cache state can never become execution authority.

## Truth boundary

Transport success is not physical outcome proof. A relay HTTP success, WebSocket send, Scheduled Task state, GitHub issue closure or generic process exit can establish progress only. An authoritative correlated receipt plus any required postcondition evidence is needed before an effect is reported as executed.

If delivery may have occurred but the terminal receipt is missing or contradictory, classify the outcome as uncertain and reconcile the postcondition before any replay. Automatic replay of a possibly committed effect is forbidden.
