// Runtime boundary for policies exposed by the read-only Control Policy MCP.
// This validates source policy only; it does not probe, repair or execute routes.
const IDENTITIES = ['id', 'routeClass', 'authority', 'provider', 'adapter', 'healthClass'];
const ID_LISTS = ['authorities', 'transports', 'delegatesTo', 'examples', 'remoteTransportPreference'];
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function excluded(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/gu, '');
  return ['desktopcommander', 'externaldesktop', 'externalremotedesktop', 'externalfallback']
    .some((name) => normalized.includes(name));
}

function identity(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('EVAVO_CONTROL_POLICY_IDENTITY_INVALID');
  if (excluded(value)) throw new Error('EVAVO_CONTROL_POLICY_EXTERNAL_ROUTE_EXCLUDED');
}

function records(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('EVAVO_CONTROL_POLICY_ROUTES_INVALID');
  for (const value of values) {
    if (!isRecord(value)) throw new Error('EVAVO_CONTROL_POLICY_ROUTE_INVALID');
    for (const field of IDENTITIES) if (Object.hasOwn(value, field)) identity(value[field]);
    for (const field of ID_LISTS) {
      if (!Object.hasOwn(value, field)) continue;
      if (!Array.isArray(value[field])) throw new Error('EVAVO_CONTROL_POLICY_IDENTITIES_INVALID');
      value[field].forEach(identity);
    }
  }
}

export function assertNativeControlPolicy(policy, kind) {
  if (!isRecord(policy) || policy.kind !== kind || policy.canonical !== true) {
    throw new Error('EVAVO_CONTROL_POLICY_IDENTITY_INVALID');
  }
  const health = kind === 'evavo-workstation-control-health-v1';
  if (!health && kind !== 'evavo-control-path-policy-v1') throw new Error('EVAVO_CONTROL_POLICY_KIND_INVALID');
  const flags = health ? policy.executionPolicy : policy.default;
  if (!isRecord(flags) || flags.externalDesktopCommanderEnabled !== false ||
      flags.externalRemoteDesktopFallbackAllowed !== false) {
    throw new Error('EVAVO_CONTROL_POLICY_NATIVE_ONLY_REQUIRED');
  }
  records(health ? policy.components : policy.routeOrder);
  if (health) {
    if (!Array.isArray(policy.evaluationOrder) || policy.evaluationOrder.length === 0) {
      throw new Error('EVAVO_CONTROL_POLICY_EVALUATION_ORDER_INVALID');
    }
    policy.evaluationOrder.forEach(identity);
    if (!isRecord(policy.observedState) || policy.observedState.historicalSnapshot !== true ||
        policy.observedState.currentMachineAvailabilityAuthoritative !== false) {
      throw new Error('EVAVO_CONTROL_POLICY_STATIC_SNAPSHOT_NOT_LIVE');
    }
  }
  return policy;
}
