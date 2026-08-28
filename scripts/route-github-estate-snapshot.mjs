#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  createEstateRoutingStatus,
  readEstateRoutingInputFile,
  verifyEstateRoutingEvidence,
} from './github-estate-routing-evidence.mjs';
import {
  planCapabilityRoutes,
  readRoutingConfigFile,
  validateCapabilityStatus,
  validateRoutingConfig,
} from './agent-capability-routing-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODES = new Set(['verify', 'status', 'plan']);
const CLIENTS = new Set(['chatgpt-pro', 'claude-code', 'codex', 'api-agent']);
const BOOLEAN_OPTIONS = new Set(['compact']);
const VALUE_OPTIONS = new Set([
  'snapshotDirectory',
  'snapshotRoot',
  'trustBundle',
  'client',
  'now',
  'config',
]);

function fail(message) {
  throw new Error(message);
}

function camelCase(value) {
  return value.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
}

export function parseEstateRoutingCli(argv) {
  const mode = argv[0];
  if (!MODES.has(mode)) {
    fail('Usage: route-github-estate-snapshot.mjs <verify|status|plan> [named options].');
  }
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--' || !token.startsWith('--')) {
      fail('GitHub estate routing accepts named options only.');
    }
    const equals = token.indexOf('=');
    const rawName = token.slice(2, equals >= 0 ? equals : undefined);
    const name = camelCase(rawName);
    if (!BOOLEAN_OPTIONS.has(name) && !VALUE_OPTIONS.has(name)) {
      fail(`Unsupported option --${rawName}.`);
    }
    if (Object.hasOwn(options, name)) fail(`Option --${rawName} was repeated.`);
    if (BOOLEAN_OPTIONS.has(name)) {
      if (equals >= 0) fail(`Boolean option --${rawName} does not accept a value.`);
      options[name] = true;
      continue;
    }
    const value = equals >= 0 ? token.slice(equals + 1) : argv[index + 1];
    if (!value || (equals < 0 && value.startsWith('--'))) {
      fail(`Option --${rawName} requires a value.`);
    }
    options[name] = value;
    if (equals < 0) index += 1;
  }
  const hasDirectory = typeof options.snapshotDirectory === 'string';
  const hasRoot = typeof options.snapshotRoot === 'string';
  if (hasDirectory === hasRoot) {
    fail('Provide exactly one of --snapshot-directory or --snapshot-root.');
  }
  if (!options.trustBundle) fail('--trust-bundle is required.');
  if (mode === 'verify' && options.client !== undefined) {
    fail('verify does not accept --client.');
  }
  if (mode !== 'verify') {
    if (!options.client) fail(`--client is required for ${mode}.`);
    if (!CLIENTS.has(options.client)) fail(`Unsupported client: ${options.client}.`);
  }
  if (mode !== 'plan' && options.config !== undefined) {
    fail(`--config is accepted only for plan.`);
  }
  return Object.freeze({ mode, options: Object.freeze(options) });
}

function output(value, compact) {
  process.stdout.write(compact ? `${JSON.stringify(value)}\n` : canonicalJson(value));
}

export async function runEstateRoutingCli(argv = process.argv.slice(2)) {
  const { mode, options } = parseEstateRoutingCli(argv);
  const now = options.now ?? new Date().toISOString();
  const verification = verifyEstateRoutingEvidence({
    ...(options.snapshotDirectory
      ? { snapshotDirectory: path.resolve(options.snapshotDirectory) }
      : { snapshotRoot: path.resolve(options.snapshotRoot) }),
    trustBundle: readEstateRoutingInputFile(options.trustBundle, 'trust-bundle'),
    now,
  });
  if (mode === 'verify') {
    output(verification, options.compact === true);
    return verification;
  }
  const statusDocument = createEstateRoutingStatus({
    verification,
    client: options.client,
  });
  if (mode === 'status') {
    output(statusDocument, options.compact === true);
    return statusDocument;
  }
  const configPath = path.resolve(
    options.config ?? path.join(root, 'config', 'agent-capability-routing-v1.json'),
  );
  const routing = validateRoutingConfig(readRoutingConfigFile(configPath));
  const status = validateCapabilityStatus(statusDocument, routing);
  const plan = planCapabilityRoutes({ routing, status, now });
  output(plan, options.compact === true);
  return plan;
}

const entrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (entrypoint) {
  runEstateRoutingCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
