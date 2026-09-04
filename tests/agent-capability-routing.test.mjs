import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseStrictJson, readRoutingConfigFile, planCapabilityRoutes, validateCapabilityStatus, validateRoutingConfig } from '../scripts/agent-capability-routing-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'config', 'agent-capability-routing-v1.json');
const configDocument = readRoutingConfigFile(configPath);
const validatedRouting = validateRoutingConfig(configDocument);
const NOW = '2026-08-28T12:00:00.000Z';
const SOURCE_REVISION = 'a'.repeat(40);

function status({ client = 'chatgpt-pro', requestedCapabilities = ['repository.inspect'], evidence = [], capturedAt = NOW } = {}) { return { schemaVersion: 1, kind: 'evavo-agent-capability-status-v1', capturedAt, client, requestedCapabilities, evidence }; }
function evidence(strategyId, state, { observedAt = '2026-08-28T11:59:00.000Z', sourceRevision = SOURCE_REVISION, healthy = true, receiptId, detail } = {}) { return { strategyId, state, observedAt, sourceRevision, healthy, ...(receiptId === undefined ? {} : { receiptId }), ...(detail === undefined ? {} : { detail }) }; }
function plan(document, now = NOW) { return planCapabilityRoutes({ routing: validatedRouting, status: validateCapabilityStatus(document, validatedRouting), now }); }

test('canonical routing config validates and is zero-cost by contract', () => {
  assert.equal(validatedRouting.routeCount, 15);
  assert.equal(validatedRouting.strategyCount, 59);
  assert.match(validatedRouting.digestSha256, /^[0-9a-f]{64}$/u);
  assert.equal(configDocument.policy.allowGitHubActions, false);
  assert.equal(configDocument.policy.allowVercelAsExecutionAuthority, false);
  assert.equal(configDocument.policy.allowArbitraryShell, false);
  assert.equal(configDocument.policy.failureDomainScope, 'transport-ingress-only');
  for (const transport of Object.values(configDocument.transports)) {
    assert.equal(transport.routineCost, 'zero-cost');
    assert.equal(transport.structuredOnly, true);
    assert.equal(transport.arbitraryShell, false);
    assert.ok(Array.isArray(transport.sharedDependencies));
    if (transport.effects.some((effect) => effect !== 'read')) assert.equal(transport.executorRepository, 'EVAVO-STUDIO/evavo-local-compute');
  }
});

test('ChatGPT repository inspection selects fresh connected GitHub evidence first', () => {
  const result = plan(status({ evidence: [evidence('repository-inspect-connected-github', 'transport_online')] }));
  assert.equal(result.overallStatus, 'ready');
  assert.equal(result.decisions[0].selected.strategyId, 'repository-inspect-connected-github');
  assert.equal(result.authority.execution, false);
});

test('repository estate planning is routed as read-only Technology Advisor work', () => {
  const result = plan(status({ requestedCapabilities: ['repository.estate-plan'], evidence: [evidence('repository-estate-plan-typed-relay', 'transport_online')] }));
  assert.equal(result.decisions[0].selected.authority, 'technology-advisor');
  assert.equal(result.authority.execution, false);
});

test('repository estate work queue remains read-only planning authority', () => {
  const result = plan(status({ requestedCapabilities: ['repository.estate-work-queue'], evidence: [evidence('repository-estate-work-queue-typed-relay', 'transport_online')] }));
  assert.equal(result.decisions[0].selected.authority, 'technology-advisor');
  assert.equal(result.authority.execution, false);
});

test('repository portfolio review remains non-effectful Technology Advisor guidance', () => {
  const result = plan(status({ requestedCapabilities: ['repository.estate-portfolio-review'], evidence: [evidence('repository-estate-portfolio-review-typed-relay', 'transport_online')] }));
  assert.equal(result.decisions[0].selected.authority, 'technology-advisor');
  assert.equal(result.authority.execution, false);
});

