# EVAVO Agent Infrastructure

**Complete, production-grade infrastructure enabling ChatGPT, Claude and other agents to autonomously code, test, build, deploy, inspect physical devices, and improve the EVAVO ecosystem.**

## Overview

This monorepo contains specialized packages + MCP server + CLI tooling providing agents with comprehensive capabilities across:

- **Git Operations** - Safe commits, pushes, lock file handling
- **Code Quality** - TypeScript, ESLint, security scanning
- **Testing** - Test execution, coverage analysis
- **Building** - Multi-framework builds and deployment
- **Visual Testing** - Screenshots, accessibility, performance
- **Package Management** - Dependency analysis, compatibility
- **Code Review** - Architecture validation, pattern detection
- **Multi-Repo** - Cross-repository coordination
- **Windows Chat Execution** - PowerShell, CMD, Bash and Python on the EVAVO workstation
- **Remote MCP Relay / Secure MCP Tunnel** - Chat-to-workstation connectivity without an inbound workstation listener

## Quick Start

```bash
pnpm install
pnpm build
pnpm test
pnpm type-check
pnpm format
```

## Packages

### Core Packages
- **@evavo/git-operations** - Safe git with automatic lock handling
- **@evavo/code-quality** - TypeScript, linting, security
- **@evavo/testing-runner** - Test execution and coverage
- **@evavo/build-system** - Multi-framework build orchestration
- **@evavo/visual-testing** - Visual, a11y, performance testing
- **@evavo/package-manager** - Dependency analysis and management
- **@evavo/code-review** - Automated code review
- **@evavo/multi-repo** - Cross-repo operations
- **@evavo/remote-mcp-relay** - Remote MCP status + authenticated outbound workstation relay

### Integration
- **mcp-server** - ChatGPT/Claude/MCP integration
- **cli-tool** - Command-line interface

## Local workstation execution ownership

The canonical local execution and recovery split is:

- `EVAVO-STUDIO/evavo-local-storage` owns workstation recovery, persistent Windows automation, the accepted REST Executor v5/API 2 contract and worker-fabric reachability.
- `EVAVO-STUDIO/evavo-agent-infrastructure` owns chat-facing MCP/operator authority, Windows interactive execution and remote/tunnel routing surfaces.
- `EVAVO-STUDIO/evavo-local-compute` owns structured, hash-bound durable local script/job execution.
- `EVAVO-STUDIO/evavo-development-studio` consumes those surfaces for governed engineering work.

The zero-cost recovery architecture includes independent HKCU logon recovery, the physically accepted REST Executor v5 loopback, repository-independent Scheduled Tasks, and the GitHub Issues worker fabric. GitHub Actions and paid hosted compute are not routine execution authority.

### Execution hierarchy agents must follow

1. **Typed specialist tool first.** When an Android, Glasses, storage, testing, device or other specialist MCP already expresses the requested operation, use that tool. It gives the strongest validation and evidence contract.
2. **Interactive Windows shell for normal host work.** Use `evavo-windows-chat-execution` / `evavo_windows_execute` for caller-authored PowerShell, CMD, Bash/WSL or Python that can complete within 300 seconds. This tool intentionally accepts arbitrary command text and inline code with the current Windows user's authority. It attests the physically accepted REST Executor source before effects and automatically recovers its loopback runtime when possible.
3. **Durable reviewed execution for long jobs.** Use canonical `evavo-local-execution` for longer jobs, persistence/recovery, or workflows that should be bound to a reviewed script/request SHA. Do not weaken this lane to accept arbitrary command text.
4. **Never use the observer as a write channel.** `evavo-workstation-observer` and its ChatGPT observer tunnel remain read-only. Do not add mutation or shell authority to them.

Interactive shell and durable execution are complementary, not competing implementations. The former removes manual PowerShell relay from normal agent work; the latter keeps long-running/reviewed jobs reproducible and recoverable.

## ChatGPT Windows execution

`mcp-server/windows-chat-execution-mcp.mjs` exposes:

- `evavo_windows_execution_doctor`
- `evavo_windows_execute`
- `evavo_windows_execute_batch`

The shell surface supports `powershell`, `cmd`, `bash`, and `python`, with each interactive command capped at 300 seconds. Working directories are admitted beneath configured EVAVO roots (normally `C:\GitRepos`, `%LOCALAPPDATA%\EVAVO`, and `%USERPROFILE%\Downloads`).

Before execution the MCP:

1. verifies the REST Executor source still has the physically accepted Git blob,
2. verifies the recorded 13/13 API-v2 physical acceptance,
3. checks the loopback v5/API2 runtime,
4. installs/starts the accepted same-user scheduled runtime if recovery is needed,
5. executes the command and returns a bounded structured receipt.

The MCP advertises its effectful authority explicitly: arbitrary command text and inline code are accepted, execution occurs with the current Windows user's authority, and command text is represented by digest rather than echoed back by the MCP receipt.

### ChatGPT secure execution tunnel

`Install-EvavoChatGPTWindowsExecutionTunnel.ps1` provides a **separate effectful OpenAI Secure MCP Tunnel** for the Windows execution MCP. It does not weaken or reuse the read-only observer authority.

The execution tunnel:

