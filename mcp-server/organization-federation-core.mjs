import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(ROOT, 'config');
const STATE_ORDER = ['unknown', 'source_ready', 'configured', 'transport_online', 'accepted', 'completed', 'physically_verified'];
const EFFECTS = new Set(['read', 'write', 'execute', 'control', 'publish']);

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(CONFIG, name), 'utf8'));
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const rank = (state) => Math.max(0, STATE_ORDER.indexOf(state));
const normalize = (value) => String(value ?? '').trim().toLowerCase();

function loadRouteBundle() {
  const root = readJson('agent-capability-routing-v1.json');
  const routes = [];
  for (const fragment of root?.fragments?.routes ?? []) {
    const parsed = readJson(fragment);
    if (!Array.isArray(parsed)) throw new Error(`Route fragment must be an array: ${fragment}`);
    for (const route of parsed) routes.push({ ...route, sourceFragment: fragment });
  }
  return { root, routes };
}

function parseObservedAt(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function evidenceFresh(record, freshnessSeconds, nowMs) {
  if (!object(record) || record.healthy === false) return false;
  const observedAt = parseObservedAt(record.observedAt);
  return observedAt != null && nowMs - observedAt <= freshnessSeconds * 1000;
}

function planTeam(args = {}) {
  const graph = readJson('specialist-handoff-graph-v1.json');
  const owners = readJson('specialist-domain-owners-v1.json')?.owners ?? {};
  const patternId = typeof args.patternId === 'string' && args.patternId.trim() ? args.patternId.trim() : null;
  const domains = Array.isArray(args.domains) ? [...new Set(args.domains.map(normalize).filter(Boolean))] : [];
  if (!patternId && domains.length === 0) throw new Error('patternId or at least one domain is required');

  let selected;
  let ranking = [];
  if (patternId) {
    selected = (graph.patterns ?? []).find((pattern) => pattern.id === patternId);
    if (!selected) throw new Error(`Unknown specialist handoff pattern: ${patternId}`);
  } else {
    ranking = (graph.patterns ?? []).map((pattern) => {
      const patternDomains = new Set();
      for (const step of pattern.sequence ?? []) {
        for (const domain of owners[step.specialist]?.domains ?? []) patternDomains.add(normalize(domain));
      }
      const matchedDomains = domains.filter((domain) => patternDomains.has(domain));
      return { patternId: pattern.id, goal: pattern.goal, score: matchedDomains.length, matchedDomains };
    }).sort((a, b) => b.score - a.score || a.patternId.localeCompare(b.patternId));
    selected = (graph.patterns ?? []).find((pattern) => pattern.id === ranking[0]?.patternId);
  }
  if (!selected) throw new Error('No specialist team pattern could be selected');

  const team = (selected.sequence ?? []).map((step, index) => {
    const owner = owners[step.specialist] ?? null;
    return {
      order: index + 1,
      specialistId: step.specialist,
      repository: owner?.repository ?? null,
      domains: owner?.domains ?? [],
      ownerStatus: owner?.status ?? 'declared',
      sourceResolved: owner?.status !== 'source-unresolved',
      role: step.role
    };
  });
  const unresolved = team.filter((member) => !member.repository || member.sourceResolved === false);
  return {
    schemaVersion: 1,
    kind: 'evavo-specialist-team-plan-v1',
    selectedPattern: selected.id,
    goal: selected.goal,
    knownBoundary: selected.knownBoundary ?? null,
    blockedUntil: selected.blockedUntil ?? null,
    requestedDomains: domains,
    ranking,
    team,
    unresolved,
    handoffRequired: team.length > 1,
    executionAuthorized: false,
    nextStep: unresolved.length
      ? 'Resolve unresolved specialist source/ownership evidence before effectful handoff.'
      : 'Resolve capability-specific authority and current route readiness for every effectful team step.'
  };
}

function planRouteReadiness(args = {}) {
  const capability = typeof args.capability === 'string' ? args.capability.trim() : '';
  const client = typeof args.client === 'string' && args.client.trim() ? args.client.trim() : 'chatgpt-pro';
  const evidence = object(args.evidence) ? args.evidence : {};
  if (!capability) throw new Error('capability is required');

  const { root, routes } = loadRouteBundle();
  const authorities = readJson('agent-capability-authorities-v1.json');
  const transports = readJson('agent-capability-transports-v1.json');
  const route = routes.find((entry) => entry.capability === capability);
  if (!route) {
    return {
      schemaVersion: 1,
      kind: 'evavo-capability-route-readiness-plan-v1',
      capability,
      client,
      status: 'unknown-capability',
      selectedStrategy: null,
      candidates: [],
      executionAuthorized: false,
      nextAction: 'Use Brain live specialist discovery; do not invent an effectful route or substitute arbitrary shell.'
    };
  }

  const nowMs = Number.isFinite(args.nowMs) ? args.nowMs : Date.now();
  const requestedEffect = route.requestedEffect ?? 'read';
  const candidates = [];
  for (let order = 0; order < (route.strategies ?? []).length; order += 1) {
    const strategy = route.strategies[order];
    if (!Array.isArray(strategy.clients) || !strategy.clients.includes(client)) continue;
    const authority = authorities[strategy.authority] ?? null;
    const transport = transports[strategy.transport] ?? null;
    const routeEvidence = evidence?.strategies?.[strategy.id] ?? null;
    const transportEvidence = evidence?.transports?.[strategy.transport] ?? null;
    const authorityEvidence = evidence?.authorities?.[strategy.authority] ?? null;
    const observedState = routeEvidence?.state ?? transportEvidence?.state ?? 'unknown';
    const minimumState = strategy.minimumState ?? transport?.minimumState ?? 'transport_online';
    const freshnessSeconds = Number(transport?.freshnessSeconds ?? 0);
    const fresh = freshnessSeconds > 0 && evidenceFresh(routeEvidence ?? transportEvidence, freshnessSeconds, nowMs);
    const blockers = [];
    if (!authority) blockers.push('unknown-authority');
    if (!transport) blockers.push('unknown-transport');
    if (authority && (!Array.isArray(authority.effects) || !authority.effects.includes(requestedEffect))) blockers.push('authority-does-not-own-requested-effect');
    if (transport && (!Array.isArray(transport.effects) || !transport.effects.includes(requestedEffect))) blockers.push('transport-does-not-support-requested-effect');
    if (transport && (!Array.isArray(transport.clients) || !transport.clients.includes(client))) blockers.push('transport-does-not-support-client');
    if (authority && /unresolved|not eligible|restore|planned canonical/i.test(authority.description ?? '')) blockers.push('authority-unresolved');
    if (!fresh) blockers.push('missing-or-stale-readiness-evidence');
    if (rank(observedState) < rank(minimumState)) blockers.push(`minimum-state-not-met:${minimumState}`);
    if (authorityEvidence?.eligible === false) blockers.push('authority-currently-ineligible');
    candidates.push({
      declaredOrder: order,
      strategyId: strategy.id,
      authorityId: strategy.authority,
      authorityRepository: authority?.repository ?? null,
      transportId: strategy.transport,
      requestedEffect,
      minimumState,
      observedState,
      evidenceFresh: fresh,
      freshnessSeconds,
      receiptRequired: transport?.receiptRequired === true,
      physicalReceiptCapable: transport?.physicalReceiptCapable === true,
      routineCost: transport?.routineCost ?? null,
      probe: transport?.probe ?? null,
      eligible: blockers.length === 0,
      blockers
    });
  }
  const selectedStrategy = candidates.find((candidate) => candidate.eligible) ?? null;
  return {
    schemaVersion: 1,
    kind: 'evavo-capability-route-readiness-plan-v1',
    generatedAt: new Date(nowMs).toISOString(),
    capability,
    client,
    requestedEffect,
    routeId: route.id ?? null,
    routeDescription: route.description ?? null,
    routeSourceFragment: route.sourceFragment ?? null,
    selectionPolicy: root?.policy?.selection ?? 'first-eligible-in-declared-order',
    status: selectedStrategy ? 'eligible-route-found' : 'readiness-required',
    selectedStrategy,
    candidates,
    executionAuthorized: false,
    executionRule: 'Planning never executes. The selected typed authority/transport must perform the operation and return required receipts/postconditions.'
  };
}

function validateHandoff(args = {}) {
  const handoff = object(args.handoff) ? args.handoff : args;
  const owners = readJson('specialist-domain-owners-v1.json')?.owners ?? {};
  const authorities = readJson('agent-capability-authorities-v1.json');
  const { routes } = loadRouteBundle();
  const errors = [];
  const warnings = [];

  if (handoff?.contractVersion !== 'evavo_specialist_handoff_v1') errors.push('contractVersion:unsupported');
  if (typeof handoff?.handoffId !== 'string' || !handoff.handoffId.trim()) errors.push('handoffId:required');
  if (typeof handoff?.to?.repository !== 'string') errors.push('to.repository:required');
  if (!EFFECTS.has(handoff?.requestedEffect)) errors.push('requestedEffect:unsupported');
  if (handoff?.executionAuthority?.grantedByEnvelope !== false) errors.push('executionAuthority.grantedByEnvelope:must-be-false');
  if (handoff?.executionAuthority?.requiresIndependentAdmission !== true) errors.push('executionAuthority.requiresIndependentAdmission:must-be-true');

  const ownerId = handoff?.domainOwner?.ownerId;
  const owner = ownerId ? owners[ownerId] : null;
  if (!owner) errors.push('domainOwner:unknown-owner-id');
  else {
    if (owner.repository !== handoff?.domainOwner?.repository) errors.push('domainOwner:repository-mismatch');
    if (owner.repository !== handoff?.to?.repository) errors.push('domainOwner:receiving-repository-mismatch');
    if (owner.status === 'source-unresolved') errors.push('domainOwner:source-unresolved');
  }
  if (handoff?.domainOwner?.validated !== true) errors.push('domainOwner:validated-must-be-true');

  const authorityId = handoff?.authority?.authorityId ?? null;
  const authority = authorityId ? authorities[authorityId] : null;
  if (authorityId && !authority) errors.push('authority:unknown-authority-id');
  if (authority) {
    if (authority.repository !== handoff?.authority?.authorityRepository) errors.push('authority:repository-mismatch');
    if (!Array.isArray(authority.effects) || !authority.effects.includes(handoff?.requestedEffect)) errors.push('authority:requested-effect-not-owned');
    if (/unresolved|not eligible|restore|planned canonical/i.test(authority.description ?? '')) errors.push('authority:unresolved-or-ineligible');
  }
  if (handoff?.authority?.routeId) {
    const route = routes.find((entry) => entry.id === handoff.authority.routeId);
    if (!route) errors.push('authority:unknown-route-id');
    else {
      if (route.capability !== handoff.requestedCapability) errors.push('authority:route-capability-mismatch');
      if (route.requestedEffect !== handoff.requestedEffect) errors.push('authority:route-effect-mismatch');
      if (handoff?.authority?.strategyId) {
        const strategy = (route.strategies ?? []).find((entry) => entry.id === handoff.authority.strategyId);
        if (!strategy) errors.push('authority:unknown-strategy-id');
        else if (strategy.authority !== authorityId) errors.push('authority:strategy-authority-mismatch');
      }
    }
  } else if (handoff?.requestedEffect !== 'read') warnings.push('authority:no-route-bound-for-effectful-handoff');
  if (!authorityId) warnings.push('authority:not-yet-bound;handoff-is-planning-only');

  return {
    schemaVersion: 1,
    kind: 'evavo-specialist-handoff-validation-v1',
    handoffId: handoff?.handoffId ?? null,
    valid: errors.length === 0,
    domainOwnerValidated: errors.length === 0 && Boolean(owner),
    effectRouteBound: errors.length === 0 && Boolean(authorityId) && handoff?.authority?.validated === true && Boolean(handoff?.authority?.routeId),
    errors,
    warnings,
    executionAuthorized: false,
    policy: {
      domainOwnershipIsSeparateFromMachineAuthority: true,
      handoffPreservesAuthority: true,
      independentAdmissionStillRequired: true,
      validationDoesNotExecute: true
    }
  };
}

export const organizationFederationMcpContract = {
  serverName: 'evavo-organization-federation',
  serverVersion: '1.0.0',
  readOnly: true,
  executionAuthority: false,
  mutationAuthority: false
};

export const organizationFederationTools = [
  {
    name: 'evavo_list_specialist_domain_owners',
    description: 'List canonical EVAVO specialist domain owners. Domain ownership does not grant machine effect authority.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { domain: { type: 'string' } } }
  },
  {
    name: 'evavo_plan_specialist_team',
    description: 'Plan the smallest reviewed EVAVO specialist collaboration pattern for a known pattern or requested domains. Read-only.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { patternId: { type: 'string' }, domains: { type: 'array', items: { type: 'string' }, maxItems: 32 } }
    }
  },
  {
    name: 'evavo_plan_capability_route_readiness',
    description: 'Diagnose whether a canonical capability route is currently eligible from supplied readiness evidence; otherwise return exact blockers/probes. Never executes.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['capability'],
      properties: { capability: { type: 'string' }, client: { type: 'string' }, evidence: { type: 'object' }, nowMs: { type: 'number' } }
    }
  },
  {
    name: 'evavo_validate_specialist_handoff',
    description: 'Validate a typed specialist-to-specialist handoff against domain ownership and machine authority/route boundaries. Never executes.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['handoff'], properties: { handoff: { type: 'object' } } }
  }
];

export async function callOrganizationFederationTool(name, args = {}) {
  if (name === 'evavo_list_specialist_domain_owners') {
    const owners = readJson('specialist-domain-owners-v1.json')?.owners ?? {};
    const domain = normalize(args?.domain);
    const records = Object.entries(owners).map(([ownerId, record]) => ({ ownerId, ...record }));
    return {
      schemaVersion: 1,
      kind: 'evavo-specialist-domain-owner-list-v1',
      domain: domain || null,
      owners: domain ? records.filter((record) => (record.domains ?? []).map(normalize).includes(domain)) : records,
      executionAuthorized: false
    };
  }
  if (name === 'evavo_plan_specialist_team') return planTeam(args);
  if (name === 'evavo_plan_capability_route_readiness') return planRouteReadiness(args);
  if (name === 'evavo_validate_specialist_handoff') return validateHandoff(args);
  throw new Error(`Unknown organization federation tool: ${name}`);
}
