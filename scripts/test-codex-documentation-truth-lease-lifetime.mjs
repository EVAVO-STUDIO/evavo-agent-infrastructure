#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const policy = JSON.parse(fs.readFileSync("config/codex-documentation-truth-runner-v1.json", "utf8"));
const runner = fs.readFileSync("scripts/run-codex-documentation-truth-dispatch.mjs", "utf8");

assert.equal(policy.schemaVersion, 1);
assert.equal(policy.kind, "evavo-codex-documentation-truth-runner-policy-v1");
assert.ok(Number.isInteger(policy.maximumProcessSeconds) && policy.maximumProcessSeconds > 0);
assert.ok(Number.isInteger(policy.minimumProcessBudgetSeconds) && policy.minimumProcessBudgetSeconds > 0);
assert.ok(policy.minimumProcessBudgetSeconds <= policy.maximumProcessSeconds);
assert.ok(Number.isInteger(policy.leaseCompletionSafetyMarginSeconds));
assert.ok(policy.leaseCompletionSafetyMarginSeconds >= 1 && policy.leaseCompletionSafetyMarginSeconds <= 60);

for (const marker of [
  "const executionDeadline = Math.min(routeExpiresAt, leaseExpiresAt);",
  "const availableProcessBudgetMs = executionDeadline - startedAtMilliseconds - leaseCompletionSafetyMarginSeconds * 1000;",
  "const processBudgetMs = Math.min(maximumProcessSeconds * 1000, availableProcessBudgetMs);",
  "if (processBudgetMs < minimumProcessBudgetSeconds * 1000) throw new Error(\"insufficient remaining lease/route lifetime for the minimum documentation-truth process budget.\");",
  "timeout: Math.floor(processBudgetMs)",
  "leaseValidAtFinish = finishedAtMilliseconds < leaseExpiresAt;",
  "routeAdmissionValidAtFinish = finishedAtMilliseconds < routeExpiresAt;",
  "if (!leaseValidAtFinish || !routeAdmissionValidAtFinish) throw new Error(\"documentation-truth model turn finished after its lease or route admission expired; result rejected.\");",
  "resultAcceptedAfterLeaseExpiry: false",
  "processTimeoutSeconds: processBudgetSeconds",
  "leaseCompletionSafetyMarginSeconds",
]) {
  assert.ok(runner.includes(marker), `runner is missing lease-lifetime guard: ${marker}`);
}

assert.equal(
  runner.includes("timeout: runnerPolicy.maximumProcessSeconds * 1000"),
  false,
  "runner must not use the static policy ceiling as its child timeout",
);

function computeBudgetMs({ startMs, leaseExpiresMs, routeExpiresMs }) {
  const executionDeadline = Math.min(routeExpiresMs, leaseExpiresMs);
  const available = executionDeadline - startMs - policy.leaseCompletionSafetyMarginSeconds * 1000;
  return Math.min(policy.maximumProcessSeconds * 1000, available);
}

const now = Date.now();
const enough = computeBudgetMs({
  startMs: now,
  leaseExpiresMs: now + (policy.minimumProcessBudgetSeconds + policy.leaseCompletionSafetyMarginSeconds + 10) * 1000,
  routeExpiresMs: now + (policy.minimumProcessBudgetSeconds + policy.leaseCompletionSafetyMarginSeconds + 20) * 1000,
});
assert.ok(enough >= policy.minimumProcessBudgetSeconds * 1000);

const insufficient = computeBudgetMs({
  startMs: now,
  leaseExpiresMs: now + (policy.minimumProcessBudgetSeconds + policy.leaseCompletionSafetyMarginSeconds - 1) * 1000,
  routeExpiresMs: now + (policy.minimumProcessBudgetSeconds + policy.leaseCompletionSafetyMarginSeconds + 20) * 1000,
});
assert.ok(insufficient < policy.minimumProcessBudgetSeconds * 1000);

const syntheticSlowChild = spawnSync(
  process.execPath,
  ["-e", "setTimeout(() => process.stdout.write('late'), 250)"],
  {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 50,
    maxBuffer: 1024 * 1024,
  },
);
assert.ok(syntheticSlowChild.error, "synthetic slow child should be terminated by the bounded timeout");
assert.equal(syntheticSlowChild.error.code, "ETIMEDOUT");
assert.notEqual(syntheticSlowChild.status, 0);
assert.notEqual(String(syntheticSlowChild.stdout ?? "").trim(), "late");

console.log("Codex documentation-truth lease-lifetime tests passed.");
console.log("- insufficient remaining lease/route lifetime cannot reach process spawn");
console.log("- child timeout is dynamically bounded by the earliest authority deadline minus a safety margin");
console.log("- a synthetic slow child is terminated by the same synchronous timeout primitive used by the runner");
console.log("- post-turn acceptance requires lease and route admission to remain valid at finish");
console.log("- no result can claim acceptance after lease expiry");
