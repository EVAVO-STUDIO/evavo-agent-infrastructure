#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const planner = path.join(root, "scripts", "plan-codex-spark-capacity-heartbeat.mjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-heartbeat-"));
const write = (name, value) => {
  const file = path.join(temporary, `${name}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
};
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const baseQueue = {
  schemaVersion: 1,
  kind: "evavo-autonomous-work-exchange-status-v1",
  observedAt: new Date().toISOString(),
  readyCount: 3,
  leasedCount: 0,
  runningCount: 0,
};
const hashes = {
  supervisedAcceptanceSha256: "1".repeat(64),
  codexCapabilityReceiptSha256: "2".repeat(64),
  physicalAcceptanceVerificationSha256: "3".repeat(64),
  routeAdmissionSha256: "4".repeat(64),
  rawCapacityObservationSha256: "5".repeat(64),
};
function capacity({ effectiveState = "UNKNOWN", rawState = "AVAILABLE", rawFresh = false, rawObservedAt = minutesAgo(20), eligible = false, gatePatch = {}, paidFallbackUsed = false } = {}) {
  return {
    schemaVersion: 1,
    kind: "evavo-worker-capacity-status-v1",
    ok: true,
    observedAt: new Date().toISOString(),
    routeId: "codex-spark-pro",
    eligible,
    effectiveState,
    rawState,
    routes: [{
      routeId: "codex-spark-pro",
      modelPreference: "gpt-5.3-codex-spark",
      capacityClass: "included-consumer",
      state: effectiveState,
      rawState,
      eligible,
      admittedWorkerClasses: eligible ? ["test-generation"] : [],
      maximumConcurrency: eligible ? 1 : 0,
      maximumAutomaticConcurrency: eligible ? 1 : 0,
      paidFallbackAllowed: false,
      paidFallbackUsed: false,
      ...hashes,
    }],
    evidence: {
      rawCapacity: { state: rawState, observedAt: rawObservedAt, fresh: rawFresh },
      transport: { eligible: true, fresh: true },
      authentication: { accepted: true, fresh: true },
      physicalAdmission: { accepted: true, supervisedCleanupProven: true, fresh: true },
      routeAdmission: { accepted: true, fresh: true },
      ...gatePatch,
    },
    capacityInferredFromTransport: false,
    capacityInferredFromAuthentication: false,
    capacityInferredFromPhysicalAcceptance: false,
    paidFallbackAllowed: false,
    paidFallbackUsed,
  };
}
function invoke(queueValue, capacityValue, previousValue = null) {
  const args = [write("queue", queueValue), write("capacity", capacityValue)];
  if (previousValue) args.push(write("previous", previousValue));
  const result = spawnSync(process.execPath, [planner, ...args], { cwd: root, encoding: "utf8", shell: false });
  const text = String(result.status === 1 ? result.stderr : result.stdout).trim();
  return { result, receipt: JSON.parse(text) };
}

try {
  let run = invoke({ ...baseQueue, readyCount: 0 }, capacity());
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.eligible, false);
  assert.equal(run.receipt.decision, "NO_PROBE_NO_READY_WORK");

  run = invoke(baseQueue, capacity({ effectiveState: "AVAILABLE", rawState: "AVAILABLE", rawFresh: true, rawObservedAt: new Date().toISOString(), eligible: true }));
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.decision, "NO_PROBE_CAPACITY_FRESH");
  assert.equal(run.receipt.modelTurnPerformed, false);

  run = invoke(baseQueue, capacity());
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.eligible, true);
  assert.equal(run.receipt.decision, "PROBE_ELIGIBLE");
  assert.equal(run.receipt.reason, "RAW_CAPACITY_STALE_OR_UNKNOWN_WITH_READY_WORK");
  assert.equal(run.receipt.maximumModelTurns, 1);
  assert.equal(run.receipt.fixtureRequirements.remoteCount, 0);
  assert.equal(run.receipt.fixtureRequirements.repositoryMutationAuthority, false);

  run = invoke(baseQueue, capacity({ rawState: "EXHAUSTED", rawObservedAt: minutesAgo(30) }));
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.eligible, false);
  assert.equal(run.receipt.decision, "DEFER_BACKOFF");
  assert.equal(run.receipt.reason, "RAW_CAPACITY_EXHAUSTED");
  assert.ok(run.receipt.nextAllowedAt);

  run = invoke(baseQueue, capacity({ rawState: "RATE_LIMITED", rawObservedAt: minutesAgo(40) }));
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.eligible, true);
  assert.equal(run.receipt.reason, "BACKOFF_ELAPSED_AND_READY_WORK_EXISTS");

  run = invoke(baseQueue, capacity({ gatePatch: { authentication: { accepted: false, fresh: true } } }));
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.eligible, false);
  assert.equal(run.receipt.decision, "DEFER_NON_CAPACITY_GATE");
  assert.equal(run.receipt.nonCapacityGates.authentication, false);

  run = invoke(baseQueue, capacity(), {
    schemaVersion: 1,
    kind: "evavo-codex-spark-capacity-probe-state-v1",
    routeId: "codex-spark-pro",
    lastAttemptAt: minutesAgo(5),
    lastResultState: "UNKNOWN",
    inFlight: false,
    paidFallbackUsed: false,
  });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.eligible, false);
  assert.equal(run.receipt.decision, "DEFER_MINIMUM_INTERVAL");

  run = invoke(baseQueue, capacity(), {
    schemaVersion: 1,
    kind: "evavo-codex-spark-capacity-probe-state-v1",
    routeId: "codex-spark-pro",
    lastAttemptAt: minutesAgo(60),
    inFlight: true,
    paidFallbackUsed: false,
  });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.decision, "DEFER_PROBE_IN_FLIGHT");

  run = invoke(baseQueue, capacity({ paidFallbackUsed: true }));
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("zero-paid-fallback")));

  run = invoke({ ...baseQueue, observedAt: minutesAgo(20) }, capacity());
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("Work Exchange status is stale")));

  console.log("Codex Spark capacity-heartbeat tests passed.");
  console.log("- no heartbeat runs without READY work or while capacity is already fresh");
  console.log("- stale/unknown capacity may request one fixture-only turn only after every non-capacity gate is fresh");
  console.log("- rate-limit/exhaustion backoff, minimum interval and in-flight exclusion are enforced");
  console.log("- paid fallback and stale queue evidence fail closed");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
