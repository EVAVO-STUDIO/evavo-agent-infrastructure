#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-capacity-dispatch-"));
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const write = (name, value) => {
  const file = path.join(temporary, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
};
const run = (script, args, expectedStatus = 0) => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.status, expectedStatus, `${script}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return JSON.parse(String(expectedStatus === 0 ? result.stdout : result.stderr).trim());
};
const now = new Date().toISOString();

try {
  const observedRun = write("observed-run.json", {
    schemaVersion: 1,
    kind: "evavo-codex-worker-run-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    structuredTurnCompleted: true,
    modelTurnCompleted: true,
    exitCode: 0,
    finishedAt: now,
    paidFallbackUsed: false,
  });
  const raw = run("compile-codex-spark-raw-capacity-observation.mjs", [observedRun]);
  const rawPath = write("raw-capacity.json", raw);

  const capabilityPath = write("capability.json", {
    schemaVersion: 1,
    kind: "evavo-codex-worker-capability-probe-v1",
    eligibleForWorkerDispatch: true,
    observedAt: now,
    version: "fixture-codex",
    capabilities: {
      jsonFlag: "--json",
      modelFlag: "--model",
      sandboxFlag: "--sandbox",
      approvalFlag: "--ask-for-approval",
    },
  });
  const authPath = write("auth.json", {
    schemaVersion: 1,
    kind: "evavo-codex-chatgpt-auth-policy-probe-v1",
    accepted: true,
    authPolicyAccepted: true,
    authenticationClass: "chatgpt-consumer",
    chatgptOnly: true,
    apiKeyAllowed: false,
    mixedLoginAllowed: false,
    observedAt: now,
  });
  const supervisedAcceptanceSha256 = "a".repeat(64);
  const physicalPath = write("physical.json", {
    schemaVersion: 1,
    kind: "evavo-codex-spark-safe-physical-acceptance-verification-v1",
    accepted: true,
    supervisedCleanupProven: true,
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    workerClasses: ["test-generation"],
    maximumConcurrency: 1,
    paidFallbackAllowed: false,
    supervisedAcceptanceSha256,
    observedAt: now,
  });
  const admissionPath = write("admission.json", {
    schemaVersion: 1,
    kind: "evavo-codex-spark-route-admission-v1",
    accepted: true,
    eligible: true,
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    workerClasses: ["test-generation"],
    maximumConcurrency: 1,
    paidFallbackAllowed: false,
    paidFallbackUsed: false,
    admittedAt: now,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    supervisedAcceptanceSha256,
    codexCapabilityReceiptSha256: sha256(capabilityPath),
    physicalAcceptanceVerificationSha256: sha256(physicalPath),
  });

  const effective = run("assemble-codex-spark-effective-capacity.mjs", [
    rawPath,
    capabilityPath,
    authPath,
    physicalPath,
    admissionPath,
  ]);
  assert.equal(effective.eligible, true);
  assert.equal(effective.effectiveState, "AVAILABLE");
  assert.equal(effective.routes[0].maximumConcurrency, 1);
  const effectivePath = write("effective-capacity.json", effective);

  const readyWork = {
    schemaVersion: 1,
    kind: "evavo-autonomous-improvement-work-item-v1",
    id: "work:test-generation:capacity-dispatch-fixture",
    lifecycleState: "READY",
    workerClass: "test-generation",
    capacityClass: "included-consumer",
    paidFallbackAllowed: false,
    repository: "EVAVO-STUDIO/example",
    sourceRevision: "b".repeat(40),
    objective: "Add focused arithmetic boundary tests without changing production source.",
    allowedPaths: ["tests/arithmetic.test.mjs"],
    forbiddenPaths: ["src/**", ".git/**"],
    requiredValidation: ["node --test"],
    fixtureOnly: true,
  };
  const readyWorkPath = write("ready-work.json", readyWork);
  const route = run("plan-codex-spark-effective-route-v2.mjs", [readyWorkPath, effectivePath]);
  assert.equal(route.eligible, true);
  assert.equal(route.workerClass, "test-generation");
  assert.equal(route.maximumConcurrency, 1);
  assert.equal(route.effectiveCapacityStatusSha256, sha256(effectivePath));
  const routePath = write("route.json", route);

  const workerId = "spark-test-builder-fixture";
  const leasedWorkPath = write("leased-work.json", {
    ...readyWork,
    lifecycleState: "LEASED",
    lease: {
      workerId,
      leasedAt: now,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
  });
  const candidateRoot = path.join(temporary, "candidate");
  fs.mkdirSync(candidateRoot);
  const candidatePath = write("candidate-receipt.json", {
    schemaVersion: 1,
    kind: "evavo-autonomous-candidate-worktree-v1",
    workItemId: readyWork.id,
    sourceRevision: readyWork.sourceRevision,
    sourceTreeSha: "c".repeat(40),
    candidate: {
      contract: "evavo_mainline_candidate_worktree_v1",
      path: candidateRoot,
    },
  });

  const dispatch = run("compile-codex-worker-dispatch.mjs", [
    leasedWorkPath,
    routePath,
    capabilityPath,
    candidatePath,
    workerId,
  ]);
  assert.equal(dispatch.kind, "evavo-codex-worker-dispatch-plan-v1");
  assert.equal(dispatch.eligible, true);
  assert.equal(dispatch.workItemId, readyWork.id);
  assert.equal(dispatch.fixtureOnly, true);
  assert.equal(dispatch.sandboxMode, "workspace-write");
  assert.equal(dispatch.approvalPolicy, "never");
  assert.equal(dispatch.paidFallbackUsed, false);
  assert.equal(dispatch.publicationAuthority, false);
  assert.equal(dispatch.validationAuthority, false);
  assert.ok(dispatch.argv.includes("gpt-5.3-codex-spark"));
  assert.match(dispatch.stdinPrompt, /NO_ACTION is valid/);
  assert.match(dispatch.stdinPrompt, /Do not commit, push, publish, deploy/);

  console.log("Codex Spark capacity-to-dispatch tests passed.");
  console.log("- a real successful-turn receipt is normalized as raw capacity");
  console.log("- five independent evidence layers assemble into one short-lived effective status");
  console.log("- schema-v2 route planning preserves Test Builder/concurrency-one admission and all evidence hashes");
  console.log("- dispatch compilation remains isolated, zero-paid-fallback, non-validating and non-publishing");
  console.log("- no Codex executable or model turn is started by this contract test");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
