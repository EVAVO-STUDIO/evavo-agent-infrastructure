#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const scripts = [
  "scripts/compile-codex-spark-raw-capacity-observation.mjs",
  "scripts/assemble-codex-spark-effective-capacity.mjs",
  "scripts/plan-codex-spark-effective-route-v2.mjs",
  "scripts/plan-codex-spark-capacity-heartbeat.mjs",
  "scripts/compile-codex-spark-capacity-heartbeat-dispatch.mjs",
  "scripts/run-codex-spark-capacity-heartbeat-v2.mjs",
];
for (const relative of scripts) {
  const result = spawnSync(process.execPath, ["--check", relative], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.status, 0, `${relative} failed syntax validation:\n${result.stderr || result.stdout}`);
}

const authority = JSON.parse(fs.readFileSync(path.join(root, "config", "codex-spark-capacity-runtime-authority-v1.json"), "utf8"));
assert.equal(authority.kind, "evavo-codex-spark-capacity-runtime-authority-v1");
assert.equal(authority.canonicalRunner, "scripts/run-codex-spark-capacity-heartbeat-v2.mjs");
assert.ok(authority.supersededRunners.includes("scripts/run-codex-spark-capacity-heartbeat.mjs"));
assert.equal(authority.enabledByDefault, false);
assert.equal(authority.fixtureOnly, true);
assert.equal(authority.maximumConcurrency, 1);
assert.equal(authority.maximumModelTurnsPerRun, 1);
assert.equal(authority.nonAuthorities.productRepositoryMutation, true);
assert.equal(authority.nonAuthorities.paidApiFallback, true);

const runnerPath = path.join(root, authority.canonicalRunner);
const runnerSource = fs.readFileSync(runnerPath, "utf8");
for (const required of [
  "EVAVO_CODEX_SPARK_CAPACITY_HEARTBEAT_ENABLED",
  "compile-codex-spark-capacity-heartbeat-dispatch.mjs",
  "verify-codex-spark-safe-physical-acceptance.mjs",
  "temporaryFixtureMutationObserved",
  "fixtureRemoteCount",
  "temporaryFixtureStateRemoved",
  "apiKeyEnvironmentSanitized",
  "productRepositoryTouched",
]) {
  assert.ok(runnerSource.includes(required), `Canonical heartbeat runner lacks required control: ${required}`);
}
assert.ok(!runnerSource.includes("shell: true"), "Canonical heartbeat runner may not enable shell execution.");
assert.ok(runnerSource.includes("fs.rmSync(fixtureParent"), "Canonical heartbeat runner must remove temporary fixture state.");
assert.ok(runnerSource.includes("GH_TOKEN") && runnerSource.includes("GITHUB_TOKEN"), "Canonical heartbeat runner must strip GitHub credentials from the Codex child.");
assert.ok(runnerSource.includes("OPENAI_API_KEY") && runnerSource.includes("CODEX_API_KEY"), "Canonical heartbeat runner must strip provider API credentials from the Codex child.");

const dummyArgs = Array.from({ length: 9 }, (_, index) => `missing-${index}.json`);
const disabledEnvironment = { ...process.env };
delete disabledEnvironment.EVAVO_CODEX_SPARK_CAPACITY_HEARTBEAT_ENABLED;
let result = spawnSync(process.execPath, [runnerPath, ...dummyArgs], {
  cwd: root,
  env: disabledEnvironment,
  encoding: "utf8",
  shell: false,
});
assert.equal(result.status, 1);
let receipt = JSON.parse(result.stderr);
assert.equal(receipt.started, false);
assert.equal(receipt.state, "DISABLED");
assert.equal(receipt.modelProcessAttempted, false);
assert.equal(receipt.modelTurnPerformed, false);
assert.equal(receipt.temporaryFixtureCreated, false);
assert.equal(receipt.productRepositoryTouched, false);
assert.equal(receipt.paidFallbackUsed, false);

result = spawnSync(process.execPath, [runnerPath, ...dummyArgs], {
  cwd: root,
  env: { ...process.env, EVAVO_CODEX_SPARK_CAPACITY_HEARTBEAT_ENABLED: "1" },
  encoding: "utf8",
  shell: false,
});
assert.equal(result.status, 1);
receipt = JSON.parse(result.stderr);
assert.equal(receipt.state, "REJECTED_BEFORE_MODEL_ATTEMPT");
assert.equal(receipt.modelProcessAttempted, false);
assert.equal(receipt.modelProcessStarted, false);
assert.equal(receipt.productRepositoryTouched, false);
assert.equal(receipt.paidFallbackUsed, false);
assert.equal(receipt.temporaryFixtureStateRemoved, true);

console.log("Codex Spark capacity-runtime safety tests passed.");
console.log("- every new capacity/route/heartbeat script passes Node syntax validation");
console.log("- only the v2 heartbeat runner is canonical; the parse-defective draft is explicitly superseded");
console.log("- execution is disabled by default and invalid evidence fails before any fixture or model process");
console.log("- provider/GitHub credentials, shell execution, product mutation and paid fallback remain prohibited");
