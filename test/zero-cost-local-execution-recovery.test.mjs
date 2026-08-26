import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policy = JSON.parse(readFileSync(new URL("../config/zero-cost-local-execution-recovery.json", import.meta.url), "utf8"));

test("Agent Infrastructure delegates workstation recovery to Local Storage", () => {
  assert.equal(policy.kind, "evavo-zero-cost-local-execution-recovery");
  assert.equal(policy.canonical, true);
  assert.equal(policy.workstationRecoveryOwner, "EVAVO-STUDIO/evavo-local-storage");
  assert.equal(policy.mcpOwner, "EVAVO-STUDIO/evavo-agent-infrastructure");
  assert.equal(policy.structuredExecutionOwner, "EVAVO-STUDIO/evavo-local-compute");
  assert.equal(policy.developmentConsumer, "EVAVO-STUDIO/evavo-development-studio");
  assert.equal(policy.controlTransport, "github-issues-https");
  assert.equal(policy.computePlane, "windows-scheduled-tasks");
});

test("Agent Infrastructure recovery is zero-cost and mutually managed", () => {
  assert.deepEqual(policy.recoverySelection.managedCheckoutOrder.length, 2);
  assert.equal(policy.automation.recoveryTask, "EVAVO Zero Cost Worker Recovery");
  assert.equal(policy.automation.updaterTask, "EVAVO Zero Cost Trusted Updater");
  assert.equal(policy.automation.mutualRecovery, true);
  assert.equal(policy.automation.eitherManagedPeerMaySupplyManagementReceiver, true);
  assert.equal(policy.automation.developmentCheckoutRequiredAfterEstablishment, false);
  assert.equal(policy.automation.githubActionsRequired, false);
  assert.equal(policy.automation.selfHostedActionsRunnerRequired, false);
  assert.equal(policy.authority.mcpMayReimplementWorkerRecovery, false);
  assert.equal(policy.truthBoundary.machineReceiptRequiredForPhysicalWork, true);
});
