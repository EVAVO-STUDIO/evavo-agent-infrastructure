import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, 'config', name), 'utf8'));

const interop = readJson('desktop-commander-interop-v1.json');
const control = readJson('control-path-policy-v1.json');

test('Desktop Commander is external fallback only', () => {
  assert.equal(interop.policy.fallbackOnly, true);
  assert.equal(interop.policy.preferNativeEvavoRoutes, true);
  assert.equal(interop.policy.desktopCommanderAvailabilityDoesNotDefineMachineHealth, true);
  assert.equal(interop.policy.desktopCommanderFailureDoesNotDefineMachineOffline, true);
  assert.equal(interop.policy.desktopCommanderIsNotRequiredForLocalVerification, true);
  assert.equal(interop.routing.canonicalBackgroundExecution, 'evavo-local-compute');
  assert.equal(interop.routing.canonicalForegroundGui, 'evavo-computer-agent');
  assert.equal(interop.routing.desktopCommanderPriority, 'after-native-evavo-routes');
});

test('Desktop Commander is ranked after all native EVAVO workstation paths', () => {
  const routes = [...control.routeOrder].sort((a, b) => a.rank - b.rank);
  const fallback = routes.find((route) => route.routeClass === 'desktop-commander-external-fallback');
  assert.ok(fallback);
  assert.equal(fallback.rank, 90);
  assert.equal(routes.at(-1).routeClass, 'desktop-commander-external-fallback');
  for (const route of routes.filter((route) => route.routeClass !== 'desktop-commander-external-fallback')) {
    assert.ok(route.rank < fallback.rank, `${route.routeClass} must outrank Desktop Commander`);
  }
});

test('single transport failure never implies machine failure', () => {
  assert.equal(control.default.singleTransportFailureIsNotMachineFailure, true);
  assert.equal(control.default.desktopCommanderIsFallbackOnly, true);
  assert.ok(control.healthRules.some((rule) => /failed transport describes that transport only/i.test(rule)));
  assert.ok(control.healthRules.some((rule) => /not required for local verification/i.test(rule)));
});
