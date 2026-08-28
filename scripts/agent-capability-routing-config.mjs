import {
  EFFECTS,
  FORBIDDEN_HOSTED_EXECUTION,
  REPOSITORY_PATTERN,
  ROUTING_KIND,
  STATE_LEVEL,
  TRUTH_STATES,
  assert,
  bool,
  exactKeys,
  id,
  integer,
  isRecord,
  sha256Json,
  text,
  uniqueStrings,
} from './agent-capability-routing-common.mjs';

function validateAuthority(authorityId, authority) {
  exactKeys(
    authority,
    ['repository', 'effects', 'exclusiveEffects', 'description'],
    [],
    `EVAVO_AGENT_ROUTING_AUTHORITY_${authorityId}`,
  );
  text(authority.repository, 'EVAVO_AGENT_ROUTING_AUTHORITY_REPOSITORY', {
    maximum: 160,
    pattern: REPOSITORY_PATTERN,
  });
  const effects = uniqueStrings(authority.effects, 'EVAVO_AGENT_ROUTING_AUTHORITY_EFFECTS', {
    validate: (value, code) => {
      const result = id(value, code);
      assert(EFFECTS.has(result), code, result);
      return result;
    },
  });
  const exclusive = uniqueStrings(
    authority.exclusiveEffects,
    'EVAVO_AGENT_ROUTING_AUTHORITY_EXCLUSIVE',
    {
      minimum: 0,
      validate: (value, code) => {
        const result = id(value, code);
        assert(EFFECTS.has(result), code, result);
        return result;
      },
    },
  );
  assert(exclusive.every((effect) => effects.includes(effect)), 'EVAVO_AGENT_ROUTING_AUTHORITY_EXCLUSIVE');
  text(authority.description, 'EVAVO_AGENT_ROUTING_AUTHORITY_DESCRIPTION', { maximum: 1200 });
}

function validateTransport(transportId, transport, clientSet) {
  exactKeys(
    transport,
    [
      'failureDomain',
      'sharedDependencies',
      'executorRepository',
      'clients',
      'effects',
      'minimumState',
      'freshnessSeconds',
      'receiptRequired',
      'physicalReceiptCapable',
      'structuredOnly',
      'arbitraryShell',
      'routineCost',
      'probe',
      'description',
    ],
    [],
    `EVAVO_AGENT_ROUTING_TRANSPORT_${transportId}`,
  );
  const failureDomain = id(transport.failureDomain, 'EVAVO_AGENT_ROUTING_FAILURE_DOMAIN');
  uniqueStrings(transport.sharedDependencies, 'EVAVO_AGENT_ROUTING_SHARED_DEPENDENCIES', { minimum: 0 });
  assert(!FORBIDDEN_HOSTED_EXECUTION.test(`${transportId} ${failureDomain}`), 'EVAVO_AGENT_ROUTING_HOSTED_EXECUTION');
  const clients = uniqueStrings(transport.clients, 'EVAVO_AGENT_ROUTING_TRANSPORT_CLIENTS');
  assert(clients.every((client) => clientSet.has(client)), 'EVAVO_AGENT_ROUTING_TRANSPORT_CLIENT');
  const effects = uniqueStrings(transport.effects, 'EVAVO_AGENT_ROUTING_TRANSPORT_EFFECTS', {
    validate: (value, code) => {
      const result = id(value, code);
      assert(EFFECTS.has(result), code, result);
      return result;
    },
  });
  if (transport.executorRepository === null) {
    assert(effects.every((effect) => effect === 'read'), 'EVAVO_AGENT_ROUTING_EXECUTOR_REQUIRED', transportId);
  } else {
    text(transport.executorRepository, 'EVAVO_AGENT_ROUTING_EXECUTOR_REPOSITORY', {
      maximum: 160,
      pattern: REPOSITORY_PATTERN,
    });
  }
  assert(STATE_LEVEL.has(transport.minimumState), 'EVAVO_AGENT_ROUTING_TRANSPORT_STATE');
  integer(transport.freshnessSeconds, 'EVAVO_AGENT_ROUTING_TRANSPORT_FRESHNESS', 30, 86_400);
  bool(transport.receiptRequired, 'EVAVO_AGENT_ROUTING_TRANSPORT_RECEIPT');
  bool(transport.physicalReceiptCapable, 'EVAVO_AGENT_ROUTING_TRANSPORT_PHYSICAL');
  assert(transport.structuredOnly === true, 'EVAVO_AGENT_ROUTING_TRANSPORT_STRUCTURED_ONLY');
  assert(transport.arbitraryShell === false, 'EVAVO_AGENT_ROUTING_TRANSPORT_ARBITRARY_SHELL');
  assert(transport.routineCost === 'zero-cost', 'EVAVO_AGENT_ROUTING_TRANSPORT_COST');
  text(transport.probe, 'EVAVO_AGENT_ROUTING_TRANSPORT_PROBE', { maximum: 320 });
  text(transport.description, 'EVAVO_AGENT_ROUTING_TRANSPORT_DESCRIPTION', { maximum: 1200 });
  if (effects.some((effect) => effect !== 'read')) {
    assert(transport.receiptRequired === true, 'EVAVO_AGENT_ROUTING_EFFECT_RECEIPT', transportId);
    assert(transport.executorRepository === 'EVAVO-STUDIO/evavo-local-compute', 'EVAVO_AGENT_ROUTING_PHYSICAL_EXECUTOR', transportId);
  }
}

