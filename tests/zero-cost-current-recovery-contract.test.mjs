import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const config = JSON.parse(fs.readFileSync('config/zero-cost-local-execution-recovery.json', 'utf8'));

test('zero-cost recovery names the local-first Current/V3 execution plane', () => {
  assert.equal(config.schemaVersion, 4);
  assert.equal(config.localComputeQueueBootstrap, 'BOOTSTRAP-EVAVO-CURRENT-QUEUE-PLANE-LOCAL.ps1');
  assert.equal(config.localComputeAllFabricBootstrap, 'BOOTSTRAP-EVAVO-ALL-LOCAL-FABRIC-CURRENT-V3.ps1');
  assert.equal(config.localComputeFetchBootstrap, 'BOOTSTRAP-EVAVO-ALL-LOCAL-FABRIC-FROM-FETCH.cmd');
  assert.equal(config.localComputeOriginCurrentRunner, 'RUN-EVAVO-ALL-LOCAL-FABRIC-ORIGIN-CURRENT-V3.ps1');
  assert.equal(config.queuePlaneRecoveredBeforeWiderRollout, true);
  assert.equal(config.recoverySelection.legacyNormalQueueAuthoritative, false);
});

test('machine liveness is receipt-based rather than task-presence based', () => {
  assert.equal(config.automation.currentQueueFreshInvocationReceiptRequired, true);
  assert.equal(config.automation.taskPresenceIsNotLivenessProof, true);
  assert.equal(config.truthBoundary.scheduledTaskPresenceMeansExecutionPlaneLive, false);
  assert.equal(config.truthBoundary.scheduledTaskStartAcceptedMeansJobRan, false);
  assert.equal(config.truthBoundary.currentQueueFreshInvocationReceiptRequiredForLiveness, true);
  assert.equal(config.truthBoundary.machineReceiptRequiredForPhysicalWork, true);
});

test('receipt truth forbids blind replay after uncertain effects', () => {
  assert.equal(config.authority.automaticReplayAfterEffectMayHaveCommitted, false);
  assert.equal(config.truthBoundary.physicalPostconditionRequiredForVerifiedCommit, true);
  assert.equal(config.truthBoundary.terminalReceiptFailureMayNotInvertVerifiedPhysicalSuccess, true);
  assert.equal(config.truthBoundary.uncertainEffectRequiresReconciliationBeforeRetry, true);
});

test('zero-cost recovery never requires hosted actions or Vercel', () => {
  assert.equal(config.automation.githubActionsRequired, false);
  assert.equal(config.automation.selfHostedActionsRunnerRequired, false);
  assert.equal(config.automation.vercelRequired, false);
  assert.equal(config.remoteAccess.githubActionsRequiredForRemoteAccess, false);
  assert.equal(config.remoteAccess.vercelRequiredForRemoteAccess, false);
  assert.equal(config.authority.forcePush, false);
  assert.equal(config.authority.resetHard, false);
  assert.equal(config.authority.gitClean, false);
});
