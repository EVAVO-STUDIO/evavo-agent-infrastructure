# EVAVO Agent Infrastructure agent rules

This repository owns typed capability routing and control-path selection across EVAVO agents.

Load and preserve these canonical contracts:

- `config/agent-capability-routing-v1.json`
- `config/agent-capability-authorities-v1.json`
- `config/agent-capability-transports-v1.json`
- `config/control-path-policy-v1.json`
- `config/workstation-control-health-v1.json`
- `config/workstation-execution-fabric-client-v2.json`

Core selection rule: use the least disruptive eligible route. Prefer typed APIs/connectors, Local Compute background execution, local MCP/service tools and isolated browser control before native desktop interaction. S3 HID and effectful Comet KVM target the real physical console and are fallbacks. OOB power/media is recovery-only.

## Canonical Windows execution

For normal process, CLI, Git, build, test, file and model-execution work, route through `EVAVO-STUDIO/evavo-local-compute`. The canonical MCP ingress is `mcp-server/local-agent-mcp-v2.mjs`; it submits structured Local Compute requests and waits for the authoritative terminal receipt. Python, PowerShell, Bash, CMD and Node have all been physically proven as SHA-bound child runtimes under the Python resident.

Prefer structured argv tools. For legitimate commands not represented by a direct tool, use a reviewed SHA-bound script with explicit argv rather than opaque inline shell authority. After submission, inspect exit code, timeout, stdout, stderr, managed-source evidence and postconditions. A closed queue issue by itself is not success.

Corrected successors require new request IDs. Never blindly replay a job after a possible physical effect. Serialize effectful writers per mutation root, allow independent read-only work when the selected transport supports it, and refetch current repository state before retrying any stale write rejected by another agent.

Hand off foreground GUI interaction to `evavo-computer-agent`; BIOS/preboot/independent physical console work to `evavo-local-ai-agent-gateway`; effectful Comet KVM/power/media recovery to `evavo-out-of-band-control`; network reachability to `network-studio`; model governance to `evavo-model-lab`; publication to `evavo-development-studio`.

ChatGPT, Claude, Codex and API agents may have different transports, but transport availability never changes capability ownership. An MCP server in source is not proof that a current client session has registered or negotiated it.

Health/self-heal must stay owner-scoped. Do not silently cross hardware profile, identity, firmware, credential, publication or approval boundaries while attempting recovery.

Do not introduce GitHub Actions or paid Vercel execution as required infrastructure. Do not invent arbitrary shell authority where a route contract is structured-only.
