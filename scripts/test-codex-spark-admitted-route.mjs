#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileCodexSparkCapacityStatus } from "./codex-spark-capacity-status-core.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-route-admission-"));
const digest = (character) => character.repeat(64);

function buildStatus(now = new Date(), patch = {}) {
  const iso = (offsetMs) => new Date(now.getTime() + offsetMs).toISOString();
  return compileCodexSparkCapacityStatus({
    now,
    routePolicy: {
      id: "codex-spark-pro",
      runtime: "codex",
      modelPreference: "gpt-5.3-codex-spark",
      capacityClass: "included-consumer",
      paidFallbackAllowed: false,
      workerClasses: ["test-generation", "documentation-truth"],
      maximumAutomaticConcurrency: 4,
    },
    physicalPolicy: {
      routeId: "codex-spark-pro",
      paidFallbackAllowed: false,
      initialWorkerClasses: ["test-generation"],
      initialMaximumConcurrency: 1,
    },
    capacityObservation: {
      schemaVersion: 1,
      kind: "evavo-codex-spark-capacity-observation-v1",
      routeId: "codex-spark-pro",
      state: "AVAILABLE",
      observedAt: iso(-60_000),
      maximumConcurrency: 4,
      paidFallbackUsed: false,
    },
    capabilityReceipt: {
      kind: "evavo-codex-worker-capability-probe-v1",
      observedAt: iso(-45_000),
      eligibleForWorkerDispatch: true,
      capabilities: {
        jsonFlag: "--json",
        modelFlag: "--model",
        sandboxFlag: "--sandbox",
        approvalFlag: "--ask-for-approval",
      },
    },
    authenticationReceipt: {
      kind: "evavo-codex-chatgpt-authentication-admission-v1",
      observedAt: iso(-30_000),
      accepted: true,
      authenticationClass: "chatgpt-consumer",
      credentialValuesReturned: false,
    },
    physicalVerification: {
      kind: "evavo-codex-spark-safe-physical-acceptance-verification-v1",
      accepted: true,
      routeId: "codex-spark-pro",
      workerClasses: ["test-generation"],
      maximumConcurrency: 1,
      paidFallbackAllowed: false,
      errors: [],
    },
    supervisedAt: iso(-120_000),
    sourceDigests: {
      capacityObservationSha256: digest("a"),
      capabilityReceiptSha256: digest("b"),
      authenticationReceiptSha256: digest("c"),
      supervisedAcceptanceSha256: digest("d"),
    },
    ...patch,
  });
}

const baseWork = {
  id: "work:spark-route-fixture",
  lifecycleState: "READY",
  workerClass: "test-generation",
  capacityClass: "included-consumer",
  paidFallbackAllowed: false,
  jobPriority: 90,
  repository: "EVAVO-STUDIO/example",
  sourceRevision: "e".repeat(40),
};

function run(work, status) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const workPath = path.join(temp, `work-${suffix}.json`);
  const statusPath = path.join(temp, `status-${suffix}.json`);
  fs.writeFileSync(workPath, JSON.stringify(work));
  fs.writeFileSync(statusPath, JSON.stringify(status));
  const result = spawnSync(process.execPath, ["scripts/plan-codex-spark-admitted-route.mjs", workPath, statusPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });
  const channel = result.status === 0 ? result.stdout : result.stderr;
  return { result, plan: JSON.parse(String(channel).trim()) };
}

try {
  {
    const { result, plan } = run(baseWork, buildStatus());
    assert.equal(result.status, 0, result.stderr);
    assert.equal(plan.kind, "evavo-worker-route-plan-v2");
    assert.equal(plan.eligible, true);
    assert.equal(plan.workerClass, "test-generation");
    assert.equal(plan.maximumConcurrency, 1);
    assert.equal(plan.routeAdmissionSha256.length, 64);
    assert.equal(plan.supervisedAcceptanceSha256, digest("d"));
    assert.equal(plan.capabilityReceiptSha256, digest("b"));
    assert.equal(plan.paidFallbackAllowed, false);
  }

  {
    const { plan } = run({ ...baseWork, workerClass: "documentation-truth" }, buildStatus());
    assert.equal(plan.eligible, false);
    assert.equal(plan.decision, "RETAIN_READY_JOB");
    assert.ok(plan.reasons.includes("WORKER_CLASS_NOT_ADMITTED"));
  }

  {
    const status = buildStatus();
    status.routes[0].admissionSha256 = digest("f");
    const { plan } = run(baseWork, status);
    assert.equal(plan.eligible, false);
    assert.ok(plan.reasons.includes("ROUTE_ADMISSION_DIGEST_MISMATCH"));
  }

  {
    const status = buildStatus();
    status.routes[0].maximumConcurrency = 2;
    const { plan } = run(baseWork, status);
    assert.equal(plan.eligible, false);
    assert.ok(plan.reasons.includes("INITIAL_CONCURRENCY_MUST_REMAIN_ONE"));
  }

  {
    const oldNow = new Date(Date.now() - 20 * 60 * 1000);
    const { plan } = run(baseWork, buildStatus(oldNow));
    assert.equal(plan.eligible, false);
    assert.ok(plan.reasons.includes("CAPACITY_STATUS_STALE"));
  }

  {
    const now = new Date();
    const status = buildStatus(now, {
      physicalVerification: null,
      supervisedAt: null,
      sourceDigests: {
        capacityObservationSha256: digest("a"),
        capabilityReceiptSha256: digest("b"),
        authenticationReceiptSha256: digest("c"),
        supervisedAcceptanceSha256: null,
      },
    });
    const { plan } = run(baseWork, status);
    assert.equal(plan.eligible, false);
    assert.ok(plan.reasons.includes("ROUTE_NOT_DISPATCH_ELIGIBLE"));
  }

  console.log("Codex Spark admitted-route tests passed.");
  console.log("- one READY Test Builder job can bind to one short-lived evidence admission");
  console.log("- unadmitted worker classes and concurrency escalation retain the job");
  console.log("- admission digest tampering and stale status fail closed");
  console.log("- AVAILABLE raw capacity without physical admission cannot dispatch");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
