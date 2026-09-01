#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const planner = path.join(root, "scripts", "plan-codex-spark-effective-route.mjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-effective-route-"));
const write = (name, value) => {
  const file = path.join(temporary, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
};
const sha = (character) => character.repeat(64);
const work = {
  schemaVersion: 1,
  kind: "evavo-autonomous-improvement-work-item-v1",
  id: "work:test-generation:fixture",
  lifecycleState: "READY",
  workerClass: "test-generation",
  capacityClass: "included-consumer",
  paidFallbackAllowed: false,
  repository: "EVAVO-STUDIO/example",
  sourceRevision: "a".repeat(40),
};
const route = {
  routeId: "codex-spark-pro",
  modelPreference: "gpt-5.3-codex-spark",
  capacityClass: "included-consumer",
  state: "AVAILABLE",
  rawState: "AVAILABLE",
  eligible: true,
  admittedWorkerClasses: ["test-generation"],
  workerClasses: ["test-generation"],
  maximumConcurrency: 1,
  maximumAutomaticConcurrency: 1,
  paidFallbackAllowed: false,
  paidFallbackUsed: false,
  supervisedAcceptanceSha256: sha("1"),
  codexCapabilityReceiptSha256: sha("2"),
  physicalAcceptanceVerificationSha256: sha("3"),
  routeAdmissionSha256: sha("4"),
  rawCapacityObservationSha256: sha("5"),
};
const capacity = {
  schemaVersion: 1,
  kind: "evavo-worker-capacity-status-v1",
  ok: true,
  observedAt: new Date().toISOString(),
  eligible: true,
  effectiveState: "AVAILABLE",
  rawState: "AVAILABLE",
  routes: [route],
  capacityInferredFromTransport: false,
  capacityInferredFromAuthentication: false,
  capacityInferredFromPhysicalAcceptance: false,
  paidFallbackAllowed: false,
  paidFallbackUsed: false,
};

function invoke(workValue, capacityValue) {
  const workFile = write(`work-${Math.random().toString(16).slice(2)}.json`, workValue);
  const capacityFile = write(`capacity-${Math.random().toString(16).slice(2)}.json`, capacityValue);
  const result = spawnSync(process.execPath, [planner, workFile, capacityFile], { cwd: root, encoding: "utf8", shell: false });
  const text = String(result.status === 1 ? result.stderr : result.stdout).trim();
  return { result, receipt: JSON.parse(text) };
}

try {
  let run = invoke(work, capacity);
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.eligible, true);
  assert.equal(run.receipt.decision, "DISPATCH_ELIGIBLE");
  assert.equal(run.receipt.workerClass, "test-generation");
  assert.deepEqual(run.receipt.admittedWorkerClasses, ["test-generation"]);
  assert.equal(run.receipt.maximumConcurrency, 1);
  assert.equal(run.receipt.supervisedAcceptanceSha256, route.supervisedAcceptanceSha256);
  assert.match(run.receipt.effectiveCapacityStatusSha256, /^[0-9a-f]{64}$/);

  run = invoke(work, {
    schemaVersion: 1,
    kind: "evavo-codex-spark-raw-capacity-observation-v1",
    state: "AVAILABLE",
  });
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("canonical assembled effective-capacity")));

  run = invoke(work, { ...capacity, observedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.eligible, false);
  assert.equal(run.receipt.decision, "RETAIN_READY_JOB");
  assert.equal(run.receipt.reason, "SPARK_EFFECTIVE_CAPACITY_STATUS_STALE");

  const exhaustedRoute = { ...route, state: "EXHAUSTED", rawState: "EXHAUSTED", eligible: false, maximumConcurrency: 0, maximumAutomaticConcurrency: 0, admittedWorkerClasses: [], workerClasses: [] };
  run = invoke(work, { ...capacity, eligible: false, effectiveState: "EXHAUSTED", rawState: "EXHAUSTED", routes: [exhaustedRoute] });
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("does not admit Test Builder") || entry.includes("concurrency one")));

  const unavailableRoute = { ...route, state: "EXHAUSTED", rawState: "EXHAUSTED", eligible: false, maximumConcurrency: 1, maximumAutomaticConcurrency: 1 };
  run = invoke(work, { ...capacity, eligible: false, effectiveState: "EXHAUSTED", rawState: "EXHAUSTED", routes: [unavailableRoute] });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.eligible, false);
  assert.equal(run.receipt.reason, "SPARK_EFFECTIVE_STATE_EXHAUSTED");

  run = invoke({ ...work, workerClass: "fast-coding" }, capacity);
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("only permits test-generation")));

  run = invoke(work, { ...capacity, routes: [{ ...route, admittedWorkerClasses: ["test-generation", "fast-coding"] }] });
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("unapproved worker classes")));

  run = invoke(work, { ...capacity, routes: [{ ...route, maximumConcurrency: 2, maximumAutomaticConcurrency: 2 }] });
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("concurrency one")));

  run = invoke(work, { ...capacity, paidFallbackUsed: true });
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("zero-paid-fallback")));

  run = invoke(work, { ...capacity, capacityInferredFromTransport: true });
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("infers quota")));

  console.log("Codex Spark effective-route tests passed.");
  console.log("- only assembled effective-capacity receipts can authorize route planning");
  console.log("- stale or exhausted capacity retains the READY job without paid fallback");
  console.log("- unadmitted worker classes, concurrency escalation and non-capacity inference fail closed");
  console.log("- route plans carry exact acceptance, capability, physical-verification, admission and raw-capacity identities");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
