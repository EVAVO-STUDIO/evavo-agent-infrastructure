# EVAVO Agent Infrastructure agent rules

This repository owns typed capability routing and control-path selection across EVAVO agents.

Load and preserve these canonical contracts:

- `config/agent-capability-routing-v1.json`
- `config/agent-capability-authorities-v1.json`
- `config/agent-capability-transports-v1.json`
- `config/agent-capability-routes-visual-v1.json`
- `config/control-path-policy-v1.json`
- `config/workstation-control-health-v1.json`
- `config/workstation-execution-fabric-client-v2.json`
- `config/provider-database-routing-v1.json`
- `config/database-provider-routing-v1.json`
- `config/cloud-database-provider-routing-current-v1.json`

Core selection rule: use the least disruptive eligible route. Prefer typed APIs/connectors, Local Compute background execution, local MCP/service tools and isolated browser control before native desktop interaction. S3 HID and effectful Comet KVM target the real physical console and are fallbacks. OOB power/media is recovery-only.

Desktop Commander is excluded entirely, including as a fallback. Do not discover, probe, start, repair, install or use it for EVAVO work. Older interoperability code, snapshots and instructions cannot authorize its use. Prefer only eligible native EVAVO routes.

## Canonical Windows execution

For normal process, CLI, Git, build, test, file and model-execution work, route through `EVAVO-STUDIO/evavo-local-compute`. The canonical workstation-fabric MCP ingress is `mcp-server/local-agent-mcp-v2.1.mjs`; it submits structured Local Compute requests, supports receipt-driven status inspection and rejects raw shell-shaped request objects. Python, PowerShell, Bash, CMD and Node have all been physically proven as SHA-bound child runtimes under the Python resident.

Before any effectful Windows submission, resolve the live physical-control admission contract at `EVAVO-STUDIO/the-brain:config/windows-physical-execution-admission-v1.json` and the current Local Compute status surface (`evavo-windows-physical-control-status` or `scripts/Get-EvavoWindowsPhysicalControlStatusCurrentV3.ps1`). Missing/stale resident state, stale watchdog state or an unhealthy queue cycle means that Local Compute route is unavailable; continue route discovery rather than declaring the MSI offline. Provider-native read-only work and source maintenance may continue independently.

Prefer structured argv tools. For legitimate commands not represented by a direct tool, use a reviewed SHA-bound script with explicit argv rather than opaque inline shell authority. After submission, inspect exit code, timeout, stdout, stderr, managed-source evidence and postconditions. A closed queue issue by itself is not success.

Corrected successors require new request IDs. Never blindly replay a job after a possible physical effect. Serialize effectful writers per mutation root, allow independent read-only work when the selected transport supports it, and refetch current repository state before retrying any stale write rejected by another agent.

Hand off foreground GUI interaction to `evavo-computer-agent`; BIOS/preboot/independent physical console work to `evavo-local-ai-agent-gateway`; effectful Comet KVM/power/media recovery to `evavo-out-of-band-control`; network reachability to `network-studio`; model governance to `evavo-model-lab`; publication to `evavo-development-studio`.

If no eligible native EVAVO route can complete the task, report the attempted route and missing evidence, then continue permitted native diagnostics or source work. Never substitute an external desktop-control product. Do not say `MSI is offline` or `workstation is offline` without independent machine-level evidence.

## Browser and desktop visual inspection

Browser pixel inspection is owned by `evavo-computer-agent`, not by Remote Desktop Commander. Resolve `browser.visual-inspect` before concluding that screenshot review is unavailable. For ChatGPT Pro, prefer the registered Computer Agent Visual Review read-only MCP when healthy, then the typed relay; local agents prefer native Computer Agent Playwright first. Structured Workstation Bridge and durable local execution are additional native routes for clients that support them.

When the native browser visual runtime needs effectful repair or startup, request the separate `browser.visual-bootstrap` capability. That bootstrap is owned by Local Compute and may use structured Workstation Bridge, durable local execution, typed relay or the GitHub issue queue. Do not place an effectful bootstrap transport inside the read-only visual-inspection route and do not treat queue acceptance as screenshot proof.

A direct pixel-inspection claim requires the actual admitted PNG bytes or a retained provider path that returns those bytes, screenshot SHA-256, byte length and a fresh source-bound capture/evidence receipt. Semantic DOM, accessibility and hit-test evidence supplement pixels; they do not replace pixels when the task asks for visual or pixel-level review.

Do not say `I cannot inspect the browser screenshot because the MSI connector is unavailable`, `I have not had pixel-by-pixel inspection because the MSI connector is unavailable`, or equivalent wording merely because one connector is down. Instead report the attempted route and continue native visual route discovery. If all admitted visual routes are unavailable, say that no admitted visual-inspection route is currently reachable; that does not establish that the MSI, browser or Computer Agent itself is offline.

Desktop Commander is prohibited for visual inspection as well as execution and recovery. It does not become eligible after native routes fail.

## Database and provider routing

Resolve database work through `config/provider-database-routing-v1.json` and current cloud/provider state through `config/cloud-database-provider-routing-current-v1.json` before executing anything. Prefer provider-native Supabase/Firebase/Neon authorities for production data when their observed state is green. Use the proven Local Compute PostgreSQL 17 and MongoDB 8 Docker sandboxes for schema/query/integration experiments before production. MongoDB production access is not implied by the local MongoDB sandbox or installed mongosh; an external provider/cluster identity must be proven first. SQLite uses Python stdlib locally; Redis/MySQL/MariaDB and DuckDB are on-demand sandbox/runtime capabilities rather than permanent Windows services.

Provider installation is not provider authentication. Cloudflare Wrangler and Vercel CLI write paths remain unavailable until their own live identity checks succeed. Never copy connection strings, access tokens, service-account private keys or database passwords into Git, prompts, receipts or generated sandboxes.

ChatGPT, Claude, Codex and API agents may have different transports, but transport availability never changes capability ownership. An MCP server in source is not proof that a current client session has registered or negotiated it.

Health/self-heal must stay owner-scoped. Do not silently cross hardware profile, identity, firmware, credential, publication or approval boundaries while attempting recovery.

Do not introduce GitHub Actions or paid Vercel execution as required infrastructure. Do not invent arbitrary shell authority where a route contract is structured-only.
