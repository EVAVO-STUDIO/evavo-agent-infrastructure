#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  planCapabilityRoutes,
  readRoutingConfigFile,
  readStrictJsonFile,
  validateCapabilityStatus,
  validateRoutingConfig,
} from './agent-capability-routing-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) throw new Error(`${name} requires a value.`);
  return process.argv[index + 1];
}

try {
  const statusArgument = argument('--status', null);
  if (!statusArgument) throw new Error('--status is required.');
  const configPath = path.resolve(argument('--config', path.join(root, 'config', 'agent-capability-routing-v1.json')));
  const statusPath = path.resolve(statusArgument);
  const now = argument('--now', new Date().toISOString());
  const routing = validateRoutingConfig(readRoutingConfigFile(configPath));
  const status = validateCapabilityStatus(readStrictJsonFile(statusPath), routing);
  process.stdout.write(canonicalJson(planCapabilityRoutes({ routing, status, now })));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
