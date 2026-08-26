# EVAVO Agent Infrastructure

**Complete, production-grade infrastructure enabling Claude and other agents to autonomously code, test, build, deploy, and improve the entire EVAVO ecosystem.**

## Overview

This monorepo contains specialized packages + MCP server + CLI tool providing agents with comprehensive capabilities across:

- **Git Operations** - Safe commits, pushes, lock file handling
- **Code Quality** - TypeScript, ESLint, security scanning
- **Testing** - Test execution, coverage analysis
- **Building** - Multi-framework builds, Vercel deployment
- **Visual Testing** - Screenshots, accessibility, performance
- **Package Management** - Dependency analysis, compatibility
- **Code Review** - Architecture validation, pattern detection
- **Multi-Repo** - Cross-repository coordination
- **Remote MCP Relay** - Cloudflare-hosted workstation readiness bridge

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
- **mcp-server** - Claude/MCP integration
- **cli-tool** - Command-line interface

## Local workstation execution ownership

The canonical local execution and recovery split is:

- `EVAVO-STUDIO/evavo-local-storage` owns workstation recovery, persistent Windows automation and worker-fabric reachability.
- `EVAVO-STUDIO/evavo-agent-infrastructure` owns MCP/operator authority and cloud-to-local routing surfaces.
- `EVAVO-STUDIO/evavo-local-compute` owns structured, hash-bound local script/job execution.
- `EVAVO-STUDIO/evavo-development-studio` consumes those surfaces for governed engineering work.

The zero-cost recovery architecture includes independent HKCU logon recovery, the physically accepted REST Executor v5 loopback, repository-independent Scheduled Tasks, and the GitHub Issues worker fabric. GitHub Actions and paid hosted compute are not routine execution authority.

## Remote MCP relay

`packages/remote-mcp-relay` provides the Cloudflare-hosted bridge for supported remote MCP clients. It uses Streamable HTTP at `/mcp` and a Durable Object hibernating WebSocket accepted from the Windows workstation.

The remote MCP surface is deliberately read-only (`workstation_status`, `workstation_capabilities`) so it remains useful with current ChatGPT Pro custom-MCP permissions. Effectful dispatch is a separate bearer-authenticated API and is never disguised as a read MCP tool.

The workstation connects outbound only. REST Executor v5, Local Agent and local structured executors remain bound to the workstation rather than being exposed through an internet-facing shell.

See `packages/remote-mcp-relay/README.md` for deployment, secrets and security boundaries.

## Usage

### As CLI Tool

```bash
evavo git:commit --message "fix: types"
evavo git:push --verify
evavo git:status

evavo quality:check --repo super-admin-ai-agent
evavo quality:type-check --all
evavo quality:lint --fix

evavo test:run --repo evavo-site-foundation
evavo test:coverage --threshold 70

evavo build:verify --all
evavo build:deploy-vercel --repo my-site

evavo package:analyze --repo super-admin-ai-agent
evavo package:upgrade-check --all

evavo multi:status --all
evavo multi:commit-all --message "chore: upgrade deps"
```

### As MCP Tools

Available tools include Git, quality, testing, build, visual testing, package management, review and multi-repo operations.

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
├── cli-tool/
├── docs/
└── examples/
```

## Key Features

✅ Automatic lock handling  
✅ MCP and CLI integration  
✅ Type-safe packages  
✅ Contract testing  
✅ Zero-cost workstation recovery  
✅ Outbound-only remote MCP relay design  

## Integration with EVAVO Repos

Use the CLI/MCP packages as development dependencies where appropriate. Local workstation execution should route through Agent Infrastructure + Local Compute, with Local Storage owning recovery.

## Roadmap

- [x] Design & audit
- [x] Local execution/recovery ownership contracts
- [x] Remote MCP relay source
- [ ] Physical relay deployment and workstation acceptance

## Contributing

Follow TypeScript strict mode, explicit safety/authority boundaries, test-driven development and comprehensive error handling.

## Status

**Development Status:** Active implementation and physical integration  
**Node Version Required:** >=20.0.0  
**Package Manager:** pnpm >=8.0.0

---

**EVAVO Agent Infrastructure - Enabling Autonomous Code Excellence**
