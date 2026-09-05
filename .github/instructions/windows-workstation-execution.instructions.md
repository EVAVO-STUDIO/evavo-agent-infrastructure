---
applyTo: "**"
---

# Windows workstation execution

`EVAVO-STUDIO/evavo-local-compute` is the only canonical physical Windows executor for process, CLI, PowerShell, Python, Bash, CMD, Node, Git, build, test, file and model-execution work.

Active MCP registrations are `evavo-windows-workstation-bridge` and `evavo-windows-workstation-operator`. Both must launch the same Local Compute executable. The standard profile is network-disabled; the reviewed operator profile grants explicit network, Git, archive and transfer effects.

Foreground browser/Windows UI interaction belongs to `evavo-computer-agent`. Gateway/S3 control belongs to `evavo-local-ai-agent-gateway`. Admitted Comet/OOB recovery belongs to `evavo-out-of-band-control`. Workstation truth/admission belongs to `evavo-workstation-manager`.

Remote Desktop Commander is external fallback interoperability only. Do not choose it while the native EVAVO authority that owns the requested operation is eligible. Do not make MSI availability, machine health or local verification depend on Desktop Commander presence. `no devices available` proves only that the Desktop Commander fallback is unreachable from the current agent.

Do not register or revive `evavo-windows-chat-execution`, `windows-chat-execution-mcp.mjs`, a localhost REST executor, a public raw shell, a second issue queue, a GitHub Actions worker or a Vercel relay. The old Node compatibility server may remain in source only as an unregistered read-only migration shim.

For hosted chat without effectful MCP, use the structured SHA-bound Local Compute GitHub Issues pull queue before external remote-control fallback. Secure MCP Tunnel is optional.

Do not treat issue closure, source presence, process presence, path configuration, Desktop Commander presence or a stale receipt as success. Require a completed physical receipt with zero exit code, no timeout, physical execution provenance and the accepted executing Git head.

A failed transport describes that transport only. Continue capability-route discovery before declaring local execution unavailable, and require separate machine-level evidence before using language such as `MSI is offline`.
