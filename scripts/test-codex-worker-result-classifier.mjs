#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { classifyCodexSparkCapacityObservation } from "./codex-spark-capacity-observation-core.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-codex-result-"));
const classify = (document) => {
  const source = path.join(dir, "result.json");
  fs.writeFileSync(source, JSON.stringify(document));
  const result = spawnSync(process.execPath, ["scripts/classify-codex-worker-result.mjs", source], {encoding:"utf8", shell:false});
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const observe = (source) => classifyCodexSparkCapacityObservation({
  source,
  sourceSha256: "a".repeat(64),
});

try {
  let result = classify({exitCode:0, modelTurnCompleted:true, stdout:"done", routeId:"codex-spark-pro"});
  assert.equal(result.capacityState, "AVAILABLE");
  assert.equal(result.workDecision, "PROCESS_WORKER_RESULT");
  assert.equal(result.structuredTurnCompleted, true);
  assert.equal(result.completionEvidenceConsistent, true);
  assert.equal(result.paidFallbackUsed, false);

  result = classify({
    exitCode:0,
    modelTurnCompleted:true,
    stdout:"Added tests covering usage limit and rate limit handling. Try again after is now parsed safely.",
  });
  assert.equal(result.capacityState, "AVAILABLE");
  assert.equal(result.workDecision, "PROCESS_WORKER_RESULT");
  assert.equal(result.category, "completed-model-turn");
  assert.equal(result.observedResetHint, null);
  assert.equal(result.structuredTurnCompleted, true);

  result = classify({exitCode:1, modelTurnCompleted:false, stderr:"You have reached your usage limit. Try again after 04:10."});
  assert.equal(result.capacityState, "EXHAUSTED");
  assert.equal(result.workDecision, "RETAIN_READY_JOB");
  assert.equal(result.structuredTurnCompleted, false);
  assert.equal(result.exactUsageRemainingKnown, false);

  result = classify({exitCode:1, modelTurnCompleted:false, stderr:"Too many requests; retry after 30 seconds"});
  assert.equal(result.capacityState, "RATE_LIMITED");
  assert.equal(result.workDecision, "BACKOFF_RETAIN_READY_JOB");
  assert.equal(result.structuredTurnCompleted, false);

  result = classify({exitCode:1, modelTurnCompleted:false, stderr:"Authentication required. Sign in to Codex."});
  assert.equal(result.capacityState, "AUTH_REQUIRED");
  assert.equal(result.structuredTurnCompleted, false);

  result = classify({exitCode:2, modelTurnCompleted:false, stderr:"unexpected runtime transport error"});
  assert.equal(result.capacityState, "OFFLINE");
  assert.equal(result.workDecision, "REVIEW_RUNTIME_FAILURE");
  assert.equal(result.structuredTurnCompleted, false);
  assert.equal(result.failedWorkerTurnTreatedAsDispatchableDegradedCapacity, false);

  result = classify({exitCode:2, modelTurnCompleted:true, stdout:"protocol claimed completion"});
  assert.equal(result.capacityState, "OFFLINE");
  assert.equal(result.workDecision, "REVIEW_RUNTIME_FAILURE");
  assert.equal(result.sourceModelTurnCompletedClaim, true);
  assert.equal(result.structuredTurnCompleted, false);
  assert.equal(result.completionEvidenceConsistent, false);
  assert.equal(result.failedWorkerTurnTreatedAsDispatchableDegradedCapacity, false);

  result = classify({modelTurnCompleted:true, stdout:"completion without process exit evidence"});
  assert.equal(result.capacityState, "OFFLINE");
  assert.equal(result.workDecision, "RETAIN_READY_JOB");
  assert.equal(result.structuredTurnCompleted, false);
  assert.equal(result.completionEvidenceConsistent, false);

  let observation = observe({
    kind: "evavo-codex-worker-run-v1",
    finishedAt: "2026-09-01T08:00:00.000Z",
    exitCode: 1,
    modelTurnCompleted: true,
    structuredTurnCompleted: true,
    capacityState: "AVAILABLE",
    paidFallbackUsed: false,
  });
  assert.equal(observation.state, "OFFLINE");
  assert.equal(observation.reason, "FAILED_WORKER_DISPATCHABLE_CAPACITY_CLAIM_REJECTED");
  assert.equal(observation.contradictoryAvailableClaimRejected, true);
  assert.equal(observation.failedWorkerDispatchableClaimRejected, true);

  observation = observe({
    kind: "evavo-codex-worker-result-classification-v1",
    observedAt: "2026-09-01T08:00:00.000Z",
    capacityState: "EXHAUSTED",
    sourceExitCode: 0,
    structuredTurnCompleted: true,
    paidFallbackUsed: false,
  });
  assert.equal(observation.state, "AVAILABLE");
  assert.equal(observation.reason, "VERIFIED_STRUCTURED_TURN_COMPLETED");
  assert.equal(observation.completionEvidenceVerified, true);

  observation = observe({
    kind: "evavo-codex-worker-result-classification-v2",
    observedAt: "2026-09-01T08:00:00.000Z",
    capacityState: "AVAILABLE",
    sourceExitCode: 2,
    structuredTurnCompleted: true,
    completionEvidenceConsistent: false,
    paidFallbackUsed: false,
  });
  assert.equal(observation.state, "OFFLINE");
  assert.equal(observation.failedWorkerDispatchableClaimRejected, true);

  observation = observe({
    kind: "evavo-codex-worker-result-classification-v1",
    observedAt: "2026-09-01T08:00:00.000Z",
    capacityState: "DEGRADED",
    sourceExitCode: 2,
    structuredTurnCompleted: false,
    paidFallbackUsed: false,
  });
  assert.equal(observation.state, "OFFLINE");
  assert.equal(observation.failedWorkerDispatchableClaimRejected, true);
  assert.equal(observation.failedWorkerTurnTreatedAsDispatchableDegradedCapacity, false);

  observation = observe({
    kind: "independent-capacity-observation",
    observedAt: "2026-09-01T08:00:00.000Z",
    capacityState: "DEGRADED",
    paidFallbackUsed: false,
  });
  assert.equal(observation.state, "DEGRADED");
  assert.equal(observation.reason, "EXPLICIT_CAPACITY_CLASSIFICATION");

  console.log("Codex worker result classifier tests passed.");
  console.log("- verified successful completion is authoritative over incidental error-like text");
  console.log("- nonzero or missing exit evidence cannot be promoted by modelTurnCompleted=true");
  console.log("- failed worker turns remain OFFLINE and cannot become dispatchable DEGRADED capacity");
  console.log("- DEGRADED remains available to independent capacity telemetry rather than failed worker receipts");
  console.log("- mandatory classifier governance also rejects contradictory Spark capacity observations");
} finally {
  fs.rmSync(dir, {recursive:true, force:true});
}
