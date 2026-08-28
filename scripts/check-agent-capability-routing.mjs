#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  readRoutingConfigFile,
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
  const configPath = path.resolve(argument('--config', path.join(root, 'config', 'agent-capability-routing-v1.json')));
  const validated = validateRoutingConfig(readRoutingConfigFile(configPath));
  process.stdout.write(
    canonicalJson({
      schemaVersion: 1,
      kind: 'evavo-agent-capability-routing-check-v1',
      status: 'passed',
      configPath: path.relative(root, configPath).replaceAll(path.sep, '/'),
      digestSha256: validated.digestSha256,
      routeCount: validated.routeCount,
      strategyCount: validated.strategyCount,
      clients: validated.clients,
      authority: {
        execution: false,
        sourceMutation: false,
        repositoryWrite: false,
        publication: false,
      },
    }),
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