function validatePolicy(policy) {
  exactKeys(
    policy,
    [
      'selection',
      'routineCost',
      'maximumClockSkewSeconds',
      'allowGitHubActions',
      'allowVercelAsExecutionAuthority',
      'allowArbitraryShell',
      'runtimeClaimsRequireReceipt',
      'failureDomainScope',
    ],
    [],
    'EVAVO_AGENT_ROUTING_POLICY',
  );
  assert(policy.selection === 'first-eligible-in-declared-order', 'EVAVO_AGENT_ROUTING_SELECTION');
  assert(policy.routineCost === 'zero-cost', 'EVAVO_AGENT_ROUTING_COST');
  integer(policy.maximumClockSkewSeconds, 'EVAVO_AGENT_ROUTING_CLOCK_SKEW', 0, 900);
  assert(policy.allowGitHubActions === false, 'EVAVO_AGENT_ROUTING_ACTIONS');
  assert(policy.allowVercelAsExecutionAuthority === false, 'EVAVO_AGENT_ROUTING_VERCEL');
  assert(policy.allowArbitraryShell === false, 'EVAVO_AGENT_ROUTING_ARBITRARY_SHELL');
  assert(policy.runtimeClaimsRequireReceipt === true, 'EVAVO_AGENT_ROUTING_RUNTIME_RECEIPT');
  assert(policy.failureDomainScope === 'transport-ingress-only', 'EVAVO_AGENT_ROUTING_FAILURE_DOMAIN_SCOPE');
}

