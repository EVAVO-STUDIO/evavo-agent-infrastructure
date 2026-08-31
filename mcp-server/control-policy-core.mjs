import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_PATH = path.join(ROOT, 'config', 'control-path-policy-v1.json');
const HEALTH_PATH = path.join(ROOT, 'config', 'workstation-control-health-v1.json');

function readJson(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 256 * 1024) {
    throw new Error('EVAVO_CONTROL_POLICY_FILE_ADMISSION');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const controlPolicyTools = Object.freeze([
  {
    name: 'evavo_control_path_policy',
    description: 'Return the canonical least-disruptive workstation control-path policy. Read-only and non-interactive.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'evavo_control_health_policy',
    description: 'Return the canonical owner-scoped workstation control-fabric health/self-heal policy. Read-only and non-interactive.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'evavo_control_route_advice',
    description: 'Choose the least disruptive route class from explicit capability facts. This plans only; it never executes an action.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        typedApiCapable: { type: 'boolean' },
        singletonGatewayCapable: { type: 'boolean' },
        backgroundCapable: { type: 'boolean' },
        localMcpCapable: { type: 'boolean' },
        isolatedBrowserCapable: { type: 'boolean' },
        nativeDesktopRequired: { type: 'boolean' },
        physicalConsoleRequired: { type: 'boolean' },
        outOfBandRecoveryRequired: { type: 'boolean' },
      },
    },
  },
  {
    name: 'evavo_control_receipt_advice',
    description: 'Classify explicit physical-effect and receipt facts into a safe retry/reconciliation disposition. Read-only; never repeats or executes the underlying action.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['physicalEffectState', 'sideEffectMayHaveCommitted', 'postconditionVerified', 'intentPersisted', 'terminalReceiptPersisted'],
      properties: {
        physicalEffectState: { type: 'string', minLength: 1, maxLength: 96 },
        sideEffectMayHaveCommitted: { type: 'boolean' },
        postconditionVerified: { type: 'boolean' },
        intentPersisted: { type: 'boolean' },
        terminalReceiptPersisted: { type: 'boolean' },
        reconciliationRequired: { type: 'boolean' },
      },
    },
  },
]);

export const controlPolicyMcpContract = Object.freeze({
  serverName: 'EVAVO Control Path Policy',
  serverVersion: '1.3.0',
  readOnly: true,
  executionAuthority: false,
  focusDisruptionExpected: false,
});

function bool(value) { return value === true; }

export function chooseControlRoute(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
  const allowed = new Set([
    'typedApiCapable', 'singletonGatewayCapable', 'backgroundCapable', 'localMcpCapable', 'isolatedBrowserCapable',
    'nativeDesktopRequired', 'physicalConsoleRequired', 'outOfBandRecoveryRequired',
  ]);
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`unknown route-advice field: ${key}`);

  let routeClass = 'unresolved';
  let disruption = 'none';
  if (bool(args.typedApiCapable)) routeClass = 'typed-api-or-connector';
  else if (bool(args.singletonGatewayCapable)) routeClass = 'singleton-agent-gateway';
  else if (bool(args.backgroundCapable)) routeClass = 'local-compute-background';
  else if (bool(args.localMcpCapable)) routeClass = 'local-mcp';
  else if (bool(args.isolatedBrowserCapable)) { routeClass = 'isolated-browser'; disruption = 'isolated-ui'; }
  else if (bool(args.nativeDesktopRequired) && !bool(args.physicalConsoleRequired) && !bool(args.outOfBandRecoveryRequired)) {
    routeClass = 'native-desktop'; disruption = 'foreground-ui';
  } else if (bool(args.physicalConsoleRequired) && !bool(args.outOfBandRecoveryRequired)) {
    routeClass = 's3-hid-or-approved-console'; disruption = 'physical-console';
  } else if (bool(args.outOfBandRecoveryRequired)) {
    routeClass = 'comet-or-oob-recovery'; disruption = 'recovery-impact';
  }
  return {
    schemaVersion: 1,
    kind: 'evavo-control-route-advice-v1',
    routeClass,
    disruption,
    focusDisruptionExpected: ['foreground-ui', 'physical-console', 'recovery-impact'].includes(disruption),
    execute: false,
    requiresRuntimeEligibilityEvidence: routeClass !== 'unresolved',
    truth: 'This is route planning from supplied capability facts, not proof that a transport is currently online or accepted.',
  };
}

