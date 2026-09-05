# EVAVO Remote MCP Relay

Cloudflare-hosted bridge between supported remote MCP clients and the EVAVO Windows workstation.

## Purpose

Cloud agents cannot directly connect to `localhost` on the EVAVO workstation. This package provides a remote `/mcp` endpoint plus an outbound-only Windows WebSocket channel. The workstation never opens an inbound router or firewall port; it connects to Cloudflare over `wss://`.

When commissioned and fresh, this is the preferred EVAVO-owned remote effectful transport for ChatGPT. It is not the root of local automation. Google pressure handling, Downloads and BeeStation governance, Local Compute recovery, and their Windows scheduled tasks continue operating locally when the relay is unavailable. The governed GitHub receipt queue remains an asynchronous fallback rather than the primary remote path.

## ChatGPT Pro boundary

As of 2026-08-26, ChatGPT Pro custom MCP access is limited to read/fetch permissions. This relay therefore exposes only bounded read/status tools through MCP:

- `workstation_status`
- `workstation_capabilities`
- `gateway_fabric_status`
- `workstation_request_status`

`gateway_fabric_status` is a fixed empty-argument read. It asks the workstation for the redacted output of the canonical gateway commissioning-readiness evaluator and returns only the active fabric profile, required devices, S3/C5 presence, Comet reachability, maintenance state, snapshot drift, acceptance result, failed acceptance checks and next action. It cannot type text, press keys, move a pointer, wake a target, select a local path, run a caller-provided command, or claim physical execution.

`workstation_request_status` exposes only the request identifier, typed action, lifecycle timestamps, coarse status, delivery state, whether execution is known to have been attempted, whether a side effect may have committed, whether retry is safe, the coarse effect state and terminal reason. It never returns command output, local paths, detailed errors, or action results. Detailed request results require the authenticated API.

Effectful dispatch is deliberately **not** disguised as a read MCP tool. A separately authenticated `POST /api/dispatch` route exists for reviewed operators and trusted automation. Transport acceptance is never treated as physical success; callers must observe a correlated terminal result through the authenticated API or another separately trusted receipt channel.

## Delivery journal and replay safety

Every dispatch is tracked by a Durable Object write-ahead journal. The transport lifecycle is explicit:

```text
not_sent -> send_attempted -> sent -> completed | failed
                              \-> ambiguous (effect may have committed, no correlated terminal receipt)
```

The Worker persists `not_sent` before attempting delivery and persists `send_attempted` **before** calling `WebSocket.send()`. A successful return from `send()` advances the record to `sent`. This ordering intentionally chooses conservative ambiguity over duplicate effects if the Worker crashes around delivery.

A Durable Object alarm reconciles outstanding records at their deadline even if nobody polls them:

- `not_sent` at deadline means execution was not attempted and retry may be safe;
- a read-only request that may have been sent but produces no receipt becomes a failed read and may be retried;
- an **effectful** request that reached `send_attempted` or `sent` but has no correlated receipt becomes `ambiguous`, sets `sideEffectMayHaveCommitted=true`, sets `retrySafe=false`, and requires postcondition reconciliation;
- automatic replay of an uncertain effect is never allowed;
- a late, correctly correlated receipt may resolve an `ambiguous` record;
- once a correlated `completed` or `failed` receipt is durably stored, duplicate or contradictory later receipts cannot rewrite terminal history.

Synchronous waiters are registered before network send. A workstation result is matched to request ID, typed action and the exact authenticated WebSocket connection that received the request. The terminal record is durably written before a waiting caller is resolved. Closing a superseded socket can reject only work bound to that socket; it cannot poison requests already dispatched on a replacement connection.

Legacy queued records created before the journal contract are migrated conservatively as `send_attempted`, never assumed `not_sent`, because their historical delivery outcome cannot be reconstructed safely.

## Security boundary

- `/connect` requires the `WORKSTATION_TOKEN` Worker secret.
- `/api/dispatch` and `/api/request` require the independent `DISPATCH_TOKEN` Worker secret.
- `/mcp`, `/api/status`, and `/health` expose only coarse non-secret readiness metadata.
- No raw PowerShell or arbitrary command string, inline script source, executable, or caller-selected local path is admitted by the relay.
- Dispatch accepts only a fixed typed action allowlist. The Windows client enforces an independent local allowlist.
- Gateway read actions require an empty argument object and route through a fixed Local Storage bridge into a clean exact `origin/main` gateway checkout.
- Storage actions require an empty argument object and route through the governed local operator.
- The workstation token is stored by the Windows client using current-user DPAPI; it is not placed in Task Scheduler arguments, environment variables, or the registry.
- REST Executor v5 and Local Agent remain loopback-only.
- The Cloudflare relay does not receive local credential values, private keys, token files, arbitrary filesystem contents, or raw gateway diagnostic output.
- Desktop Commander and other external desktop-control products are not part of this relay or its fallback model.

