#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptsRoot);
const safePath = path.join(scriptsRoot, "certify-codex-spark-physical-acceptance-safe.mjs");
const rawPath = path.join(scriptsRoot, "certify-codex-spark-physical-acceptance.mjs");
const runnerPath = path.join(scriptsRoot, "run-codex-worker-dispatch.mjs");
const verifierPath = path.join(scriptsRoot, "verify-codex-spark-safe-physical-acceptance.mjs");
const tasksPath = path.join(repositoryRoot, "evavo.tasks.json");
const safe = fs.readFileSync(safePath, "utf8");
const raw = fs.readFileSync(rawPath, "utf8");
const runner = fs.readFileSync(runnerPath, "utf8");
const verifier = fs.readFileSync(verifierPath, "utf8");
const manifest = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
const promotionToken = "fs.writeFileSync(canonicalAcceptancePath";

for (const token of [
  "evavo-spark-certification-stage-",
  "cleanup-autonomous-fixture-candidate.mjs",
  "cleanupIfPresent(\"14-seal.json\")",
  "cleanupIfPresent(\"07-candidate.json\")",
  "registeredWorktrees.length !== 1",
  "git(fixtureRepository, [\"remote\"])",
  "evavo-codex-spark-safe-physical-acceptance-v1",
  "physicalAcceptanceSha256",
  "stagedAcceptancePromotedOnlyAfterCleanup: true",
  promotionToken,
  "if (cleanupComplete) fs.rmSync(stagingParent",
]) assert.ok(safe.includes(token), `Safe certification supervisor is missing required token: ${token}`);

assert.ok(safe.indexOf("cleanupIfPresent(\"14-seal.json\")") < safe.indexOf(promotionToken), "Validation candidate cleanup must precede supervised acceptance creation.");
assert.ok(safe.indexOf("registeredWorktrees.length !== 1") < safe.indexOf(promotionToken), "Registered-worktree proof must precede supervised acceptance creation.");
assert.ok(safe.indexOf("git(fixtureRepository, [\"remote\"])") < safe.indexOf(promotionToken), "Remote-less fixture proof must precede supervised acceptance creation.");
assert.ok(safe.indexOf("physicalAcceptanceSha256") < safe.indexOf(promotionToken), "Nested physical acceptance must be digest-bound before supervised acceptance creation.");
assert.ok(raw.includes("EVAVO_CODEX_SPARK_CERTIFICATION_ENABLED"), "Raw staged certifier must retain an explicit outer certification gate.");

assert.ok(runner.includes("verify-codex-spark-safe-physical-acceptance.mjs"), "Effectful runner must use the supervised acceptance verifier.");
assert.ok(runner.includes("a raw pre-cleanup acceptance"), "Runner truth boundary must explicitly reject raw pre-cleanup acceptance as authority.");
assert.ok(verifier.includes("evavo-codex-spark-safe-physical-acceptance-v1"), "Supervised verifier must require the supervised acceptance envelope kind.");
assert.ok(verifier.includes("Nested physical acceptance digest mismatch"), "Supervised verifier must digest-check nested physical acceptance.");
assert.ok(verifier.includes("registeredWorktreesAfterCleanup !== 1"), "Supervised verifier must require a single remaining fixture worktree.");

const taskEntries = Object.values(manifest.tasks ?? {}).map((task) => String(task?.entry ?? ""));
for (const effectfulEntry of [
  "scripts/certify-codex-spark-physical-acceptance.mjs",
  "scripts/certify-codex-spark-physical-acceptance-safe.mjs",
  "scripts/run-codex-worker-dispatch.mjs",
]) assert.equal(taskEntries.includes(effectfulEntry), false, `${effectfulEntry} must remain absent from the routine task manifest before physical acceptance.`);

console.log("Codex Spark safe certification source contract passed.");
console.log("- effectful raw/supervised certifiers and runner remain unregistered");
console.log("- detached candidate cleanup and worktree/remote/main proofs precede supervised acceptance creation");
console.log("- the nested physical acceptance is digest-bound inside a supervised envelope");
console.log("- normal runner execution is bound to the supervised verifier, not raw acceptance");
