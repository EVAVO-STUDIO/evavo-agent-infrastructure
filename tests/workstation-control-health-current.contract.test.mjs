import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const health = JSON.parse(fs.readFileSync(new URL('../config/workstation-control-health-v1.json', import.meta.url), 'utf8'));
const local = health.components.find((entry) => entry.id === 'local-compute');

test('workstation health models normal and scheduled control lanes truthfully', () => {
  assert.equal(health.schemaVersion, 1);
  assert.equal(health.kind, 'evavo-workstation-control-health-v1');
  assert.equal(health.observedState.historicalSnapshot, true);
  assert.equal(health.observedState.currentMachineAvailabilityAuthoritative, false);
  assert.equal(health.observedState.machineOnline, 'not-inferred-from-route-evidence');
  assert.equal(health.observedState.normalQueueLatestMachineTerminalEvidenceIssue, 2176);
  assert.equal(health.observedState.normalQueueLatestMachineTerminalEvidenceAt, '2026-09-05T02:40:11Z');
  assert.equal(health.observedState.normalQueueCurrentLiveness, 'unproven-after-last-terminal-receipt');
  assert.equal(health.observedState.controlQueueAuthority, 'scheduled-task-isolated-control-namespace');
  assert.equal(health.observedState.controlQueueRequestTimeoutCeilingSourceCurrentSeconds, 300);
  assert.equal(health.observedState.controlQueueStructuredToolSupportSourceCurrent, true);

  assert.ok(local);
  assert.equal(local.canonicalRuntime.normalQueueBackend, 'hkcu_run_python');
  assert.equal(local.canonicalRuntime.controlLaneAuthority, 'scheduled-task-isolated-control-namespace');
  assert.equal(local.canonicalRuntime.controlLaneRequestTimeoutCeilingSeconds, 300);
  assert.equal(local.canonicalRuntime.controlLaneStructuredToolOperationsAccepted, true);
  assert.equal(local.canonicalRuntime.queueProgressGuardianConsumesQueue, false);
  assert.equal(local.canonicalRuntime.currentQueueContinuityConsumesQueue, false);
});

test('excluded fallback and single-lane failures cannot define MSI machine state', () => {
  assert.equal(health.observedState.singleLaneFailureImpliesMachineOffline, false);
  assert.equal(health.observedState.remoteDesktopCommanderMachineStateInferenceAllowed, false);
  assert.equal(health.executionPolicy.externalDesktopCommanderEnabled, false);
  assert.equal(health.executionPolicy.externalRemoteDesktopFallbackAllowed, false);
  assert.equal(health.components.some((entry) => /desktop.?commander/i.test(entry.id)), false);
  assert.equal(health.evaluationOrder.some((id) => /desktop.?commander/i.test(id)), false);
  assert.equal(health.observedState.visualInspectionRequiresRemoteDesktopCommander, false);
  assert.equal(health.observedState.visualQaRequiresRemoteDesktopCommander, false);
});

test('the control authority stays scheduled and retired names remain forbidden only', () => {
  // Mentions in forbiddenSelfHeal explain a prohibition; they are not enabled
  // authorities. Inspect the actual authority instead of banning safety prose.
  assert.equal(local.canonicalRuntime.controlLaneAuthority, 'scheduled-task-isolated-control-namespace');
  assert.notEqual(local.canonicalRuntime.controlLaneAuthority, 'hkcu_run_python_control');
  assert.ok(local.forbiddenSelfHeal.includes('describing the control lane as hkcu_run_python_control'));
  assert.equal(health.observedState.singleLaneFailureImpliesWholeLocalComputeUnavailable, false);
});
