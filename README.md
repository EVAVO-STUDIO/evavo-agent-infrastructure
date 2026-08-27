# EVAVO Agent Infrastructure

Production infrastructure for ChatGPT, Claude, Codex, and EVAVO agents to plan, code, test, build, deploy, inspect devices, and coordinate work across the EVAVO repository estate.

The design is capability-rich, but it is intentionally **not** an unrestricted public shell. Broad automation is achieved through typed specialist tools, structured local requests, explicit policy, exact source revisions, bounded receipts, and recoverable queues.

## Repository responsibilities

- `evavo-agent-infrastructure` owns chat-facing MCP routing, specialist tools, capability discovery, and the remote relay.
- `evavo-local-compute` owns structured, SHA-bound, durable local execution and the Windows Workstation Bridge.
- `evavo-local-storage` owns current-user workstation continuity, storage governance, BeeStation integration, and persistent recovery.
- `evavo-service-control-plane` owns the accepted loopback REST Executor contract.
- `evavo-development-studio` consumes those capabilities for governed cross-repository engineering.

GitHub Actions, Vercel build minutes, and paid hosted agents are not routine workstation execution authority.

## Canonical execution hierarchy

Agents must choose the narrowest capable surface:

1. **Typed specialist MCP first.** Android, Glasses, storage, testing, deployment, and device operations use their dedicated tools when available.
2. **Structured Workstation Bridge for normal host work.** The bridge prepares, plans, and executes admitted PowerShell, Python, Bash, Node, Git, curl, rclone, container, archive, repository, and filesystem operations under configured roots. Script execution is bound to a reviewed file and SHA rather than caller-supplied inline code.
3. **Durable Local Execution for long or recoverable work.** Jobs have durable state, exact runtime and source identity, logs, cancellation, bounded output, and auditable receipts.
4. **Authenticated fixed remote actions only.** The Cloudflare relay accepts a small typed action allowlist through a separate dispatch credential. Its public MCP tools are read-only.
5. **GitHub issue queue as the zero-cost fallback.** Queue requests are pure JSON, author-restricted, SHA-bound, replay-protected, non-elevated, and processed by the current-user workstation worker.

The read-only observer, compatibility guide, and public status relay are never write channels.

## Client matrix

### Claude Code and compatible local MCP clients

Project `.mcp.json` files can launch local stdio MCP servers. Repositories that need physical workstation effects register the real `evavo-windows-workstation-bridge` from `evavo-local-compute` and keep client approval and permission controls enabled.

### ChatGPT Pro

As of 2026-08-26, custom MCP access on ChatGPT Pro is read/fetch only and ChatGPT cannot directly reach a workstation `localhost` server. EVAVO therefore uses:

- the Cloudflare remote MCP relay for coarse status and capability discovery;
- OpenAI Secure MCP Tunnel where the product supports a local MCP connection;
- a separately authenticated typed dispatch route for trusted operators; and
- the GitHub issue queue when no direct effectful connector is available.

A remote MCP status response is not evidence that a command ran. Physical success requires a correlated workstation receipt.

### API agents and trusted operators

Trusted automation can use the authenticated typed relay API. It never receives a generic internet-facing `/run` endpoint, raw shell text, caller-selected executables, or arbitrary local paths.

## Retired raw-shell compatibility server

`mcp-server/windows-chat-execution-mcp.mjs` is retained only as a fail-closed migration guide. It exposes status and routing guidance and cannot execute a runtime or shell. Project configuration names it `evavo-windows-execution-migration-guide` so agents cannot mistake it for the canonical executor.

The canonical execution provider is `evavo-windows-workstation-bridge` in `evavo-local-compute`.

## Remote MCP relay

`packages/remote-mcp-relay` provides:

- outbound-only workstation WebSocket transport;
- a Cloudflare Durable Object with bounded request history;
- read-only MCP tools for status, capabilities, and coarse request state;
- independent workstation and dispatch credentials;
- fixed typed dispatch actions only; and
- no inbound workstation listener.

Wrangler deploys `packages/remote-mcp-relay/src/worker.ts`. `src/index.ts` is only a compatibility re-export, preventing source/deployment drift.

Detailed results are available only through the authenticated request API. Public MCP request status is redacted.

## Why not Open Interpreter, Aider, or a Flask `/run` endpoint?

Aider and Open Interpreter can be useful optional local user interfaces, but they do not own EVAVO execution authority, recovery, cross-repo policy, source attestation, or physical receipts.

A Flask server that accepts a command string and is exposed through ngrok or LocalTunnel is prohibited. Locking its working directory does not prevent credential theft, destructive child processes, network exfiltration, persistence, or shell escaping. EVAVO instead admits structured operations and reviewed scripts under independent policy layers.

See `docs/AI_AGENT_GATEWAY.md` for the full threat model and routing contract.

## Packages

- `@evavo/git-operations` — safe Git operations and lock handling
- `@evavo/code-quality` — TypeScript, linting, and security checks
- `@evavo/testing-runner` — tests and coverage
- `@evavo/build-system` — multi-framework builds
- `@evavo/visual-testing` — visual, accessibility, and performance checks
- `@evavo/package-manager` — dependency analysis
- `@evavo/code-review` — architecture and code review
- `@evavo/multi-repo` — cross-repository coordination
- `@evavo/remote-mcp-relay` — read-only remote MCP plus authenticated typed relay
- `mcp-server` — MCP integration and specialist physical-device tools
- `cli-tool` — command-line integration

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm type-check
pnpm format
```

Useful focused checks:

```bash
pnpm test:windows-chat-mcp
pnpm --filter @evavo/remote-mcp-relay check
pnpm --filter @evavo/git-operations test
```

## Documentation

- `docs/AI_AGENT_GATEWAY.md` — canonical client routing and security contract
- `docs/CHATGPT_LOCAL_EXECUTION_ARCHITECTURE.md` — ChatGPT/local execution transport architecture
- `packages/remote-mcp-relay/README.md` — relay deployment and truth boundaries
- `EVAVO_ECOSYSTEM_AUDIT.md` — ecosystem audit
- `COMPREHENSIVE_AGENT_INFRASTRUCTURE_DESIGN.md` — broader infrastructure design
- `CLI_REFERENCE.md` — CLI reference
- `MCP_TOOLS_REFERENCE.md` — MCP tools
- `INTEGRATION_GUIDE.md` — repository integration

## Truth boundary

Repository source and passing contract tests prove only the source contract. They do not prove the current Windows worker, Cloudflare deployment, BeeStation mount, Android device, or tunnel is online. Runtime claims require fresh status and a correlated physical receipt from the exact accepted revision.

**Status:** active implementation and physical integration  
**Node:** 20 or newer  
**Package manager:** pnpm 8 or newer