- bundles the MCP immutably under `%LOCALAPPDATA%\EVAVO\WorkerControlPlane\chatgpt-windows-execution`,
- uses an outbound-only secure MCP tunnel and no inbound workstation listener,
- persists as a same-user Limited scheduled task with logon and periodic recovery,
- supports PowerShell, CMD, Bash and Python,
- requires REST Executor accepted-source attestation for each execution,
- never returns tunnel IDs or credential values in installation receipts.

Useful repo commands:

```bash
pnpm chatgpt:windows-execution-tunnel
pnpm chatgpt:windows-execution-status
pnpm test:windows-chat-mcp
pnpm test:windows-chat-physical
pnpm remote-access:install-with-execution
```

`Get-EvavoChatGPTWindowsExecutionTunnelStatus.ps1` distinguishes source/bundle presence, bundle integrity, scheduled-task correctness and secure-tunnel doctor state. Code presence or task creation alone is not treated as proof that a ChatGPT product connector has been registered or that a remote command has physically executed.

## Remote MCP relay

`packages/remote-mcp-relay` provides a Cloudflare-hosted bridge for supported remote MCP clients. It uses Streamable HTTP at `/mcp` and a Durable Object hibernating WebSocket accepted from the Windows workstation.

The Cloudflare MCP surface remains deliberately read-only (`workstation_status`, `workstation_capabilities`, request status). Effectful shell authority is **not** exposed through that unauthenticated/read MCP surface. Interactive ChatGPT shell execution instead uses the dedicated OpenAI Secure MCP Tunnel above.

The workstation connects outbound only. REST Executor v5, Local Agent and local structured executors remain bound to the workstation rather than being exposed as an unauthenticated internet-facing shell.

See `packages/remote-mcp-relay/README.md` for relay deployment, secrets and security boundaries.

## Usage

### As CLI Tool

```bash
evavo git:commit --message "fix: types"
evavo git:push --verify

evavo quality:check --repo super-admin-ai-agent
evavo test:run --repo evavo-site-foundation
evavo build:verify --all
```

### As MCP Tools

Available tools include Git, quality, testing, build, visual testing, package management, review, multi-repo operations, specialist physical-device tooling and the explicit Windows chat execution surface.

## Documentation

- **EVAVO_ECOSYSTEM_AUDIT.md** - Ecosystem audit
- **COMPREHENSIVE_AGENT_INFRASTRUCTURE_DESIGN.md** - Architecture
- **CLI_REFERENCE.md** - CLI reference
- **MCP_TOOLS_REFERENCE.md** - MCP tools
- **INTEGRATION_GUIDE.md** - Repo integration
- **packages/remote-mcp-relay/README.md** - Cloudflare remote MCP relay

## Development

```bash
pnpm dev
pnpm --filter @evavo/git-operations test
pnpm type-check
pnpm test:windows-chat-mcp
pnpm format
pnpm clean
```

## Architecture

```
evavo-agent-infrastructure/
├── packages/
│   ├── git-operations/
│   ├── code-quality/
│   ├── testing-runner/
│   ├── build-system/
│   ├── visual-testing/
│   ├── package-manager/
│   ├── code-review/
│   ├── multi-repo/
│   └── remote-mcp-relay/
├── mcp-server/
│   └── windows-chat-execution-mcp.mjs
├── scripts/
│   ├── Install-EvavoChatGPTWindowsExecutionTunnel.ps1
│   └── Get-EvavoChatGPTWindowsExecutionTunnelStatus.ps1
├── cli-tool/
└── docs/
```

## Key Features

✅ Automatic lock handling  
✅ MCP and CLI integration  
✅ Type-safe packages  
✅ Contract testing  
✅ Zero-cost workstation recovery  
✅ Outbound-only secure ChatGPT execution tunnel  
✅ Interactive PowerShell/CMD/Bash/Python execution  
✅ Separate read-only observer authority  
✅ Durable SHA-bound long-job execution  

## Integration with EVAVO Repos

The `evavo-windows-chat-execution` MCP is registered from the core EVAVO workspaces (Agent Infrastructure, Local Compute, Local Storage, Development Studio, Android Device Bridge and Glasses). New MCP-aware sessions opened in those repositories should discover the same interactive Windows shell surface.

For ChatGPT product access outside a repo-local MCP client, establish the dedicated secure execution tunnel and then register/enable that tunnel connector in ChatGPT. Do not substitute the read-only observer connector when effectful execution is required.

## Roadmap

- [x] Local execution/recovery ownership contracts
- [x] Physically accepted REST Executor v5/API2
- [x] Chat-facing interactive Windows execution MCP
- [x] PowerShell/CMD/Bash/Python mixed-shell physical acceptance script
- [x] Separate secure ChatGPT Windows execution tunnel installer
- [ ] Physically run the new execution MCP acceptance on the workstation after the updated repos are locally synchronised
- [ ] Register/enable the dedicated execution tunnel in the ChatGPT product and prove a remote command round trip

## Contributing

Follow TypeScript strict mode, explicit safety/authority boundaries, test-driven development and comprehensive error handling.

## Status

**Development Status:** Active implementation and physical integration  
**Node Version Required:** >=20.0.0  
**Package Manager:** pnpm >=8.0.0

---

**EVAVO Agent Infrastructure - Enabling Autonomous Code Excellence**