## Single-source implementation

Wrangler deploys `src/worker.ts`. That file is the only authoritative relay implementation. `src/index.ts` is a compatibility re-export and must never contain an independent action allowlist, MCP server, or Durable Object implementation. Contract tests fail if those sources diverge.

## Cloudflare architecture

A SQLite-backed Durable Object owns the workstation connection, delivery journal, bounded request history and deadline alarms. The Windows client opens one WebSocket to `/connect`. The Durable Object uses Cloudflare WebSocket hibernation so an idle connection does not need to keep a Worker actively executing.

Each accepted workstation socket receives an internal connection identity. Dispatch records and synchronous waiters are bound to that identity so a superseded socket cannot settle or cancel another connection's work.

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

A deployment is not operational proof. Record the deployed HTTPS/WSS endpoint separately, commission the Windows relay client with its `WORKSTATION_TOKEN`, and verify `/health` or `/api/status` reports an attached workstation before relying on remote dispatch.

The deployed endpoints are:

```text
GET/POST /mcp          Remote MCP Streamable HTTP, bounded read/status tools only
GET      /health       Relay health plus coarse workstation online state
GET      /api/status   Coarse read-only workstation state
GET      /connect      Authenticated WebSocket upgrade for Windows client
POST     /api/dispatch Authenticated typed dispatch API
GET      /api/request  Authenticated detailed request polling
```

## Dispatch actions

The hosted relay transport currently admits only these fixed identifiers. The Windows client and local dispatcher must independently admit the same operation before any local effect occurs.

```text
workstation.status
workstation.repair
workstation.bootstrap
rest.health
gateway.fabric_status
storage.status
storage.inventory.refresh
storage.google_pressure.activate
storage.estate.activate
```

`gateway.fabric_status` is read-only despite using the typed workstation transport. It requires `{}` arguments, invokes only `scripts/Get-EvavoGatewayFabricStatus.ps1` in Local Storage, requires the canonical `C:\GitRepos\evavo-local-ai-agent-gateway` checkout to be clean exact `origin/main`, runs only `scripts\commissioning-readiness.ps1 -Json`, and returns a second-stage redacted summary. The MCP surface additionally re-whitelists that summary before returning it.

Physical gateway actions remain deliberately unadmitted:

```text
gateway.type_text
gateway.press_keys
gateway.move_mouse
gateway.wake_target
```

Those identifiers remain reserved until each has a separate typed schema, explicit disruption/acceptance policy, local implementation, receipt contract and end-to-end tests. They must never be implemented by widening `gateway.fabric_status` or by introducing arbitrary shell parameters.

Direct generic execution actions such as `execution.prepare`, `execution.run_request`, `godot.runtime_probe`, raw shell, and caller-supplied script text are intentionally not admitted by this internet-facing relay. Structured local execution remains owned by `evavo-local-compute` and is reached through reviewed typed capability routes or the governed GitHub issue fallback.

The storage actions require `{}` arguments and are intentionally coarse fixed operations:

- `storage.status` reads the unified storage-estate state.
- `storage.inventory.refresh` refreshes the governed local and Drive storage inventory.
- `storage.google_pressure.activate` runs the fixed archive-before-reclaim Google pressure route.
- `storage.estate.activate` runs the fixed Downloads, GitRepos, BeeStation, and EVAVO Storage estate route.

Long-running storage dispatch defaults to asynchronous pollable behavior. A `202` response means the request has reached a documented transport state such as `sent` or `ambiguous`; it is never execution-success evidence. Inspect the correlated request record until terminal receipt or reconciliation evidence exists.

## Windows client persistence

The installed client is same-user, Limited, and outbound-only. It runs at logon and has periodic recovery. A configured relay is also repaired by the zero-cost logon guardian. Failure of the relay does not block core local recovery.

The client requires the user-context credential boundary; do not convert it to S4U or SYSTEM simply to make it run while logged out. Network and DPAPI-backed credentials are part of its intended same-user boundary.

## Free-tier intent

The design is intended to fit Cloudflare Workers Free usage for a personal workstation: one Durable Object, a hibernating WebSocket, very small bounded state, and low request volume. It fails closed if a free-plan limit is reached; paid overage is not a required recovery assumption.

GitHub Actions and Vercel are not required for relay runtime or workstation storage recovery.

## Truth boundary

Source presence or a successful Cloudflare deployment does not prove the workstation is connected. `workstation_status.online=true` requires a currently attached WebSocket. A typed dispatch is execution-success evidence only after an accepted, correlated terminal result has been durably journaled. `gateway_fabric_status.ready=true` is evidence that the gateway readiness evaluator reported ready at that captured time; it is not proof that a physical HID action was executed. Local scheduled storage governance remains authoritative even when the relay is offline.
