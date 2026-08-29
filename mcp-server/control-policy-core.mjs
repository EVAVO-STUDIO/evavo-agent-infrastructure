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
        backgroundCapable: { type: 'boolean' },
        localMcpCapable: { type: 'boolean' },
        isolatedBrowserCapable: { type: 'boolean' },
        nativeDesktopRequired: { type: 'boolean' },
        physicalConsoleRequired: { type: 'boolean' },
        outOfBandRecoveryRequired: { type: 'boolean' },
      },
    },
  },
]);

export const controlPolicyMcpContract = Object.freeze({
  serverName: 'EVAVO Control Path Policy',
  serverVersion: '1.0.0',
  readOnly: true,
  executionAuthority: false,
  focusDisruptionExpected: false,
});

function bool(value) { return value === true; }

export function chooseControlRoute(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
  const allowed = new Set([
    'typedApiCapable', 'backgroundCapable', 'localMcpCapable', 'isolatedBrowserCapable',
    'nativeDesktopRequired', 'physicalConsoleRequired', 'outOfBandRecoveryRequired',
  ]);
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`unknown route-advice field: ${key}`);

  let routeClass = 'unresolved';
  let disruption = 'none';
  if (bool(args.typedApiCapable)) routeClass = 'typed-api-or-connector';
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

export async function callControlPolicyTool(name, args = {}) {
  if (name === 'evavo_control_path_policy') return { ...readJson(POLICY_PATH), executionAuthority: false, focusDisruptionExpected: false };
  if (name === 'evavo_control_health_policy') return { ...readJson(HEALTH_PATH), executionAuthority: false, focusDisruptionExpected: false };
  if (name === 'evavo_control_route_advice') return chooseControlRoute(args);
  throw new Error(`unknown tool: ${String(name)}`);
}
