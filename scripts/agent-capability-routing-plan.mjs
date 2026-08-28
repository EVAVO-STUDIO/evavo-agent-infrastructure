import {
  PLAN_KIND,
  SHA_PATTERN,
  STATE_LEVEL,
  STATUS_KIND,
  assert,
  bool,
  exactKeys,
  id,
  isoInstant,
  sha256Json,
  text,
  uniqueStrings,
} from './agent-capability-routing-common.mjs';
import { validateRoutingConfig } from './agent-capability-routing-config.mjs';

export function validateCapabilityStatus(status, validatedRouting) {
  const config = validatedRouting.config ?? validatedRouting;
  exactKeys(
    status,
    ['schemaVersion', 'kind', 'capturedAt', 'client', 'requestedCapabilities', 'evidence'],
    [],
    'EVAVO_AGENT_STATUS',
  );
  assert(status.schemaVersion === 1, 'EVAVO_AGENT_STATUS_SCHEMA');
  assert(status.kind === STATUS_KIND, 'EVAVO_AGENT_STATUS_KIND');
  const capturedAtMs = isoInstant(status.capturedAt, 'EVAVO_AGENT_STATUS_CAPTURED_AT');
  const client = id(status.client, 'EVAVO_AGENT_STATUS_CLIENT');
  assert(config.clients.includes(client), 'EVAVO_AGENT_STATUS_CLIENT_UNKNOWN', client);
  const requestedCapabilities = uniqueStrings(
    status.requestedCapabilities,
    'EVAVO_AGENT_STATUS_CAPABILITIES',
    { minimum: 1 },
  );
  assert(Array.isArray(status.evidence) && status.evidence.length <= 512, 'EVAVO_AGENT_STATUS_EVIDENCE');
  const strategies = new Map(
    config.routes.flatMap((route) => route.strategies.map((strategy) => [strategy.id, strategy])),
  );
  const evidenceByStrategy = new Map();
  for (const [index, evidence] of status.evidence.entries()) {
    exactKeys(
      evidence,
      ['strategyId', 'state', 'observedAt', 'sourceRevision', 'healthy'],
      ['receiptId', 'detail'],
      `EVAVO_AGENT_STATUS_EVIDENCE_${index}`,
    );
    const strategyId = id(evidence.strategyId, 'EVAVO_AGENT_STATUS_STRATEGY');
    assert(strategies.has(strategyId), 'EVAVO_AGENT_STATUS_STRATEGY_UNKNOWN', strategyId);
    assert(!evidenceByStrategy.has(strategyId), 'EVAVO_AGENT_STATUS_STRATEGY_DUPLICATE', strategyId);
    assert(STATE_LEVEL.has(evidence.state), 'EVAVO_AGENT_STATUS_STATE', evidence.state);
    const observedAtMs = isoInstant(evidence.observedAt, 'EVAVO_AGENT_STATUS_OBSERVED_AT');
    assert(observedAtMs <= capturedAtMs + config.policy.maximumClockSkewSeconds * 1000, 'EVAVO_AGENT_STATUS_AFTER_CAPTURE', strategyId);
    text(evidence.sourceRevision, 'EVAVO_AGENT_STATUS_SOURCE_REVISION', {
      maximum: 40,
      pattern: SHA_PATTERN,
    });
    bool(evidence.healthy, 'EVAVO_AGENT_STATUS_HEALTHY');
    if (Object.hasOwn(evidence, 'receiptId')) {
      text(evidence.receiptId, 'EVAVO_AGENT_STATUS_RECEIPT', { maximum: 256 });
    }
    if (Object.hasOwn(evidence, 'detail')) {
      text(evidence.detail, 'EVAVO_AGENT_STATUS_DETAIL', { maximum: 1024 });
    }
    if (STATE_LEVEL.get(evidence.state) >= STATE_LEVEL.get('accepted')) {
      assert(Object.hasOwn(evidence, 'receiptId'), 'EVAVO_AGENT_STATUS_RECEIPT_REQUIRED', strategyId);
    }
    evidenceByStrategy.set(strategyId, Object.freeze({ ...evidence, observedAtMs }));
  }
  return Object.freeze({
    status,
    capturedAtMs,
    client,
    requestedCapabilities: Object.freeze(requestedCapabilities),
    evidenceByStrategy,
    digestSha256: sha256Json(status),
  });
}

function candidateAssessment({ config, strategy, evidence, nowMs }) {
  const transport = config.transports[strategy.transport];
  const minimumLevel = STATE_LEVEL.get(strategy.minimumState);
  if (!evidence) {
    return Object.freeze({
      strategyId: strategy.id,
      authority: strategy.authority,
      transport: strategy.transport,
      failureDomain: transport.failureDomain,
      sharedDependencies: transport.sharedDependencies,
      executorRepository: transport.executorRepository,
      eligible: false,
      reason: 'missing-evidence',
      observedState: null,
      ageSeconds: null,
    });
  }
  const ageMilliseconds = nowMs - evidence.observedAtMs;
  const ageSeconds = Math.max(0, Math.floor(ageMilliseconds / 1000));
  let reason = 'eligible';
  if (evidence.observedAtMs > nowMs + config.policy.maximumClockSkewSeconds * 1000) {
    reason = 'future-evidence';
  } else if (ageMilliseconds > transport.freshnessSeconds * 1000) {
    reason = 'stale-evidence';
  } else if (!evidence.healthy) {
    reason = 'unhealthy';
  } else if (STATE_LEVEL.get(evidence.state) < minimumLevel) {
    reason = 'insufficient-state';
  }
  return Object.freeze({
    strategyId: strategy.id,
    authority: strategy.authority,
    transport: strategy.transport,
    failureDomain: transport.failureDomain,
    sharedDependencies: transport.sharedDependencies,
    executorRepository: transport.executorRepository,
    eligible: reason === 'eligible',
    reason,
    observedState: evidence.state,
    ageSeconds,
  });
}

