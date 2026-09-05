#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  parseStrictJson,
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

function assertFallbackInterop() {
  const interopPath = path.join(root, 'config', 'desktop-commander-interop-v1.json');
  const interop = parseStrictJson(fs.readFileSync(interopPath, 'utf8'));
  const fail = (message) => { throw new Error(`EVAVO_DESKTOP_COMMANDER_FALLBACK_POLICY: ${message}`); };
  if (interop?.policy?.fallbackOnly !== true) fail('fallbackOnly must remain true');
  if (interop?.policy?.preferNativeEvavoRoutes !== true) fail('native EVAVO routes must remain preferred');
  if (interop?.policy?.desktopCommanderAvailabilityDoesNotDefineMachineHealth !== true) fail('Desktop Commander must not define machine health');
  if (interop?.policy?.desktopCommanderFailureDoesNotDefineMachineOffline !== true) fail('Desktop Commander failure must not imply machine offline');
  if (interop?.policy?.desktopCommanderIsNotRequiredForLocalVerification !== true) fail('Desktop Commander must not gate local verification');
  if (interop?.routing?.canonicalBackgroundExecution !== 'evavo-local-compute') fail('Local Compute must remain canonical background executor');
  if (interop?.routing?.canonicalForegroundGui !== 'evavo-computer-agent') fail('Computer Agent must remain canonical foreground GUI authority');
  if (interop?.routing?.desktopCommanderPriority !== 'after-native-evavo-routes') fail('Desktop Commander must remain after native EVAVO routes');
  return interopPath;
}

try {
  const configPath = path.resolve(argument('--config', path.join(root, 'config', 'agent-capability-routing-v1.json')));
  const validated = validateRoutingConfig(readRoutingConfigFile(configPath));
  const interopPath = assertFallbackInterop();
  process.stdout.write(
    canonicalJson({
      schemaVersion: 1,
      kind: 'evavo-agent-capability-routing-check-v1',
      status: 'passed',
      configPath: path.relative(root, configPath).replaceAll(path.sep, '/'),
      supplementalWorkstationInterop: path.relative(root, interopPath).replaceAll(path.sep, '/'),
      desktopCommanderRole: 'external-fallback-only',
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
