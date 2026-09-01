#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.dirname(scriptsRoot);
const safePath = path.join(scriptsRoot, "certify-codex-spark-physical-acceptance-safe.mjs");
const rawPath = path.join(scriptsRoot, "certify-codex-spark-physical-acceptance.mjs");
const tasksPath = path.join(repositoryRoot, "evavo.tasks.json");
const safe = fs.readFileSync(safePath, "utf8");
const raw = fs.readFileSync(rawPath, "utf8");
const manifest = JSON.parse(fs.readFileSync(tasksPath, "utf8"));

for (const token of [
  "evavo-spark-certification-stage-",
  "cleanup-autonomous-fixture-candidate.mjs",
  "cleanupIfPresent(\"14-seal.json\")",
  "cleanupIfPresent(\"07-candidate.json\")",
  "registeredWorktrees.length !== 1",
  "git(fixtureRepository, [\"remote\"])",
  "stagedAcceptancePromotedOnlyAfterCleanup: true",
  "fs.copyFileSync(stagedAcceptancePath, canonicalAcceptancePath",
  "if (cleanupComplete) fs.rmSync(stagingParent",
]) assert.ok(safe.includes(token), `Safe certification supervisor is missing required token: ${token}`);

assert.ok(safe.indexOf("cleanupIfPresent(\"14-seal.json\")") < safe.indexOf("fs.copyFileSync(stagedAcceptancePath, canonicalAcceptancePath"), "Validation candidate cleanup must precede acceptance promotion.");
assert.ok(safe.indexOf("registeredWorktrees.length !== 1") < safe.indexOf("fs.copyFileSync(stagedAcceptancePath, canonicalAcceptancePath"), "Registered-worktree proof must precede acceptance promotion.");
assert.ok(safe.indexOf("git(fixtureRepository, [\"remote\"])") < safe.indexOf("fs.copyFileSync(stagedAcceptancePath, canonicalAcceptancePath"), "Remote-less fixture proof must precede acceptance promotion.");
assert.ok(raw.includes("EVAVO_CODEX_SPARK_CERTIFICATION_ENABLED"), "Raw certifier must retain an explicit outer certification gate.");

const taskEntries = Object.values(manifest.tasks ?? {}).map((task) => String(task?.entry ?? ""));
for (const effectfulEntry of [
  "scripts/certify-codex-spark-physical-acceptance.mjs",
  "scripts/certify-codex-spark-physical-acceptance-safe.mjs",
  "scripts/run-codex-worker-dispatch.mjs",
]) {
  assert.equal(taskEntries.includes(effectfulEntry), false, `${effectfulEntry} must remain absent from the routine task manifest before physical acceptance.`);
}

console.log("Codex Spark safe certification source contract passed.");
console.log("- effectful raw/supervised certifiers and runner remain unregistered");
console.log("- detached candidate cleanup and worktree/remote/main proofs precede acceptance promotion");
console.log("- staged evidence is promoted only after the fail-closed supervisor completes");