export function planCapabilityRoutes({ routing, status, now = new Date().toISOString() }) {
  const validatedRouting = routing.digestSha256 ? routing : validateRoutingConfig(routing);
  const validatedStatus = status.digestSha256
    ? status
    : validateCapabilityStatus(status, validatedRouting);
  const config = validatedRouting.config;
  const nowMs = isoInstant(now, 'EVAVO_AGENT_PLAN_NOW');
  const routesByCapability = new Map(config.routes.map((route) => [route.capability, route]));
  const decisions = [];

  for (const capability of validatedStatus.requestedCapabilities) {
    const route = routesByCapability.get(capability);
    if (!route) {
      decisions.push({
        capability,
        status: 'blocked',
        reason: 'unknown-capability',
        requestedEffect: null,
        selected: null,
        candidates: [],
        claims: {
          mayAttempt: false,
          mayClaimCompleted: false,
          mayClaimPhysicallyVerified: false,
        },
      });
      continue;
    }
    const applicable = route.strategies.filter((strategy) => strategy.clients.includes(validatedStatus.client));
    const candidates = applicable.map((strategy) =>
      candidateAssessment({
        config,
        strategy,
        evidence: validatedStatus.evidenceByStrategy.get(strategy.id),
        nowMs,
      }),
    );
    const selectedAssessment = candidates.find((candidate) => candidate.eligible);
    if (!selectedAssessment) {
      const observed = candidates.filter((candidate) => candidate.observedState !== null);
      const hasHealthySource = observed.some(
        (candidate) =>
          candidate.reason === 'insufficient-state' ||
          candidate.reason === 'stale-evidence' ||
          candidate.reason === 'future-evidence',
      );
      const hasExplicitBlocker = observed.some((candidate) => candidate.reason === 'unhealthy');
      decisions.push({
        capability,
        status: hasExplicitBlocker ? 'blocked' : hasHealthySource ? 'source-ready-runtime-unproven' : 'unavailable',
        reason: hasExplicitBlocker
          ? 'all-observed-routes-blocked'
          : hasHealthySource
            ? 'runtime-evidence-insufficient'
            : 'no-current-route-evidence',
        requestedEffect: route.requestedEffect,
        selected: null,
        candidates,
        claims: {
          mayAttempt: false,
          mayClaimCompleted: false,
          mayClaimPhysicallyVerified: false,
        },
      });
      continue;
    }
    const strategy = route.strategies.find((entry) => entry.id === selectedAssessment.strategyId);
    const evidence = validatedStatus.evidenceByStrategy.get(strategy.id);
    const transport = config.transports[strategy.transport];
    const completionLevel = STATE_LEVEL.get(route.completionState);
    const observedLevel = STATE_LEVEL.get(evidence.state);
    const hasReceipt = typeof evidence.receiptId === 'string';
    const mayClaimCompleted =
      observedLevel >= completionLevel &&
      (!config.policy.runtimeClaimsRequireReceipt || hasReceipt);
    const mayClaimPhysicallyVerified =
      route.physicalState !== null &&
      transport.physicalReceiptCapable === true &&
      observedLevel >= STATE_LEVEL.get(route.physicalState) &&
      hasReceipt;
    decisions.push({
      capability,
      status: 'ready',
      reason: 'first-eligible-route',
      requestedEffect: route.requestedEffect,
      selected: {
        strategyId: strategy.id,
        authority: strategy.authority,
        authorityRepository: config.authorities[strategy.authority].repository,
        transport: strategy.transport,
        failureDomain: transport.failureDomain,
        sharedDependencies: transport.sharedDependencies,
        executorRepository: transport.executorRepository,
        observedState: evidence.state,
        sourceRevision: evidence.sourceRevision,
        receiptId: evidence.receiptId ?? null,
      },
      candidates,
      claims: {
        mayAttempt: true,
        mayClaimCompleted,
        mayClaimPhysicallyVerified,
      },
    });
  }

  const readyCount = decisions.filter((decision) => decision.status === 'ready').length;
  let overallStatus = 'ready';
  if (readyCount === 0) {
    overallStatus = decisions.some((decision) => decision.status === 'blocked')
      ? 'blocked'
      : 'unproven';
  } else if (readyCount !== decisions.length) {
    overallStatus = 'degraded';
  }

  const plan = {
    schemaVersion: 1,
    kind: PLAN_KIND,
    plannedAt: new Date(nowMs).toISOString(),
    capturedAt: validatedStatus.status.capturedAt,
    client: validatedStatus.client,
    overallStatus,
    routingDigestSha256: validatedRouting.digestSha256,
    statusDigestSha256: validatedStatus.digestSha256,
    decisions,
    authority: {
      execution: false,
      sourceMutation: false,
      repositoryWrite: false,
      publication: false,
      providerMutation: false,
      credentialAccess: false,
    },
  };
  return Object.freeze({ ...plan, planDigestSha256: sha256Json(plan) });
}
