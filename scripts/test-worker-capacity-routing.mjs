#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-worker-routing-"));
try {
  const work = path.join(dir, "work.json");
  const capacity = path.join(dir, "capacity.json");
  fs.writeFileSync(work, JSON.stringify({
    lifecycleState: "READY",
    workerClass: "test-generation",
    capacityClass: "included-consumer",
    paidFallbackAllowed: false,
    jobPriority: 90,
    repository: "EVAVO-STUDIO/example",
    sourceRevision: "a".repeat(40)
  }));

  fs.writeFileSync(capacity, JSON.stringify({routes:[{routeId:"codex-spark-pro",state:"AVAILABLE",maximumConcurrency:3}]}));
  let result = spawnSync(process.execPath, ["scripts/plan-worker-route.mjs", work, capacity], {encoding:"utf8"});
  assert.equal(result.status, 0, result.stderr);
  let plan = JSON.parse(result.stdout);
  assert.equal(plan.eligible, false);
  assert.equal(plan.decision, "RETAIN_READY_JOB");
  assert.equal(plan.matchingRoutes[0].physicalAdmissionReason, "PHYSICAL_ADMISSION_REQUIRED");
  assert.equal(plan.paidFallbackUsed, false);

  const admitted = {
    kind: "evavo-codex-spark-route-admission-v1",
    accepted: true,
    routeId: "codex-spark-pro",
    acceptedWorkerClasses: ["test-generation"],
    maximumConcurrency: 1,
    supervisedAcceptanceSha256: "b".repeat(64),
    expiresAt: "2099-01-01T00:00:00.000Z",
    providerApiCredentialsInherited: false,
    paidFallbackAllowed: false,
    publicationAuthority: false
  };
  fs.writeFileSync(capacity, JSON.stringify({routes:[{routeId:"codex-spark-pro",state:"AVAILABLE",maximumConcurrency:3,physicalAdmission:admitted}]}));
  result = spawnSync(process.execPath, ["scripts/plan-worker-route.mjs", work, capacity], {encoding:"utf8"});
  assert.equal(result.status, 0, result.stderr);
  plan = JSON.parse(result.stdout);
  assert.equal(plan.eligible, true);
  assert.equal(plan.routeId, "codex-spark-pro");
  assert.equal(plan.physicalAdmissionVerified, true);
  assert.equal(plan.physicalAdmissionSha256, "b".repeat(64));
  assert.equal(plan.maximumAutomaticConcurrency, 1);
  assert.equal(plan.paidFallbackUsed, false);
  assert.equal(plan.executionPerformed, false);

  const wrongClass = {...admitted, acceptedWorkerClasses:["documentation-truth"]};
  fs.writeFileSync(capacity, JSON.stringify({routes:[{routeId:"codex-spark-pro",state:"AVAILABLE",maximumConcurrency:3,physicalAdmission:wrongClass}]}));
  result = spawnSync(process.execPath, ["scripts/plan-worker-route.mjs", work, capacity], {encoding:"utf8"});
  plan = JSON.parse(result.stdout);
  assert.equal(plan.eligible, false);
  assert.equal(plan.matchingRoutes[0].physicalAdmissionReason, "WORKER_CLASS_NOT_PHYSICALLY_ADMITTED");

  const expired = {...admitted, expiresAt:"2000-01-01T00:00:00.000Z"};
  fs.writeFileSync(capacity, JSON.stringify({routes:[{routeId:"codex-spark-pro",state:"AVAILABLE",maximumConcurrency:3,physicalAdmission:expired}]}));
  result = spawnSync(process.execPath, ["scripts/plan-worker-route.mjs", work, capacity], {encoding:"utf8"});
  plan = JSON.parse(result.stdout);
  assert.equal(plan.eligible, false);
  assert.equal(plan.matchingRoutes[0].physicalAdmissionReason, "PHYSICAL_ADMISSION_EXPIRED");

  fs.writeFileSync(capacity, JSON.stringify({routes:[{routeId:"codex-spark-pro",state:"EXHAUSTED",physicalAdmission:admitted}]}));
  result = spawnSync(process.execPath, ["scripts/plan-worker-route.mjs", work, capacity], {encoding:"utf8"});
  assert.equal(result.status, 0, result.stderr);
  plan = JSON.parse(result.stdout);
  assert.equal(plan.eligible, false);
  assert.equal(plan.decision, "RETAIN_READY_JOB");
  assert.equal(plan.paidFallbackUsed, false);

  const unsafe = JSON.parse(fs.readFileSync(work, "utf8"));
  unsafe.paidFallbackAllowed = true;
  fs.writeFileSync(work, JSON.stringify(unsafe));
  result = spawnSync(process.execPath, ["scripts/plan-worker-route.mjs", work, capacity], {encoding:"utf8"});
  assert.equal(result.status, 1);

  console.log("Worker capacity routing tests passed.");
} finally {
  fs.rmSync(dir, {recursive:true, force:true});
}