export function validateRoutingConfig(config) {
  exactKeys(
    config,
    [
      'schemaVersion',
      'kind',
      'canonical',
      'clients',
      'truthStates',
      'policy',
      'authorities',
      'transports',
      'routes',
    ],
    [],
    'EVAVO_AGENT_ROUTING_CONFIG',
  );
  assert(config.schemaVersion === 1, 'EVAVO_AGENT_ROUTING_SCHEMA');
  assert(config.kind === ROUTING_KIND, 'EVAVO_AGENT_ROUTING_KIND');
  assert(config.canonical === true, 'EVAVO_AGENT_ROUTING_CANONICAL');
  const clients = uniqueStrings(config.clients, 'EVAVO_AGENT_ROUTING_CLIENTS');
  const clientSet = new Set(clients);
  assert(
    Array.isArray(config.truthStates) &&
      config.truthStates.length === TRUTH_STATES.length &&
      config.truthStates.every((state, index) => state === TRUTH_STATES[index]),
    'EVAVO_AGENT_ROUTING_TRUTH_STATES',
  );
  validatePolicy(config.policy);

  assert(isRecord(config.authorities) && Object.keys(config.authorities).length >= 1, 'EVAVO_AGENT_ROUTING_AUTHORITIES');
  for (const [authorityId, authority] of Object.entries(config.authorities)) {
    id(authorityId, 'EVAVO_AGENT_ROUTING_AUTHORITY_ID');
    validateAuthority(authorityId, authority);
  }

  assert(isRecord(config.transports) && Object.keys(config.transports).length >= 1, 'EVAVO_AGENT_ROUTING_TRANSPORTS');
  for (const [transportId, transport] of Object.entries(config.transports)) {
    id(transportId, 'EVAVO_AGENT_ROUTING_TRANSPORT_ID');
    validateTransport(transportId, transport, clientSet);
  }

  assert(Array.isArray(config.routes) && config.routes.length >= 1 && config.routes.length <= 128, 'EVAVO_AGENT_ROUTING_ROUTES');
  const routeIds = new Set();
  const capabilities = new Set();
  const strategyIds = new Set();
  for (const [routeIndex, route] of config.routes.entries()) {
    exactKeys(
      route,
      [
        'id',
        'capability',
        'requestedEffect',
        'completionState',
        'physicalState',
        'minimumIndependentIngressDomains',
        'description',
        'strategies',
      ],
      [],
      `EVAVO_AGENT_ROUTING_ROUTE_${routeIndex}`,
    );
    const routeId = id(route.id, 'EVAVO_AGENT_ROUTING_ROUTE_ID');
    const capability = id(route.capability, 'EVAVO_AGENT_ROUTING_CAPABILITY');
    assert(!routeIds.has(routeId), 'EVAVO_AGENT_ROUTING_ROUTE_DUPLICATE', routeId);
    assert(!capabilities.has(capability), 'EVAVO_AGENT_ROUTING_CAPABILITY_DUPLICATE', capability);
    routeIds.add(routeId);
    capabilities.add(capability);
    const requestedEffect = id(route.requestedEffect, 'EVAVO_AGENT_ROUTING_ROUTE_EFFECT');
    assert(EFFECTS.has(requestedEffect), 'EVAVO_AGENT_ROUTING_ROUTE_EFFECT', requestedEffect);
    assert(STATE_LEVEL.has(route.completionState), 'EVAVO_AGENT_ROUTING_COMPLETION_STATE');
    if (route.physicalState !== null) {
      assert(STATE_LEVEL.has(route.physicalState), 'EVAVO_AGENT_ROUTING_PHYSICAL_STATE');
      assert(
        STATE_LEVEL.get(route.physicalState) >= STATE_LEVEL.get(route.completionState),
        'EVAVO_AGENT_ROUTING_PHYSICAL_ORDER',
      );
    }
    const minimumDomains = integer(
      route.minimumIndependentIngressDomains,
      'EVAVO_AGENT_ROUTING_MINIMUM_DOMAINS',
      1,
      8,
    );
    text(route.description, 'EVAVO_AGENT_ROUTING_ROUTE_DESCRIPTION', { maximum: 1200 });
    assert(Array.isArray(route.strategies) && route.strategies.length >= 1 && route.strategies.length <= 16, 'EVAVO_AGENT_ROUTING_STRATEGIES');
    const failureDomains = new Set();
    const effectAuthorities = new Set();
    for (const [strategyIndex, strategy] of route.strategies.entries()) {
      exactKeys(
        strategy,
        ['id', 'authority', 'transport', 'clients', 'minimumState'],
        [],
        `EVAVO_AGENT_ROUTING_STRATEGY_${routeId}_${strategyIndex}`,
      );
      const strategyId = id(strategy.id, 'EVAVO_AGENT_ROUTING_STRATEGY_ID');
      assert(!strategyIds.has(strategyId), 'EVAVO_AGENT_ROUTING_STRATEGY_DUPLICATE', strategyId);
      strategyIds.add(strategyId);
      const authorityId = id(strategy.authority, 'EVAVO_AGENT_ROUTING_STRATEGY_AUTHORITY');
      const transportId = id(strategy.transport, 'EVAVO_AGENT_ROUTING_STRATEGY_TRANSPORT');
      const authority = config.authorities[authorityId];
      const transport = config.transports[transportId];
      assert(authority, 'EVAVO_AGENT_ROUTING_STRATEGY_AUTHORITY_UNKNOWN', authorityId);
      assert(transport, 'EVAVO_AGENT_ROUTING_STRATEGY_TRANSPORT_UNKNOWN', transportId);
      assert(authority.effects.includes(requestedEffect), 'EVAVO_AGENT_ROUTING_AUTHORITY_EFFECT', strategyId);
      assert(transport.effects.includes(requestedEffect), 'EVAVO_AGENT_ROUTING_TRANSPORT_EFFECT', strategyId);
      const strategyClients = uniqueStrings(strategy.clients, 'EVAVO_AGENT_ROUTING_STRATEGY_CLIENTS');
      assert(strategyClients.every((client) => clientSet.has(client)), 'EVAVO_AGENT_ROUTING_STRATEGY_CLIENT');
      assert(strategyClients.every((client) => transport.clients.includes(client)), 'EVAVO_AGENT_ROUTING_TRANSPORT_CLIENT_MISMATCH', strategyId);
      assert(STATE_LEVEL.has(strategy.minimumState), 'EVAVO_AGENT_ROUTING_STRATEGY_STATE');
      assert(
        STATE_LEVEL.get(strategy.minimumState) >= STATE_LEVEL.get(transport.minimumState),
        'EVAVO_AGENT_ROUTING_STRATEGY_STATE_WEAKENED',
        strategyId,
      );
      failureDomains.add(transport.failureDomain);
      effectAuthorities.add(authorityId);
      if (route.physicalState !== null) {
        assert(transport.physicalReceiptCapable === true, 'EVAVO_AGENT_ROUTING_PHYSICAL_TRANSPORT', strategyId);
      }
    }
    assert(
      failureDomains.size >= minimumDomains,
      'EVAVO_AGENT_ROUTING_FAILURE_DOMAIN_COUNT',
      `${routeId}:${String(failureDomains.size)}<${String(minimumDomains)}`,
    );
    if (requestedEffect !== 'read') {
      assert(effectAuthorities.size === 1, 'EVAVO_AGENT_ROUTING_EFFECT_AUTHORITY_SPLIT', routeId);
    }
  }

  return Object.freeze({
    config,
    digestSha256: sha256Json(config),
    clients: Object.freeze(clients),
    routeCount: config.routes.length,
    strategyCount: strategyIds.size,
  });
}
