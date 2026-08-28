# Signed GitHub estate routing MCP

`mcp-server/github-estate-routing-mcp.mjs` exposes the signed repository-estate verification and route-planning pipeline to compatible MCP clients without exposing local paths, arbitrary commands, provider mutation, repository writes, publication, or credentials.

The server is dependency-free at runtime and wraps the canonical verifier and planner already owned by `scripts/route-github-estate-snapshot.mjs`.

## Tools

The server exposes exactly three tools:

- `evavo_github_estate_routing_readiness` checks whether the fixed snapshot root, trust bundle, route CLI, and routing configuration are present as regular non-symlink objects. It does not verify a snapshot and never claims the evidence is valid.
- `evavo_github_estate_routing_status` verifies the newest signed snapshot and returns an `evavo-agent-capability-status-v1` document for one supported client.
- `evavo_github_estate_routing_plan` verifies the newest signed snapshot and returns an `evavo-agent-capability-route-plan-v1` document whose authority block must remain entirely false.

Supported clients are:

```text
chatgpt-pro
claude-code
codex
api-agent
```

Callers may provide only a client identifier and an optional canonical UTC timestamp. They cannot provide a path, file, executable, shell command, endpoint, repository, Git ref, provider operation, or credential.

## Configuration

The operator supplies fixed absolute paths through the MCP server environment:

```text
EVAVO_GITHUB_ESTATE_SNAPSHOT_ROOT
EVAVO_GITHUB_ESTATE_TRUST_BUNDLE
```

Optional overrides are:

```text
EVAVO_GITHUB_ESTATE_ROUTING_CONFIG
EVAVO_GITHUB_ESTATE_ROUTING_CLI
EVAVO_GITHUB_ESTATE_ROUTING_TIMEOUT_MS
```

The routing CLI and configuration default to the canonical files in this repository. Environment-supplied paths must be absolute. Snapshot, trust, CLI, and configuration objects are rejected when missing, empty, the wrong type, or symbolic links.

Use `config/mcp.github-estate-routing.example.json` as a template and replace every `YOUR_USER` placeholder with an actual absolute path before registration.

## Truth boundary

A `configured` readiness result proves only that the required fixed local objects are present. It deliberately returns:

```json
{
  "runtimeVerificationPerformed": false,
  "mayClaimEvidenceValid": false
}
```

Only the status or plan tool performs cryptographic snapshot verification. Those tools delegate to the existing canonical route CLI with an exact argument vector and `shell: false`.

The child process receives a minimal environment. GitHub tokens, provider credentials, `NODE_OPTIONS`, arbitrary EVAVO variables, and other caller-process secrets are not forwarded.

## Output boundary

The MCP server returns capability status and route-plan documents only after validating their exact top-level schemas, client identity, canonical timestamps, and all-false route-plan authority.

It rejects:

- local path fields in child output;
- configured paths embedded inside otherwise allowed string fields;
- duplicate JSON keys;
- prototype-polluting keys;
- oversized messages or child output;
- invalid or unknown tools and clients;
- stderr on an otherwise successful child process; and
- timeout or non-zero child termination.

Child stderr is represented only by its byte count and SHA-256 digest. Raw stderr and configured paths never enter MCP error responses.

## Validation

Run the focused contract suite:

```bash
node --test tests/github-estate-routing-mcp.test.mjs
```

The `@evavo/agent-mcp` workspace test command also runs this suite and includes a syntax check for the runtime server.

Repository source and passing tests prove the implementation contract. They do not prove that a current workstation has a valid snapshot, trust bundle, or accepted worker. Use the readiness, status, and plan tools to obtain current evidence.
