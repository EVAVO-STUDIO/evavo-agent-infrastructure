import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policy = JSON.parse(readFileSync(new URL("../config/zero-cost-local-execution-recovery.json", import.meta.url), "utf8"));

test("Agent Infrastructure delegates workstation recovery to Local Storage", () => {
  assert.equal(policy.schemaVersion, 3);
  assert.equal(policy.kind, "evavo-zero-cost-local-execution-recovery");
  assert.equal(policy.canonical, true);
  assert.equal(policy.workstationRecoveryOwner, "EVAVO-STUDIO/evavo-local-storage");
  assert.equal(policy.mcpOwner, "EVAVO-STUDIO/evavo-agent-infrastructure");
  assert.equal(policy.structuredExecutionOwner, "EVAVO-STUDIO/evavo-local-compute");
  assert.equal(policy.developmentConsumer, "EVAVO-STUDIO/evavo-development-studio");
  assert.equal(policy.controlTransport, "github-issues-https");
  assert.equal(policy.computePlane, "windows-scheduled-tasks");
  assert.equal(policy.independentLogonTrigger, "HKCU-Run");
});

test("Agent Infrastructure recognizes independent logon recovery", () => {
  assert.equal(policy.logonGuardian, "scripts/Install-EvavoZeroCostLogonGuardianV2.ps1");
  assert.equal(policy.recoverySelection.managedCheckoutOrder.length, 3);
  assert.match(policy.recoverySelection.managedCheckoutOrder[2], /zero-cost-logon-guardian/);
  assert.equal(policy.automation.logonGuardianRegistryValue, "EVAVOZeroCostLogonGuardian");
  assert.equal(policy.automation.logonGuardianIndependentOfTaskScheduler, true);
  assert.equal(policy.automation.logonGuardianMayRecreateScheduledTasks, true);
  assert.equal(policy.truthBoundary.logonGuardianInstalledMeansMailboxRecovered, false);
});

test("Agent Infrastructure recognizes the physically accepted REST v5 recovery plane", () => {
  assert.equal(policy.preferredLiveExecutionPlane, "accepted-loopback-rest-executor-v5");
  assert.equal(policy.restExecutor.version, "5.0.0");
  assert.equal(policy.restExecutor.apiRevisionMinimum, 2);
  assert.equal(policy.restExecutor.acceptedRuntimeGitBlobSha, "ccded7de01f973187eff3f533bba94cc23b03bf2");
  assert.equal(policy.restExecutor.loopbackOnly, true);
  assert.equal(policy.restExecutor.freshHealthRequired, true);
  assert.equal(policy.restExecutor.fixedPurposeRecoveryOnly, true);
  assert.equal(policy.restExecutor.callerCommandAcceptedForRecovery, false);
  assert.equal(policy.restExecutor.mailboxRequired, false);
  assert.equal(policy.restExecutor.historicalAcceptanceIsCurrentReachability, false);
  assert.equal(policy.truthBoundary.restBootstrapMeansMailboxRecovered, false);
});

test("Agent Infrastructure recovery remains zero-cost and receipt-bound", () => {
  assert.equal(policy.automation.recoveryTask, "EVAVO Zero Cost Worker Recovery");
  assert.equal(policy.automation.updaterTask, "EVAVO Zero Cost Trusted Updater");
  assert.equal(policy.automation.restExecutorTask, "EVAVO REST Executor v5");
  assert.equal(policy.automation.mutualRecovery, true);
  assert.equal(policy.automation.managementReceiverMayUseAcceptedRestExecutorFallback, true);
  assert.equal(policy.automation.restBootstrapMustBeFollowedByWorkerRecoveryReceipt, true);
  assert.equal(policy.automation.developmentCheckoutRequiredAfterEstablishment, false);
  assert.equal(policy.automation.githubActionsRequired, false);
  assert.equal(policy.automation.selfHostedActionsRunnerRequired, false);
  assert.equal(policy.authority.mcpMayReimplementWorkerRecovery, false);
  assert.equal(policy.authority.mcpMayExposeGenericRestExecutorCommandAsNormalRecovery, false);
  assert.equal(policy.truthBoundary.machineReceiptRequiredForPhysicalWork, true);
});