test('repository overlap review remains non-effectful Technology Advisor guidance', () => {
  const result = plan(status({ requestedCapabilities: ['repository.estate-overlap-review'], evidence: [evidence('repository-estate-overlap-review-typed-relay', 'transport_online')] }));
  assert.equal(result.decisions[0].selected.strategyId, 'repository-estate-overlap-review-typed-relay');
  assert.equal(result.decisions[0].selected.authority, 'technology-advisor');
  assert.equal(result.authority.execution, false);
});

test('provider snapshot capture can start from connected GitHub and remains read-only', () => {
  const result = plan(status({ requestedCapabilities: ['repository.estate-provider-snapshot'], evidence: [evidence('repository-estate-provider-snapshot-connected-github', 'transport_online')] }));
  const decision = result.decisions[0];
  assert.equal(decision.status, 'ready');
  assert.equal(decision.selected.strategyId, 'repository-estate-provider-snapshot-connected-github');
  assert.equal(decision.selected.authority, 'technology-advisor');
  assert.equal(decision.claims.mayAttempt, true);
  assert.equal(result.authority.execution, false);
});

test('provider snapshot capture can fall back to the fixed local MCP collector without execution authority', () => {
  const result = plan(status({ client: 'claude-code', requestedCapabilities: ['repository.estate-provider-snapshot'], evidence: [evidence('repository-estate-provider-snapshot-local-mcp', 'transport_online')] }));
  const decision = result.decisions[0];
  assert.equal(decision.status, 'ready');
  assert.equal(decision.selected.strategyId, 'repository-estate-provider-snapshot-local-mcp');
  assert.equal(decision.selected.transport, 'local-specialist-mcp');
  assert.equal(decision.selected.authority, 'technology-advisor');
  assert.equal(result.authority.execution, false);
});

test('provider-only estate review can start from connected GitHub without workstation execution authority', () => {
  const result = plan(status({ requestedCapabilities: ['repository.estate-provider-review'], evidence: [evidence('repository-estate-provider-review-connected-github', 'transport_online')] }));
  const decision = result.decisions[0];
  assert.equal(decision.status, 'ready');
  assert.equal(decision.selected.strategyId, 'repository-estate-provider-review-connected-github');
  assert.equal(decision.selected.authority, 'technology-advisor');
  assert.equal(result.authority.execution, false);
});

test('ChatGPT effectful work can fall back to a configured issue queue without claiming execution', () => {
  const result = plan(status({ requestedCapabilities: ['host.execute'], evidence: [evidence('host-execute-issue-queue', 'configured')] }));
  assert.equal(result.decisions[0].status, 'ready');
  assert.equal(result.decisions[0].claims.mayClaimCompleted, false);
  assert.equal(result.decisions[0].claims.mayClaimPhysicallyVerified, false);
});

test('ChatGPT hardware control selects the accepted typed relay and stays receipt-bound', () => {
  const result = plan(status({ requestedCapabilities: ['workstation.hardware-control'], evidence: [evidence('workstation-hardware-control-typed-relay', 'accepted', { receiptId: 'hardware-acceptance:sha256:' + 'c'.repeat(64) })] }));
  assert.equal(result.decisions[0].selected.transport, 'cloudflare-typed-relay');
  assert.equal(result.decisions[0].claims.mayClaimCompleted, false);
});

test('completed and physical claims require a current correlated receipt', () => {
  const result = plan(status({ requestedCapabilities: ['device.android'], evidence: [evidence('device-android-typed-relay', 'physically_verified', { receiptId: 'android-receipt:sha256:' + 'b'.repeat(64) })] }));
  assert.equal(result.decisions[0].claims.mayClaimCompleted, true);
  assert.equal(result.decisions[0].claims.mayClaimPhysicallyVerified, true);
});

test('accepted or stronger evidence without a receipt fails closed', () => {
  assert.throws(() => validateCapabilityStatus(status({ requestedCapabilities: ['host.execute'], evidence: [evidence('host-execute-typed-relay', 'completed')] }), validatedRouting), /EVAVO_AGENT_STATUS_RECEIPT_REQUIRED/u);
});

