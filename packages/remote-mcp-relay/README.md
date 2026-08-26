# EVAVO Remote MCP Relay

Cloudflare-hosted bridge between supported remote MCP clients and the EVAVO Windows workstation.

## Purpose

This package solves a specific boundary: ChatGPT and other cloud agents cannot directly connect to `localhost` on the EVAVO workstation. The relay provides a remote `/mcp` endpoint plus an outbound-only Windows WebSocket channel.

The workstation never opens an inbound router port. It connects to Cloudflare over `wss://`.

## Current ChatGPT plan boundary

As of 2026-08-26, ChatGPT Pro custom MCP access is limited to read/fetch permissions. Therefore this relay exposes only read-only workstation status/capability tools through MCP:

- `workstation_status`
- `workstation_capabilities`

Effectful dispatch is deliberately **not** disguised as a read MCP tool. A separately authenticated `POST /api/dispatch` route exists for Codex, reviewed local agents, and future/full MCP clients.

## Security boundary

- `/connect` requires the `WORKSTATION_TOKEN` Worker secret.
- `/api/dispatch` requires the independent `DISPATCH_TOKEN` Worker secret.
- `/mcp`, `/api/status`, and `/health` expose only coarse non-secret readiness metadata.
- No raw PowerShell or arbitrary command string is an admitted relay action.
- Dispatch accepts only a small typed action allowlist. The Windows client enforces a second local allowlist.
- REST Executor v5 and Local Agent remain loopback-only.
- The Cloudflare relay does not receive local credential values, private keys, token files, or arbitrary filesystem contents.

## Cloudflare architecture

A SQLite-backed Durable Object owns the workstation connection. The Windows client opens one WebSocket to `/connect`. The Durable Object uses Cloudflare's WebSocket Hibernation API so idle connections can remain attached without continuously consuming active duration.

The MCP endpoint is stateless Streamable HTTP using Cloudflare Agents SDK `createMcpHandler()` and MCP SDK v2.

## Required Worker secrets

```text
WORKSTATION_TOKEN=<random high-entropy workstation connection token>
DISPATCH_TOKEN=<different random high-entropy dispatch token>
```

Never commit these values.

## Deploy

From this package after dependencies are installed and Cloudflare Wrangler is authenticated:

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

The deployed endpoints are:

```text
GET/POST /mcp          Remote MCP Streamable HTTP
GET      /health       Relay health + coarse workstation online state
GET      /api/status   Coarse read-only workstation state
GET      /connect      Authenticated WebSocket upgrade for Windows client
POST     /api/dispatch Authenticated typed dispatch API (not exposed as Pro MCP)
```

## Dispatch actions

The hosted relay accepts only these action identifiers:

```text
workstation.status
workstation.repair
workstation.bootstrap
rest.health
execution.prepare
execution.run_request
godot.runtime_probe
```

This list is transport admission only. The Windows client must validate every action and argument again before any local effect.

## Free-tier intent

The design is intended to fit Cloudflare Workers Free usage for a personal workstation: one Durable Object, a hibernating WebSocket, very small state, and low request volume. It must fail closed if a free-plan limit is reached; paid overage is not a required recovery assumption.

## Truth boundary

Source presence or a successful Cloudflare deploy does not prove the workstation is connected. `workstation_status.online=true` requires a currently attached WebSocket. A successful typed dispatch additionally requires a correlated result from the Windows client.
