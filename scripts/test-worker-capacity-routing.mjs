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
  assert.equal(plan.eligible, true);
  assert.equal(plan.routeId, "codex-spark-pro");
  assert.equal(plan.paidFallbackUsed, false);
  assert.equal(plan.executionPerformed, false);

  fs.writeFileSync(capacity, JSON.stringify({routes:[{routeId:"codex-spark-pro",state:"EXHAUSTED"}]}));
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
