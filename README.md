# EVAVO Agent Infrastructure

EVAVO Agent Infrastructure owns local agent/MCP authority, device-agent surfaces and cross-repository execution integration.

## Local workstation execution ownership

The canonical local execution and recovery split is:

- `EVAVO-STUDIO/evavo-local-storage` owns workstation recovery, persistent Windows automation and worker-fabric reachability.
- `EVAVO-STUDIO/evavo-agent-infrastructure` owns MCP/operator authority and cloud-to-local routing surfaces.
- `EVAVO-STUDIO/evavo-local-compute` owns structured, hash-bound local script/job execution.
- `EVAVO-STUDIO/evavo-development-studio` consumes those surfaces for governed engineering work.

The zero-cost recovery architecture includes independent HKCU logon recovery, the physically accepted REST Executor v5 loopback, repository-independent Scheduled Tasks, and the GitHub Issues worker fabric. GitHub Actions and paid hosted compute are not routine execution authority.

## Remote MCP relay

`packages/remote-mcp-relay` provides the hosted Cloudflare bridge for supported remote MCP clients. It uses a Streamable HTTP `/mcp` endpoint and a Durable Object hibernating WebSocket accepted from the Windows workstation.

The remote MCP surface is deliberately read-only (`workstation_status`, `workstation_capabilities`) so it is useful on current ChatGPT Pro custom-MCP permissions. Effectful local dispatch is a separate bearer-authenticated API and is never disguised as a read MCP tool.

See `packages/remote-mcp-relay/README.md` for deployment and security boundaries.
