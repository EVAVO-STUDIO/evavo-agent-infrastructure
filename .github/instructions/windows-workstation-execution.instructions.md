---
applyTo: "**"
---

# Windows workstation execution

`EVAVO-STUDIO/evavo-local-compute` is the only physical Windows executor.

Active MCP registrations are `evavo-windows-workstation-bridge` and `evavo-windows-workstation-operator`. Both must launch the same Local Compute executable. The standard profile is network-disabled; the reviewed operator profile grants explicit network, Git, archive and transfer effects.

Do not register or revive `evavo-windows-chat-execution`, `windows-chat-execution-mcp.mjs`, a localhost REST executor, a public raw shell, a second issue queue, a GitHub Actions worker or a Vercel relay. The old Node compatibility server may remain in source only as an unregistered read-only migration shim.

For hosted chat without effectful MCP, use the structured SHA-bound Local Compute GitHub Issues pull queue. Secure MCP Tunnel is optional.

Do not treat issue closure, source presence, process presence, path configuration or a stale receipt as success. Require a completed physical receipt with zero exit code, no timeout, physical execution provenance and the accepted executing Git head.
