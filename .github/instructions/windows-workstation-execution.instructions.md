---
applyTo: "**"
---

# Windows workstation execution

`EVAVO-STUDIO/evavo-local-compute` is the only canonical physical Windows executor for process, CLI, PowerShell, Python, Bash, CMD, Node, Git, build, test, file and model-execution work.

Active MCP registrations are `evavo-windows-workstation-bridge` and `evavo-windows-workstation-operator`. Both must launch the same Local Compute executable. The standard profile is network-disabled; the reviewed operator profile grants explicit network, Git, archive and transfer effects.

Foreground browser/Windows UI interaction belongs to `evavo-computer-agent`. Gateway/S3 control belongs to `evavo-local-ai-agent-gateway`. Admitted Comet/OOB recovery belongs to `evavo-out-of-band-control`. Workstation truth/admission belongs to `evavo-workstation-manager`.

Desktop Commander is excluded entirely, including as a fallback. Do not discover, probe, start, repair, install or use it for EVAVO work. Preserve native authority and focus-safety gates when a route is unavailable; never substitute an external desktop-control product.

Do not register or revive `evavo-windows-chat-execution`, `windows-chat-execution-mcp.mjs`, a localhost REST executor, a public raw shell, a second issue queue, a GitHub Actions worker or a Vercel relay. The old Node compatibility server may remain in source only as an unregistered read-only migration shim.

For hosted chat without effectful MCP, prefer the authenticated EVAVO typed relay when actually registered and eligible, then the structured SHA-bound Local Compute GitHub Issues pull queue. Neither source configuration nor queue acceptance proves a live workstation connection. Secure MCP Tunnel remains read-only unless separately proven otherwise.

Do not treat issue closure, source presence, process presence, path configuration, Desktop Commander presence or a stale receipt as success. Require a completed physical receipt with zero exit code, no timeout, physical execution provenance and the accepted executing Git head.

A failed transport describes that transport only. Continue capability-route discovery before declaring local execution unavailable, and require separate machine-level evidence before using language such as `MSI is offline`.
