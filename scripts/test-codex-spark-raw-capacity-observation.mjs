#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const compiler = path.join(root, "scripts", "compile-codex-spark-raw-capacity-observation.mjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-raw-capacity-"));

function invoke(value) {
  const file = path.join(temporary, `receipt-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const result = spawnSync(process.execPath, [compiler, file], { cwd: root, encoding: "utf8", shell: false });
  let receipt = null;
  if (result.status === 0) receipt = JSON.parse(result.stdout);
  return { result, receipt };
}

const now = new Date().toISOString();
try {
  let run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-worker-run-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    structuredTurnCompleted: true,
    modelTurnCompleted: true,
    exitCode: 0,
    finishedAt: now,
    paidFallbackUsed: false,
  });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.kind, "evavo-codex-spark-raw-capacity-observation-v1");
  assert.equal(run.receipt.schemaVersion, 1);
  assert.equal(run.receipt.state, "AVAILABLE");
  assert.equal(run.receipt.observationType, "successful-spark-model-turn");
  assert.equal(run.receipt.evidenceClass, "observed-not-inferred");
  assert.equal(run.receipt.maximumConcurrency, 1);
  assert.equal(run.receipt.failedWorkerTurnTreatedAsDispatchableCapacity, false);
  assert.equal(run.receipt.wildcardClassificationKindAccepted, false);

  run = invoke({
    schemaVersion: 2,
    kind: "evavo-codex-worker-result-classification-v2",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    capacityState: "EXHAUSTED",
    sourceExitCode: 1,
    structuredTurnCompleted: false,
    completionEvidenceConsistent: true,
    observedAt: now,
    paidFallbackUsed: false,
  });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.state, "EXHAUSTED");
  assert.equal(run.receipt.observationType, "explicit-non-dispatchable-result-classification");

  run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-worker-result-classification-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    capacityState: "EXHAUSTED",
    sourceExitCode: 0,
    structuredTurnCompleted: true,
    observedAt: now,
    paidFallbackUsed: false,
  });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.state, "AVAILABLE");
  assert.equal(run.receipt.observationType, "verified-successful-result-classification");

  run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-worker-capacity-classification-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    state: "DEGRADED",
    maximumConcurrency: 1,
    observedAt: now,
    paidFallbackUsed: false,
  });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.state, "DEGRADED");
  assert.equal(run.receipt.observationType, "explicit-independent-capacity-classification");

  run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-worker-run-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    structuredTurnCompleted: false,
    modelTurnCompleted: false,
    exitCode: 1,
    capacityState: "DEGRADED",
    finishedAt: now,
    paidFallbackUsed: false,
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /cannot become dispatchable AVAILABLE or DEGRADED/i);

  run = invoke({
    schemaVersion: 2,
    kind: "evavo-codex-worker-result-classification-v2",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    capacityState: "AVAILABLE",
    sourceExitCode: 2,
    structuredTurnCompleted: true,
    completionEvidenceConsistent: false,
    observedAt: now,
    paidFallbackUsed: false,
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /cannot become dispatchable AVAILABLE or DEGRADED/i);

  run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-worker-run-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    structuredTurnCompleted: false,
    modelTurnCompleted: false,
    exitCode: 1,
    finishedAt: now,
    paidFallbackUsed: false,
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /cannot infer capacity/i);

  run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-worker-fake-classification-v9",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    capacityState: "AVAILABLE",
    observedAt: now,
    paidFallbackUsed: false,
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /Only exact admitted|cannot provide raw Spark capacity/i);

  run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-worker-capability-probe-v1",
    eligibleForWorkerDispatch: true,
    observedAt: now,
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /non-capacity evidence|cannot provide raw Spark capacity/i);

  run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-worker-result-classification-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    capacityState: "EXHAUSTED",
    sourceExitCode: 1,
    structuredTurnCompleted: false,
    observedAt: now,
    paidFallbackUsed: true,
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /Paid-fallback evidence/i);

  run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-worker-result-classification-v1",
    routeId: "codex-spark-pro",
    modelPreference: "another-model",
    capacityClass: "included-consumer",
    capacityState: "EXHAUSTED",
    sourceExitCode: 1,
    structuredTurnCompleted: false,
    observedAt: now,
    paidFallbackUsed: false,
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /different model/i);

  run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-spark-account-status-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    state: "AVAILABLE",
    observedAt: now,
    observedBy: "unreviewed-scraper",
    paidFallbackUsed: false,
  });
  assert.notEqual(run.result.status, 0);
  assert.match(run.result.stderr, /unadmitted observation source/i);

  console.log("Codex Spark raw-capacity observation tests passed.");
  console.log("- a verified successful Spark turn can prove availability while retaining the v1 receipt identity");
  console.log("- non-dispatchable result classifications are preserved and successful legacy classifier receipts are repaired");
  console.log("- failed worker/result receipts cannot become AVAILABLE or DEGRADED capacity");
  console.log("- independent exact capacity classifications can still deliberately report DEGRADED");
  console.log("- wildcard classification kinds, capability promotion, paid fallback, model mismatch and unreviewed account scraping fail closed");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
