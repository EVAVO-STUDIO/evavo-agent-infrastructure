#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileCodexSparkCapacityStatus } from "./codex-spark-capacity-status-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "codex-spark-capacity-status-v1.json"), "utf8"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-worker-routing-"));
const bytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
const iso = (milliseconds) => new Date(milliseconds).toISOString();

try {
  const now = Date.now();
  const workPath = path.join(dir, "work.json");
  const capacityPath = path.join(dir, "capacity.json");
  const baseWork = {
    lifecycleState: "READY",
    workerClass: "test-generation",
    capacityClass: "included-consumer",
    paidFallbackAllowed: false,
    jobPriority: 90,
    repository: "EVAVO-STUDIO/example",
    sourceRevision: "a".repeat(40),
  };
  const acceptance = {
    schemaVersion: 1,
    kind: "evavo-codex-spark-safe-physical-acceptance-v1",
    supervisedAt: iso(now - 60 * 60_000),
  };
  const capability = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-capability-probe-v1",
    eligibleForWorkerDispatch: true,
    observedAt: iso(now - 30_000),
    version: "fixture",
    capabilities: {
      jsonFlag: "--json",
      modelFlag: "--model",
      sandboxFlag: "--sandbox",
      approvalFlag: "--ask-for-approval",
    },
  };
  const acceptedVerification = {
    schemaVersion: 1,
    kind: "evavo-codex-spark-safe-physical-acceptance-verification-v1",
    accepted: true,
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    workerClasses: ["test-generation"],
    maximumConcurrency: 1,
    paidFallbackAllowed: false,
    supervisedCleanupProven: true,
    errors: [],
  };

  const capacityDocument = (state = "AVAILABLE", verification = acceptedVerification) => {
    const observation = {
      schemaVersion: 1,
      kind: "evavo-codex-capacity-observation-v1",
      observedAt: iso(now - 45_000),
      routes: [{
        routeId: "codex-spark-pro",
        state,
        observedAt: iso(now - 45_000),
        paidFallbackAllowed: false,
      }],
      paidFallbackAllowed: false,
    };
    return compileCodexSparkCapacityStatus({
      policy,
      capacityObservation: observation,
      capacityObservationBytes: bytes(observation),
      supervisedAcceptance: acceptance,
      supervisedAcceptanceBytes: bytes(acceptance),
      capabilityReceipt: capability,
      capabilityReceiptBytes: bytes(capability),
      acceptanceVerification: verification,
      acceptanceVerificationBytes: bytes(verification),
      now: new Date(now),
    });
  };

  const run = (work, capacity) => {
    fs.writeFileSync(workPath, `${JSON.stringify(work, null, 2)}\n`);
    fs.writeFileSync(capacityPath, `${JSON.stringify(capacity, null, 2)}\n`);
    const result = spawnSync(process.execPath, ["scripts/plan-worker-route.mjs", workPath, capacityPath], {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const text = (result.status === 0 ? result.stdout : result.stderr).trim();
    return { result, document: JSON.parse(text) };
  };

  {
    const capacity = capacityDocument("AVAILABLE");
    const { result, document: plan } = run(baseWork, capacity);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(plan.eligible, true);
    assert.equal(plan.decision, "DISPATCH_ELIGIBLE");
    assert.equal(plan.routeId, "codex-spark-pro");
    assert.equal(plan.workerClass, "test-generation");
    assert.equal(plan.rawCapacityState, "AVAILABLE");
    assert.equal(plan.maximumConcurrency, 1);
    assert.equal(plan.routeAdmissionSha256, capacity.routes[0].routeAdmissionSha256);
    assert.equal(plan.supervisedAcceptanceSha256, capacity.routes[0].supervisedAcceptanceSha256);
    assert.equal(plan.capabilityReceiptSha256, capacity.routes[0].capabilityReceiptSha256);
    assert.match(plan.capacityStatusSha256, /^[0-9a-f]{64}$/);
    assert.match(plan.routePlanSha256, /^[0-9a-f]{64}$/);
    assert.equal(plan.paidFallbackUsed, false);
    assert.equal(plan.executionPerformed, false);
    assert.equal(plan.validationPerformed, false);
    assert.equal(plan.publicationPerformed, false);
  }

  {
    const { result, document: plan } = run(baseWork, capacityDocument("EXHAUSTED"));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(plan.eligible, false);
    assert.equal(plan.decision, "RETAIN_READY_JOB");
    assert.equal(plan.reason, "NO_ZERO_COST_CAPACITY_ROUTE_AVAILABLE");
    assert.equal(plan.matchingRoutes[0].rawCapacityState, "EXHAUSTED");
    assert.equal(plan.paidFallbackUsed, false);
  }

  {
    const rejected = { ...acceptedVerification, accepted: false, supervisedCleanupProven: false, errors: ["fixture rejected"] };
    const { result, document: plan } = run(baseWork, capacityDocument("AVAILABLE", rejected));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, "NO_CURRENT_PHYSICAL_ROUTE_ADMISSION");
  }

  {
    const broadened = { ...acceptedVerification, workerClasses: ["test-generation", "fast-coding"] };
    const { result, document: plan } = run(baseWork, capacityDocument("AVAILABLE", broadened));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, "WORKER_CLASS_NOT_PHYSICALLY_ADMITTED");
  }

  {
    const capacity = capacityDocument("AVAILABLE");
    capacity.routes[0].routeAdmission.maximumConcurrency = 2;
    const { result, document: plan } = run(baseWork, capacity);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, "NO_CURRENT_PHYSICAL_ROUTE_ADMISSION");
    assert.ok(plan.matchingRoutes[0].errors.some((entry) => entry.includes("digest") || entry.includes("concurrency")));
  }

  {
    const capacity = capacityDocument("AVAILABLE");
    capacity.routes[0].routeAdmission.expiresAt = iso(now - 1_000);
    const { result, document: plan } = run(baseWork, capacity);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(plan.eligible, false);
    assert.equal(plan.reason, "NO_CURRENT_PHYSICAL_ROUTE_ADMISSION");
  }

  {
    const unsafeWork = { ...baseWork, paidFallbackAllowed: true };
    const { result, document: plan } = run(unsafeWork, capacityDocument("AVAILABLE"));
    assert.equal(result.status, 1);
    assert.equal(plan.eligible, false);
    assert.ok(plan.errors.some((entry) => entry.includes("paid fallback")));
  }

  {
    const unsupportedWork = { ...baseWork, workerClass: "fast-coding" };
    const { result, document: plan } = run(unsupportedWork, capacityDocument("AVAILABLE"));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(plan.eligible, false);
    assert.equal(plan.decision, "RETAIN_READY_JOB");
    assert.equal(plan.paidFallbackUsed, false);
  }

  console.log("Worker capacity routing tests passed.");
  console.log("- canonical capacity status and digest-bound route admission are required for Spark selection");
  console.log("- exhausted raw capacity remains distinct from missing or rejected physical admission");
  console.log("- only the physically admitted test-generation class at concurrency one can be selected");
  console.log("- paid fallback, admission tampering and stale admission remain fail-closed");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
