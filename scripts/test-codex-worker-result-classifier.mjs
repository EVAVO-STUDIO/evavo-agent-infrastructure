#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-codex-result-"));
const classify = (document) => {
  const source = path.join(dir, "result.json");
  fs.writeFileSync(source, JSON.stringify(document));
  const result = spawnSync(process.execPath, ["scripts/classify-codex-worker-result.mjs", source], {encoding:"utf8", shell:false});
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

try {
  let result = classify({exitCode:0, modelTurnCompleted:true, stdout:"done", routeId:"codex-spark-pro"});
  assert.equal(result.capacityState, "AVAILABLE");
  assert.equal(result.workDecision, "PROCESS_WORKER_RESULT");
  assert.equal(result.paidFallbackUsed, false);

  result = classify({exitCode:1, modelTurnCompleted:false, stderr:"You have reached your usage limit. Try again after 04:10."});
  assert.equal(result.capacityState, "EXHAUSTED");
  assert.equal(result.workDecision, "RETAIN_READY_JOB");
  assert.equal(result.exactUsageRemainingKnown, false);

  result = classify({exitCode:1, modelTurnCompleted:false, stderr:"Too many requests; retry after 30 seconds"});
  assert.equal(result.capacityState, "RATE_LIMITED");
  assert.equal(result.workDecision, "BACKOFF_RETAIN_READY_JOB");

  result = classify({exitCode:1, modelTurnCompleted:false, stderr:"Authentication required. Sign in to Codex."});
  assert.equal(result.capacityState, "AUTH_REQUIRED");

  result = classify({exitCode:2, modelTurnCompleted:false, stderr:"unexpected runtime transport error"});
  assert.equal(result.capacityState, "DEGRADED");
  assert.equal(result.workDecision, "REVIEW_RUNTIME_FAILURE");

  console.log("Codex worker result classifier tests passed.");
} finally {
  fs.rmSync(dir, {recursive:true, force:true});
}
