# EVAVO AI Agent Gateway

## Decision

EVAVO does not add a generic command-string web endpoint, expose a workstation shell through ngrok or LocalTunnel, or make Aider/Open Interpreter the control plane.

EVAVO already has the stronger architecture:

```text
Local MCP client
  -> typed specialist tool or Workstation Bridge
  -> structured request and policy evaluation
  -> reviewed script/tool/repository operation
  -> exact source/runtime identity
  -> current-user local execution
  -> bounded correlated receipt

Remote client
  -> read-only remote MCP status
  -> separately authenticated fixed dispatch action, when authorised
  -> outbound workstation relay
  -> independent local admission
  -> correlated receipt

No direct effectful connector
  -> author-restricted GitHub issue queue
  -> SHA-bound structured request
  -> current-user queue worker
  -> replay-protected journal and issue receipt
```

## What “can do whatever” means

It means the gateway can express all normal EVAVO engineering and operations work through composable capabilities:

- PowerShell, Python, Bash, and Node scripts stored in admitted roots;
- Git, curl, rclone, containers, archives, repository, and filesystem operations;
- builds, tests, deployments, browser and visual QA;
- Android, Glasses, Godot, and other specialist physical-device workflows;
- storage estate, Downloads, EVAVO Storage, and BeeStation operations; and
- durable multi-step and cross-repository jobs.

It does not mean every model receives an unrestricted shell, permanent credentials, arbitrary elevation, destructive Git history authority, or an unauthenticated internet endpoint. Those would reduce reliability as well as security.

## Client routing

### Claude Code

Claude Code and compatible desktop clients can launch local stdio MCP servers from project configuration. Register the real `evavo-windows-workstation-bridge` from `evavo-local-compute`. Keep client approval and command permission controls enabled. Use specialist MCP tools before general execution.

### ChatGPT Pro

Current ChatGPT Pro custom MCP access is read/fetch only, and cloud ChatGPT cannot directly reach a workstation localhost server. The supported EVAVO routes are:

1. read-only Cloudflare MCP for workstation status, advertised capabilities, and coarse request state;
2. OpenAI Secure MCP Tunnel where the product surface supports that local connection;
3. separately authenticated fixed relay dispatch for trusted operators; or
4. the zero-cost GitHub issue queue.

Do not mislabel the read-only MCP relay as an executor. Do not return detailed local results through its public request-status tool.

### API agents

API agents may call the authenticated typed relay API when they hold the dedicated dispatch credential. That credential is separate from the workstation WebSocket credential. The relay still admits only fixed action identifiers; the workstation applies an independent local allowlist.

### Aider and Open Interpreter

They are optional local user interfaces, not EVAVO authority roots. They may operate inside a repository when a human deliberately launches them, but they must use the same Git policy, admitted roots, secrets boundary, and review expectations. No repo or recovery system may depend on either tool being installed.

## Security invariants

1. **No public raw shell.** No `/run` route accepts caller-supplied PowerShell, Bash, Python, CMD, executable names, or inline code.
2. **Outbound workstation transport.** The workstation opens the relay connection; no inbound router or firewall rule is required.
3. **Separate credentials.** Workstation connection and effectful dispatch use different high-entropy secrets.
4. **No secret inheritance.** Chat/tunnel credentials are removed before child execution code is imported or spawned.
5. **Structured requests.** Runtime, operation, working directory, arguments, and reviewed script path are separate fields.
6. **SHA binding.** Script execution verifies the exact reviewed file digest before effects.
7. **Root containment.** Paths resolve beneath configured EVAVO, Downloads, LocalAppData, or admitted BeeStation roots.
8. **Independent policy layers.** Relay admission never substitutes for local policy admission.
9. **Current-user least privilege.** Persistent tasks run Limited in the intended interactive user context; no default SYSTEM or elevation path.
10. **Bounded evidence.** Output size, history, timeouts, concurrency, and logs are bounded and redacted.
11. **Safe Git defaults.** Destructive history rewriting, forced reset/clean, and secret-bearing remote changes are denied unless a narrower reviewed workflow explicitly owns them.
12. **No success by configuration.** Source, deployment, task existence, or queue acceptance is not physical completion.

## Why the Flask/ngrok example is rejected

Changing the process working directory is not a security boundary. A shell command can still:

- use absolute paths or environment variables;
- read browser, Git, SSH, cloud, or application credentials;
- launch child processes outside the selected directory;
- upload data over the network;
- create persistence or scheduled tasks;
- alter Git history or repositories elsewhere; and
- damage the machine through inherited user authority.

The sample also lacks authentication, replay protection, request signing, action admission, timeouts, output limits, cancellation, concurrency control, audit identity, secret redaction, and a physical receipt contract. Exposing it through a public tunnel would turn those omissions into a remote compromise path.

## Cross-repository registration contract

A repository that needs workstation effects should register one canonical structured bridge, not multiple overlapping executors:

```json
{
  "mcpServers": {
    "evavo-windows-workstation-bridge": {
      "command": "python",
      "args": [
        "C:\\GitRepos\\evavo-local-compute\\src\\evavo_local_compute\\windows_workstation_bridge_entrypoint.py"
      ]
    }
  }
}
```

Environment policy flags and allowed roots must be set by the owning repository contract. The retired `windows-chat-execution-mcp.mjs` may be registered only under the explicit name `evavo-windows-execution-migration-guide`; it is fail-closed and provides routing guidance only.

## Capability discovery

Agents must inspect capability/status tools rather than assume a runtime is present. A truthful response distinguishes:

- `source_ready` — the expected repository files and contracts exist;
- `configured` — client registration, policy, and credentials are present;
- `transport_online` — the current relay/worker connection is live;
- `accepted` — the request passed transport and policy admission;
- `completed` — a correlated receipt reports terminal success or failure; and
- `physically_verified` — the exact expected effect was observed on the target workstation/device/storage surface.

Only the last two states support claims that work actually ran.

## Operational fallback order

1. specialist MCP;
2. local structured Workstation Bridge;
3. durable Local Execution;
4. authenticated fixed remote relay action;
5. SHA-bound GitHub issue queue;
6. explicit human intervention only when a required external product permission cannot be granted programmatically.

Fallback never means weakening the security model. It changes transport while preserving structured requests, source identity, policy, and receipts.
