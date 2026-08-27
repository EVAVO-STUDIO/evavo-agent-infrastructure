# Windows Workstation Operator client contract

Agent Infrastructure does not own a Windows shell. It discovers and registers clients against the single physical executor owned by `evavo-local-compute`.

## Routing

| Client context | Route |
|---|---|
| Codex on the Windows machine | MCP stdio launcher |
| Claude Desktop or Claude Code on the Windows machine | MCP stdio launcher |
| Hosted chat without effectful custom MCP | GitHub Issues pull queue |
| Hosted client with supported private MCP | Optional Secure MCP Tunnel |

The tunnel is an enhancement, not a readiness dependency. GitHub Actions and Vercel are not execution planes for this contract.

## Security boundary

Clients receive typed tools for filesystem, download, Git, script-file, BeeStation, health, and registration operations. They do not receive a public raw shell or arbitrary inline PowerShell, Bash, or Python. Repository scripts are exact-byte bound, physical paths are represented by logical roots, credentials remain in the current Windows user context, and receipts are compact and sanitized.

The retired raw chat shell must remain retired. Compatibility adapters may translate legacy tool names only when they route to the canonical Workstation Operator without restoring arbitrary command text.

## Canonical sources

- Operator CLI: `evavo-local-compute/scripts/windows-workstation-operator.py`
- Local MCP server: `evavo-local-compute/scripts/windows-workstation-operator-mcp.py`
- Hosted fallback adapter: `evavo-local-compute/automation/remote-jobs/run-windows-workstation-operator-v1.py`
- Machine-readable client policy: `config/windows-workstation-operator-client-v1.json`
