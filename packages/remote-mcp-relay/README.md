# EVAVO Remote MCP Relay

Cloudflare-hosted bridge between supported remote MCP clients and the EVAVO Windows workstation.

## Purpose

This package solves a specific boundary: cloud agents cannot directly connect to `localhost` on the EVAVO workstation. The relay provides a remote `/mcp` endpoint plus an outbound-only Windows WebSocket channel.

The workstation never opens an inbound router port. It connects to Cloudflare over `wss://`.

The relay is an additional remote control plane, not the root of storage automation. Google pressure, Downloads/BeeStation governance, Local Compute recovery and their Windows scheduled tasks must continue operating locally when the relay is unavailable.

## ChatGPT Pro boundary

As of 2026-08-26, the EVAVO ChatGPT Pro integration treats MCP as a read-only remote surface. The relay therefore exposes only read/status tools through MCP:

- `workstation_status`
- `workstation_capabilities`
- `workstation_request_status`

Effectful dispatch is deliberately **not** disguised as a read MCP tool. A separately authenticated `POST /api/dispatch` route exists for Codex, reviewed local agents and future/full MCP clients. A queued request is never treated as physical success; callers must observe the correlated completed result, directly or through `workstation_request_status`.

## Security boundary

- `/connect` requires the `WORKSTATION_TOKEN` Worker secret.
- `/api/dispatch` requires the independent `DISPATCH_TOKEN` Worker secret.
- `/mcp`, `/api/status`, and `/health` expose only coarse non-secret readiness metadata.
- No raw PowerShell, shell command, script source, executable or caller-selected local path is an admitted storage action.
- Dispatch accepts only a typed action allowlist. The Windows client enforces a second local allowlist.
- Storage actions require an empty argument object and route through `Invoke-EvavoRemoteOperatorRequest.ps1`.
- The workstation token is stored by the Windows client using current-user DPAPI; it is not placed in Task Scheduler arguments, environment variables or the registry.
- REST Executor v5 and Local Agent remain loopback-only.
- The Cloudflare relay does not receive local credential values, private keys, token files or arbitrary filesystem contents.

## Cloudflare architecture

A SQLite-backed Durable Object owns the workstation connection. The Windows client opens one WebSocket to `/connect`. The Durable Object uses Cloudflare WebSocket hibernation so an idle connection does not need to keep a Worker actively executing.

The MCP endpoint is stateless Streamable HTTP using Cloudflare Agents SDK `createMcpHandler()` and MCP SDK v2.

## Required Worker secrets

```text
WORKSTATION_TOKEN=<random high-entropy workstation connection token>
DISPATCH_TOKEN=<different random high-entropy dispatch token>
```

Never commit these values or reuse one token for both roles.

## Deploy

From this package after dependencies are installed and Wrangler is authenticated:

```powershell
pnpm type-check
pnpm test
pnpm deploy
```

Set both secrets before relying on the endpoint:

```powershell
npx wrangler secret put WORKSTATION_TOKEN
npx wrangler secret put DISPATCH_TOKEN
```

A deployment is not operational proof. Record the deployed HTTPS/WSS endpoint separately, commission the Windows relay client with its `WORKSTATION_TOKEN`, and verify `/health`/`/api/status` reports an attached workstation before relying on remote dispatch.

The deployed endpoints are:

```text
GET/POST /mcp          Remote MCP Streamable HTTP, read/status tools only
GET      /health       Relay health + coarse workstation online state
GET      /api/status   Coarse read-only workstation state
GET      /connect      Authenticated WebSocket upgrade for Windows client
POST     /api/dispatch Authenticated typed dispatch API
GET      /api/request  Poll a previously queued dispatch request
```

## Dispatch actions

The hosted relay transport admits these identifiers. The Windows client/local dispatcher must independently admit the same operation before any local effect occurs.

```text
workstation.status
workstation.repair
workstation.bootstrap
rest.health
execution.prepare
execution.run_request
godot.runtime_probe
storage.status
storage.inventory.refresh
storage.google_pressure.activate
storage.estate.activate
```

The storage actions require `{}` arguments. They are intentionally coarse fixed operations:

- `storage.status` — read the unified storage-estate state.
- `storage.inventory.refresh` — refresh the governed local/Drive storage inventory.
- `storage.google_pressure.activate` — run the fixed archive-before-reclaim Google pressure route.
- `storage.estate.activate` — run the fixed Downloads/GitRepos/BeeStation/EVAVO Storage estate route.

Long-running storage dispatch defaults to queued/pollable behavior. `202 queued` is only transport acceptance, not execution success.

## Windows client persistence

The installed client is same-user, Limited and outbound-only. It runs at logon and has periodic recovery. A configured relay is also repaired by the zero-cost logon guardian. Failure of the optional relay does not block core local recovery.

The client requires the user-context credential boundary; do not convert it to S4U or SYSTEM simply to make it run while logged out. Network and DPAPI-backed credentials are part of its intended same-user boundary.

## Free-tier intent

The design is intended to fit Cloudflare Workers Free usage for a personal workstation: one Durable Object, a hibernating WebSocket, very small state and low request volume. It must fail closed if a free-plan limit is reached; paid overage is not a required recovery assumption.

GitHub Actions and Vercel are not required for relay runtime or workstation storage recovery.

## Truth boundary

Source presence or a successful Cloudflare deployment does not prove the workstation is connected. `workstation_status.online=true` requires a currently attached WebSocket. A successful typed dispatch additionally requires a correlated result from the Windows client. Local scheduled storage governance remains authoritative even when the relay is offline.