function requireBoolean(args, key) {
  if (typeof args[key] !== 'boolean') throw new Error(`${key} must be boolean`);
  return args[key];
}

export function classifyReceiptTruth(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
  const allowed = new Set([
    'physicalEffectState', 'sideEffectMayHaveCommitted', 'postconditionVerified', 'intentPersisted',
    'terminalReceiptPersisted', 'reconciliationRequired',
  ]);
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`unknown receipt-advice field: ${key}`);

  const physicalEffectState = String(args.physicalEffectState || '').trim();
  if (!physicalEffectState || physicalEffectState.length > 96) throw new Error('physicalEffectState must be 1-96 characters');
  const sideEffectMayHaveCommitted = requireBoolean(args, 'sideEffectMayHaveCommitted');
  const postconditionVerified = requireBoolean(args, 'postconditionVerified');
  const intentPersisted = requireBoolean(args, 'intentPersisted');
  const terminalReceiptPersisted = requireBoolean(args, 'terminalReceiptPersisted');
  const explicitReconciliation = args.reconciliationRequired === true;

  let disposition = 'reconcile-before-retry';
  let operationSucceeded = false;
  let retryUnderlyingAction = false;
  let requestReplaySafe = false;
  let receiptReplaySafe = false;
  let reconciliationRequired = true;
  let reason = 'physical-effect-state-is-not-conclusive';

  const noEffectStates = new Set(['not_attempted', 'verified_not_committed']);
  const committedStates = new Set(['verified_committed']);

  if (committedStates.has(physicalEffectState) && postconditionVerified) {
    operationSucceeded = true;
    retryUnderlyingAction = false;
    requestReplaySafe = false;
    receiptReplaySafe = terminalReceiptPersisted && !explicitReconciliation;
    reconciliationRequired = !terminalReceiptPersisted || explicitReconciliation;
    if (reconciliationRequired) {
      disposition = 'success-receipt-degraded';
      reason = 'physical-effect-is-verified-but-terminal-receipt-is-not-conclusive';
    } else {
      disposition = 'complete';
      reason = 'physical-effect-and-terminal-receipt-are-both-verified';
    }
  } else if (
    noEffectStates.has(physicalEffectState) &&
    sideEffectMayHaveCommitted === false &&
    postconditionVerified === false &&
    explicitReconciliation === false
  ) {
    disposition = 'retry-safe-no-effect';
    operationSucceeded = false;
    retryUnderlyingAction = true;
    requestReplaySafe = true;
    receiptReplaySafe = false;
    reconciliationRequired = false;
    reason = intentPersisted
      ? 'durable-intent-exists-but-physical-effect-is-verified-not-committed'
      : 'physical-effect-was-not-attempted';
  } else {
    disposition = 'reconcile-before-retry';
    operationSucceeded = false;
    retryUnderlyingAction = false;
    requestReplaySafe = false;
    receiptReplaySafe = false;
    reconciliationRequired = true;
    reason = sideEffectMayHaveCommitted
      ? 'physical-effect-may-have-committed-and-must-be-observed-before-any-retry'
      : 'receipt-facts-are-incomplete-or-contradictory';
  }

  return {
    schemaVersion: 2,
    kind: 'evavo-control-receipt-advice-v2',
    disposition,
    operationSucceeded,
    retryUnderlyingAction,
    requestReplaySafe,
    receiptReplaySafe,
    reconciliationRequired,
    physicalEffectState,
    intentPersisted,
    terminalReceiptPersisted,
    sideEffectMayHaveCommitted,
    postconditionVerified,
    execute: false,
    reason,
    rule: 'Never infer physical failure from a transport, callback, audit, or receipt-persistence error after execution may have begun. Replaying a stored receipt is distinct from re-executing the physical action.',
  };
}

export async function callControlPolicyTool(name, args = {}) {
  if (name === 'evavo_control_path_policy') return { ...readJson(POLICY_PATH), executionAuthority: false, focusDisruptionExpected: false };
  if (name === 'evavo_control_health_policy') return { ...readJson(HEALTH_PATH), executionAuthority: false, focusDisruptionExpected: false };
  if (name === 'evavo_control_route_advice') return chooseControlRoute(args);
  if (name === 'evavo_control_receipt_advice') return classifyReceiptTruth(args);
  throw new Error(`unknown tool: ${String(name)}`);
}
