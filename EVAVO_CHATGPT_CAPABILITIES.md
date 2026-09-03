# EVAVO ChatGPT capabilities

This is the stable discovery entrypoint for every ChatGPT conversation that can access EVAVO GitHub repositories.

## Native EVAVO app

The canonical app identity is **`evavo-fabric`**. The previous **`evavo-fleet-readonly`** identity is a compatibility alias for the same server.

Use these stable tools:

- `evavo_capabilities`
- `evavo_capability_describe`
- `evavo_capability_refresh`
- `evavo_capability_invoke`
- `evavo_surface_status`
- `evavo_relay_prepare`

Always call `evavo_capabilities` before saying that an EVAVO workstation, repository, model, creative, security or studio capability is unavailable.

New capabilities are placed behind the stable catalog/router. They do not require a new top-level ChatGPT function name, so an already attached conversation can discover tools introduced after that conversation began.

## Existing chat without the native namespace

Use the connected GitHub app and the governed Local Compute receipt relay:

1. Read the exact current `main` versions of:
   - `config/chatgpt-unified-capability-surface.v1.json`
   - `config/chatgpt-unified-mcp-registration.v1.json`
   - `docs/CHATGPT_UNIFIED_CAPABILITY_SURFACE.md`
2. Use the typed dispatcher `EVAVO-STUDIO/evavo-local-compute:automation/remote-jobs/Dispatch-EvavoCapabilityV1.py`.
3. Obtain its current immutable SHA through the standard Local Compute trusted-job hasher or use the digest admitted by the exact current capability-surface contract.
4. Submit a Local Compute queue issue whose title is exactly `[EVAVO LOCAL EXEC] ` plus its `jobId`.
5. Pass only a catalog-admitted capability ID, base64url-encoded JSON object arguments and bounded explicit user intent.
6. Reconcile the authoritative terminal receipt before saying the capability ran.

The fallback does **not** accept arbitrary shell, raw PowerShell, caller-selected executables, caller-supplied script source or an unregistered capability ID.

## Persistent discovery

The Windows same-user capability-catalog resident keeps a redacted schema catalog under the installed EVAVO unified surface. Cached entries are discovery-only and deliberately marked unavailable. They become invocable only when the live admitted MCP transport returns.

This means a temporary Local Agent or tunnel outage does not make known capabilities disappear, but stale cache state can never become execution authority.

## Truth boundary

A repository commit or local launcher cannot inject a native app into a server-side conversation that never had the app connected. For such a conversation, the GitHub receipt relay is the effectful fallback. Account/workspace app connection remains the route for a visible native `evavo-fabric` namespace.

GitHub issue closure proves terminality only. A bound Local Compute receipt proves execution outcome.
