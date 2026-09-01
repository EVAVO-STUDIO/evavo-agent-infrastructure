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
  assert.equal(run.receipt.state, "AVAILABLE");
  assert.equal(run.receipt.observationType, "successful-spark-model-turn");
  assert.equal(run.receipt.evidenceClass, "observed-not-inferred");
  assert.equal(run.receipt.maximumConcurrency, 1);

  run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-worker-result-classification-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    capacityState: "EXHAUSTED",
    observedAt: now,
    paidFallbackUsed: false,
  });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.state, "EXHAUSTED");

  run = invoke({
    schemaVersion: 1,
    kind: "evavo-codex-worker-capacity-classification-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    state: "RATE_LIMITED",
    observedAt: now,
    paidFallbackUsed: false,
  });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.state, "RATE_LIMITED");

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
    capacityState: "AVAILABLE",
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
    capacityState: "AVAILABLE",
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
  console.log("- a successful Spark turn can prove availability");
  console.log("- explicit exhaustion/rate-limit classifications are preserved");
  console.log("- capability, authentication and physical acceptance cannot be promoted into quota evidence");
  console.log("- incomplete turns, paid fallback, model mismatch and unreviewed account scraping fail closed");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
