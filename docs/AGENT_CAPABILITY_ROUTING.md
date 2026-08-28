# Agent capability routing

EVAVO agents need broad reach without turning every client or transport into a second control plane. The canonical routing contract is `config/agent-capability-routing-v1.json`. Its same-directory JSON fragments separate authorities, transports and route groups without weakening one merged validated contract.

It gives ChatGPT, Claude Code, Codex and trusted API agents one machine-readable answer to four separate questions:

1. Which repository owns the requested capability and effect?
2. Which transport paths are valid for this client?
3. What fresh evidence is required before a path may be attempted?
4. Which receipt state is required before anyone may claim that work completed or was physically verified?

The router does not execute, mutate, publish, deploy, read credentials or create a generic shell. It validates declarations and produces a deterministic route plan.

## Canonical authority boundaries

The route table preserves the existing owners instead of duplicating them:

- `evavo-github-mcp` owns read-only GitHub inventory and evidence.
- `evavo-development-studio` owns governed repository mutation, validation and sealed publication.
- `evavo-local-compute` owns structured and durable workstation execution.
- `evavo-local-storage` owns workstation continuity and storage effects.
- `automated-testing` owns browser and technical QA campaigns.
- `evavo-computer-agent` owns signed computer-interaction journeys.
- `evavo-agent-infrastructure` owns chat-facing routing and specialist device MCP tools.
- `the-brain` owns bounded attributable context retrieval.

Effectful fallbacks may change transport, but they cannot silently change authority owner, request schema, source revision, policy, approval or receipt requirements. Domain authority and physical execution are separate: every effectful transport declares `EVAVO-STUDIO/evavo-local-compute` as its executor, so storage, testing, device and computer specialists cannot become parallel Windows executors.

## Truth states

Every status observation uses the same ordered states:

```text
source_ready
  -> configured
  -> transport_online
  -> accepted
  -> completed
  -> physically_verified
```

A repository file or tool declaration proves only `source_ready`. A queue issue can be valid and `configured` while the workstation worker is offline. A relay connection can be online while a request has never been accepted. Only a correlated receipt can support `accepted`, `completed` or `physically_verified`.

Evidence is bound to a strategy ID, exact 40-character source revision, canonical UTC observation time and health state. Accepted or stronger evidence must contain a receipt ID. Stale or future-dated evidence fails closed.

## Multiple paths without false redundancy

The contract declares local MCP, Workstation Bridge, durable local execution, OpenAI Secure MCP Tunnel, authenticated Cloudflare typed relay and GitHub issue queue paths where they are appropriate.

`failureDomain` describes transport ingress only. `sharedDependencies` exposes dependencies that remain common across routes. `executorRepository` identifies the one physical executor for effectful paths. For example, the Cloudflare relay and GitHub issue queue are independent ingress paths, but both still require the Windows workstation and an accepted local worker before physical effects can complete. The route plan never describes those as independent computers.

Routine routing forbids GitHub Actions, Vercel build minutes, arbitrary shell endpoints and paid hosted-agent dependence.

## Validate the canonical contract

```bash
pnpm check:capability-routing
pnpm test:capability-routing
```

The checker verifies exact schemas, authority ownership, effect compatibility, client compatibility, ingress diversity, zero-cost policy, receipt requirements, truth-state ordering and the absence of raw-shell or hosted-execution backdoors.

## Produce a route plan

Create a bounded status document:

```json
{
  "schemaVersion": 1,
  "kind": "evavo-agent-capability-status-v1",
  "capturedAt": "2026-08-28T12:00:00.000Z",
  "client": "chatgpt-pro",
  "requestedCapabilities": ["repository.inspect", "host.execute"],
  "evidence": [
    {
      "strategyId": "repository-inspect-connected-github",
      "state": "transport_online",
      "observedAt": "2026-08-28T11:59:30.000Z",
      "sourceRevision": "0123456789abcdef0123456789abcdef01234567",
      "healthy": true
    },
    {
      "strategyId": "host-execute-issue-queue",
      "state": "configured",
      "observedAt": "2026-08-28T11:59:00.000Z",
      "sourceRevision": "89abcdef0123456789abcdef0123456789abcdef",
      "healthy": true
    }
  ]
}
```

Then run:

```bash
node scripts/plan-agent-capability-route.mjs --status status.json
```

The planner chooses the first fresh eligible route in declared order. A configured issue queue may be selected as a way to attempt work, but the output keeps `mayClaimCompleted` and `mayClaimPhysicallyVerified` false until a current correlated receipt is supplied.

The resulting plan is content-addressed and carries an all-false authority block. It is evidence for a caller or governed orchestrator, not an execution token.

## Adding capability coverage

Extend the existing owner whenever possible. Add a route only when all of the following are explicit:

- one stable capability ID and requested effect;
- the canonical repository authority;
- at least one typed transport supported by each intended client;
- a fresh readiness probe and maximum evidence age;
- the exact completion and physical-verification boundary;
- shared dependencies and transport ingress domains; and
- tests proving no authority split, raw shell, receipt downgrade or hosted-quota dependency was introduced.

New routes must compose source-owned tasks and tools. They must not copy implementation logic into the router.
