import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const health = JSON.parse(fs.readFileSync('config/workstation-control-health-v1.json', 'utf8'));
const local = health.components.find((entry) => entry.id === 'local-compute');
const fallback = health.components.find((entry) => entry.id === 'desktop-commander-fallback');

test('workstation health models normal and scheduled control lanes truthfully', () => {
  assert.equal(health.schemaVersion, 1);
  assert.equal(health.kind, 'evavo-workstation-control-health-v1');
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

test('fallback and single-lane failures cannot define MSI machine state', () => {
  assert.equal(health.observedState.singleLaneFailureImpliesMachineOffline, false);
  assert.equal(health.observedState.remoteDesktopCommanderMachineStateInferenceAllowed, false);
  assert.ok(fallback);
  assert.equal(fallback.machineHealthAuthority, false);
  assert.equal(fallback.localVerificationRequirement, false);
  assert.equal(fallback.visualInspectionRequirement, false);
  assert.equal(fallback.visualQaRequirement, false);
});

test('stale control resident terminology cannot return to canonical health', () => {
  const raw = fs.readFileSync('config/workstation-control-health-v1.json', 'utf8');
  assert.doesNotMatch(raw, /hkcu_run_python_control/u);
  assert.doesNotMatch(raw, /persistent control resident/u);
  assert.match(raw, /scheduled-task-isolated-control-namespace/u);
});
