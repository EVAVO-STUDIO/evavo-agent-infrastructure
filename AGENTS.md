# EVAVO Agent Infrastructure agent rules

This repository owns typed capability routing and control-path selection across EVAVO agents.

Load and preserve these canonical contracts:

- `config/agent-capability-routing-v1.json`
- `config/agent-capability-authorities-v1.json`
- `config/agent-capability-transports-v1.json`
- `config/control-path-policy-v1.json`
- `config/workstation-control-health-v1.json`

Core selection rule: use the least disruptive eligible route. Prefer typed APIs/connectors, Local Compute background execution, local MCP/service tools and isolated browser control before native desktop interaction. S3 HID and effectful Comet KVM target the real physical console and are fallbacks. OOB power/media is recovery-only.

ChatGPT, Claude, Codex and API agents may have different transports, but transport availability never changes capability ownership. An MCP server in source is not proof that a current client session has registered or negotiated it.

Health/self-heal must stay owner-scoped. Do not silently cross hardware profile, identity, firmware, credential, publication or approval boundaries while attempting recovery.

Do not introduce GitHub Actions or paid Vercel execution as required infrastructure. Do not invent arbitrary shell authority where a route contract is structured-only.
