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

function assertVisualInspectionRouting() {
  const routingPath = path.join(root, 'config', 'agent-capability-routing-v1.json');
  const routing = parseStrictJson(fs.readFileSync(routingPath, 'utf8'));
  const visualName = 'agent-capability-routes-visual-v1.json';
  const routeFragments = routing?.fragments?.routes;
  if (!Array.isArray(routeFragments) || !routeFragments.includes(visualName)) {
    throw new Error('EVAVO_VISUAL_INSPECTION_ROUTING: canonical routing must load the visual route fragment');
  }

  const visualPath = path.join(root, 'config', visualName);
  const routes = parseStrictJson(fs.readFileSync(visualPath, 'utf8'));
  if (!Array.isArray(routes)) {
    throw new Error('EVAVO_VISUAL_INSPECTION_ROUTING: visual route fragment must be an array');
  }
  const browser = routes.find((route) => route?.capability === 'browser.visual-inspect');
  if (!browser) throw new Error('EVAVO_VISUAL_INSPECTION_ROUTING: browser.visual-inspect route is required');
  const ids = (browser.strategies ?? []).map((strategy) => strategy?.id);
  if (ids[0] !== 'browser-visual-inspect-computer-agent-playwright') {
    throw new Error('EVAVO_VISUAL_INSPECTION_ROUTING: native Playwright must be first visual inspection strategy');
  }
  if (!ids.includes('browser-visual-inspect-visual-review-mcp')) {
    throw new Error('EVAVO_VISUAL_INSPECTION_ROUTING: Visual Review MCP must be available to ChatGPT Pro');
  }
  if (!ids.includes('browser-visual-inspect-typed-relay') || !ids.includes('browser-visual-inspect-issue-queue-bootstrap')) {
    throw new Error('EVAVO_VISUAL_INSPECTION_ROUTING: typed relay and issue-queue bootstrap fallbacks are required');
  }
  if (ids.some((id) => typeof id === 'string' && id.includes('desktop-commander'))) {
    throw new Error('EVAVO_VISUAL_INSPECTION_ROUTING: Desktop Commander must not be a canonical visual inspection strategy');
  }
  const truth = browser.truth ?? {};
  if (truth.desktopCommanderRequired !== false || truth.desktopCommanderAuthoritative !== false) {
    throw new Error('EVAVO_VISUAL_INSPECTION_ROUTING: Desktop Commander must remain optional and non-authoritative');
  }
  if (truth.msiConnectorRequired !== false || truth.connectorFailureCanImplyMachineOffline !== false) {
    throw new Error('EVAVO_VISUAL_INSPECTION_ROUTING: connector availability must not define visual capability or machine state');
  }
  if (truth.captureReceiptRequired !== true || truth.screenshotSha256Required !== true || truth.pixelBytesRequiredForPixelInspection !== true) {
    throw new Error('EVAVO_VISUAL_INSPECTION_ROUTING: pixel inspection must require capture receipt, digest and pixel bytes');
  }
  return visualPath;
}

try {
  const configPath = path.resolve(argument('--config', path.join(root, 'config', 'agent-capability-routing-v1.json')));
  const validated = validateRoutingConfig(readRoutingConfigFile(configPath));
  const interopPath = assertFallbackInterop();
  const visualPath = assertVisualInspectionRouting();
  process.stdout.write(
    canonicalJson({
      schemaVersion: 1,
      kind: 'evavo-agent-capability-routing-check-v1',
      status: 'passed',
      configPath: path.relative(root, configPath).replaceAll(path.sep, '/'),
      supplementalWorkstationInterop: path.relative(root, interopPath).replaceAll(path.sep, '/'),
      visualInspectionRouting: path.relative(root, visualPath).replaceAll(path.sep, '/'),
      desktopCommanderRole: 'external-fallback-only',
      browserVisualInspectionAuthority: 'evavo-computer-agent',
      browserVisualInspectionRequiresDesktopCommander: false,
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