test('stale evidence is visible but cannot select or prove a route', () => {
  const result = plan(status({ requestedCapabilities: ['host.execute'], evidence: [evidence('host-execute-issue-queue', 'configured', { observedAt: '2026-08-28T11:20:00.000Z' })] }));
  assert.equal(result.overallStatus, 'unproven');
  assert.equal(result.decisions[0].status, 'source-ready-runtime-unproven');
});

test('explicit unhealthy evidence blocks the capability rather than weakening the route', () => {
  const result = plan(status({ requestedCapabilities: ['host.execute'], evidence: [evidence('host-execute-typed-relay', 'transport_online', { healthy: false, detail: 'worker transport unavailable' })] }));
  assert.equal(result.overallStatus, 'blocked');
  assert.equal(result.decisions[0].reason, 'all-observed-routes-blocked');
});

test('unknown capabilities are denied with no inferred generic shell fallback', () => {
  const result = plan(status({ requestedCapabilities: ['host.raw-shell'], evidence: [] }));
  assert.equal(result.decisions[0].reason, 'unknown-capability');
  assert.equal(result.decisions[0].claims.mayAttempt, false);
});

test('effectful routes cannot split authority across repositories', () => {
  const tampered = structuredClone(configDocument);
  tampered.routes.find((route) => route.id === 'host-execute').strategies[1].authority = 'local-storage';
  assert.throws(() => validateRoutingConfig(tampered), /EVAVO_AGENT_ROUTING_EFFECT_AUTHORITY_SPLIT/u);
});

test('transport ingress diversity cannot be overstated', () => {
  const tampered = structuredClone(configDocument);
  tampered.routes.find((route) => route.id === 'host-execute').minimumIndependentIngressDomains = 5;
  assert.throws(() => validateRoutingConfig(tampered), /EVAVO_AGENT_ROUTING_FAILURE_DOMAIN_COUNT/u);
});

test('raw shell and paid hosted execution cannot be introduced through config', () => {
  const rawShell = structuredClone(configDocument);
  rawShell.transports['cloudflare-typed-relay'].arbitraryShell = true;
  assert.throws(() => validateRoutingConfig(rawShell), /EVAVO_AGENT_ROUTING_TRANSPORT_ARBITRARY_SHELL/u);
  const hosted = structuredClone(configDocument);
  hosted.transports['cloudflare-typed-relay'].failureDomain = 'github-actions';
  assert.throws(() => validateRoutingConfig(hosted), /EVAVO_AGENT_ROUTING_HOSTED_EXECUTION/u);
});

test('strict JSON rejects duplicate and prototype-polluting properties', () => {
  assert.throws(() => parseStrictJson('{"kind":"one","kind":"two"}'), /EVAVO_AGENT_ROUTING_JSON_DUPLICATE_KEY/u);
  assert.throws(() => parseStrictJson('{"__proto__":{}}'), /EVAVO_AGENT_ROUTING_JSON_PROHIBITED_KEY/u);
});

test('routing fragments are same-directory regular JSON files', () => {
  const directory = fs.mkdtempSync(path.join(root, '.routing-fragment-test-'));
  try {
    const unsafe = { schemaVersion: 1, kind: 'evavo-agent-capability-routing-v1', canonical: true, clients: ['chatgpt-pro'], truthStates: configDocument.truthStates, policy: configDocument.policy, fragments: { authorities: '../outside.json', transports: 'transports.json', routes: ['routes.json'] } };
    const unsafePath = path.join(directory, 'routing.json');
    fs.writeFileSync(unsafePath, JSON.stringify(unsafe));
    assert.throws(() => readRoutingConfigFile(unsafePath), /EVAVO_AGENT_ROUTING_FRAGMENT_NAME|EVAVO_AGENT_ROUTING_FRAGMENT_PATH/u);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('route planning is deterministic for identical config, status and clock', () => {
  const document = status({ requestedCapabilities: ['repository.inspect', 'host.execute'], evidence: [evidence('repository-inspect-connected-github', 'transport_online'), evidence('host-execute-issue-queue', 'configured')] });
  const first = plan(document);
  const second = plan(structuredClone(document));
  assert.deepEqual(first, second);
  assert.match(first.planDigestSha256, /^[0-9a-f]{64}$/u);
});
