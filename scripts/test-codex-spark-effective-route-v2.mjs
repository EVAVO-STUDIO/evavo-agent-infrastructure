#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const planner = path.join(root, "scripts", "plan-codex-spark-effective-route-v2.mjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-effective-route-v2-"));
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
const activeRoute = {
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
const baseCapacity = {
  schemaVersion: 1,
  kind: "evavo-worker-capacity-status-v1",
  ok: true,
  observedAt: new Date().toISOString(),
  eligible: true,
  effectiveState: "AVAILABLE",
  rawState: "AVAILABLE",
  routes: [activeRoute],
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
  let run = invoke(work, baseCapacity);
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.schemaVersion, 2);
  assert.equal(run.receipt.eligible, true);
  assert.equal(run.receipt.decision, "DISPATCH_ELIGIBLE");
  assert.equal(run.receipt.workerClass, "test-generation");
  assert.deepEqual(run.receipt.admittedWorkerClasses, ["test-generation"]);
  assert.equal(run.receipt.maximumConcurrency, 1);
  assert.equal(run.receipt.supervisedAcceptanceSha256, activeRoute.supervisedAcceptanceSha256);
  assert.match(run.receipt.effectiveCapacityStatusSha256, /^[0-9a-f]{64}$/);

  const exhaustedRoute = {
    ...activeRoute,
    state: "EXHAUSTED",
    rawState: "EXHAUSTED",
    eligible: false,
    admittedWorkerClasses: [],
    workerClasses: [],
    maximumConcurrency: 0,
    maximumAutomaticConcurrency: 0,
  };
  run = invoke(work, {
    ...baseCapacity,
    eligible: false,
    effectiveState: "EXHAUSTED",
    rawState: "EXHAUSTED",
    routes: [exhaustedRoute],
  });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.eligible, false);
  assert.equal(run.receipt.decision, "RETAIN_READY_JOB");
  assert.equal(run.receipt.reason, "SPARK_EFFECTIVE_STATE_EXHAUSTED");

  const limitedRoute = { ...exhaustedRoute, state: "RATE_LIMITED", rawState: "RATE_LIMITED" };
  run = invoke(work, {
    ...baseCapacity,
    eligible: false,
    effectiveState: "RATE_LIMITED",
    rawState: "RATE_LIMITED",
    routes: [limitedRoute],
  });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.reason, "SPARK_EFFECTIVE_STATE_RATE_LIMITED");

  run = invoke(work, {
    schemaVersion: 1,
    kind: "evavo-codex-spark-raw-capacity-observation-v1",
    state: "AVAILABLE",
  });
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("canonical assembled effective-capacity")));

  run = invoke(work, { ...baseCapacity, observedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.eligible, false);
  assert.equal(run.receipt.reason, "SPARK_EFFECTIVE_CAPACITY_STATUS_STALE");

  run = invoke({ ...work, workerClass: "fast-coding" }, baseCapacity);
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("only permits test-generation")));

  run = invoke(work, { ...baseCapacity, routes: [{ ...activeRoute, admittedWorkerClasses: ["test-generation", "fast-coding"] }] });
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("unapproved worker classes")));

  run = invoke(work, { ...baseCapacity, routes: [{ ...activeRoute, maximumConcurrency: 2, maximumAutomaticConcurrency: 2 }] });
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("concurrency one")));

  run = invoke(work, { ...baseCapacity, paidFallbackUsed: true });
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("zero-paid-fallback")));

  run = invoke(work, { ...baseCapacity, capacityInferredFromTransport: true });
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("infers quota")));

  const inconsistent = { ...baseCapacity, eligible: false };
  run = invoke(work, inconsistent);
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.errors.some((entry) => entry.includes("disagrees on effective eligibility")));

  console.log("Codex Spark effective-route v2 tests passed.");
  console.log("- AVAILABLE requires Test Builder admission at concurrency one");
  console.log("- EXHAUSTED and RATE_LIMITED remain valid non-executable states that retain READY work");
  console.log("- raw probes, stale status, unadmitted classes, inconsistent eligibility and paid fallback fail closed");
  console.log("- route plans remain bound to exact acceptance, capability, physical-verification, admission and raw-capacity evidence");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
