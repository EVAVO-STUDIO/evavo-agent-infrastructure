#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-heartbeat-dispatch-"));
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const write = (name, value) => {
  const file = path.join(temporary, `${name}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
};
const invoke = (script, args, expectedStatus = 0) => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], { cwd: root, encoding: "utf8", shell: false });
  assert.equal(result.status, expectedStatus, `${script}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return JSON.parse(String(expectedStatus === 0 ? result.stdout : result.stderr).trim());
};
const now = new Date().toISOString();

function buildFixture() {
  const acceptancePath = write("acceptance", {
    schemaVersion: 1,
    kind: "evavo-codex-spark-safe-physical-acceptance-v1",
    supervisedAt: now,
    supervision: {
      cleanupComplete: true,
      stagedAcceptancePromotedOnlyAfterCleanup: true,
      fixtureRepositoryMainUnchanged: true,
      fixtureRepositoryClean: true,
      fixtureRepositoryRemoteCount: 0,
      registeredWorktreesAfterCleanup: 1,
      publicationPerformed: false,
      productRepositoryTouched: false,
    },
    physicalAcceptance: { kind: "evavo-codex-spark-physical-acceptance-v1", accepted: true },
    physicalAcceptanceSha256: "f".repeat(64),
  });
  const acceptanceSha = sha256(acceptancePath);
  const capabilityPath = write("capability", {
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
  const authPath = write("auth", {
    schemaVersion: 1,
    kind: "evavo-codex-chatgpt-auth-policy-probe-v1",
    accepted: true,
    authPolicyAccepted: true,
    chatgptOnly: true,
    authenticationClass: "chatgpt-consumer",
    apiKeyAllowed: false,
    mixedLoginAllowed: false,
    observedAt: now,
  });
  const physicalPath = write("physical", {
    schemaVersion: 1,
    kind: "evavo-codex-spark-safe-physical-acceptance-verification-v1",
    accepted: true,
    supervisedCleanupProven: true,
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    workerClasses: ["test-generation"],
    maximumConcurrency: 1,
    paidFallbackAllowed: false,
    supervisedAcceptanceSha256: acceptanceSha,
    observedAt: now,
  });
  const admissionPath = write("admission", {
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
    supervisedAcceptanceSha256: acceptanceSha,
    codexCapabilityReceiptSha256: sha256(capabilityPath),
    physicalAcceptanceVerificationSha256: sha256(physicalPath),
  });
  const queuePath = write("queue", {
    schemaVersion: 1,
    kind: "evavo-autonomous-work-exchange-status-v1",
    observedAt: now,
    readyCount: 4,
    leasedCount: 0,
    runningCount: 0,
  });
  const effectivePath = write("effective", {
    schemaVersion: 1,
    kind: "evavo-worker-capacity-status-v1",
    ok: true,
    observedAt: now,
    routeId: "codex-spark-pro",
    eligible: false,
    effectiveState: "UNKNOWN",
    rawState: "AVAILABLE",
    routes: [{
      routeId: "codex-spark-pro",
      modelPreference: "gpt-5.3-codex-spark",
      capacityClass: "included-consumer",
      state: "UNKNOWN",
      rawState: "AVAILABLE",
      eligible: false,
      admittedWorkerClasses: [],
      maximumConcurrency: 0,
      maximumAutomaticConcurrency: 0,
      paidFallbackAllowed: false,
      paidFallbackUsed: false,
      supervisedAcceptanceSha256: acceptanceSha,
      codexCapabilityReceiptSha256: sha256(capabilityPath),
      physicalAcceptanceVerificationSha256: sha256(physicalPath),
      routeAdmissionSha256: sha256(admissionPath),
      rawCapacityObservationSha256: "9".repeat(64),
    }],
    evidence: {
      rawCapacity: { state: "AVAILABLE", observedAt: new Date(Date.now() - 20 * 60_000).toISOString(), fresh: false },
      transport: { eligible: true, fresh: true, sha256: sha256(capabilityPath) },
      authentication: { accepted: true, fresh: true, sha256: sha256(authPath) },
      physicalAdmission: { accepted: true, supervisedCleanupProven: true, fresh: true, sha256: sha256(physicalPath) },
      routeAdmission: { accepted: true, fresh: true, sha256: sha256(admissionPath) },
    },
    capacityInferredFromTransport: false,
    capacityInferredFromAuthentication: false,
    capacityInferredFromPhysicalAcceptance: false,
    paidFallbackAllowed: false,
    paidFallbackUsed: false,
  });
  const heartbeatPlan = invoke("plan-codex-spark-capacity-heartbeat.mjs", [queuePath, effectivePath]);
  assert.equal(heartbeatPlan.eligible, true);
  const heartbeatPlanPath = write("heartbeat-plan", heartbeatPlan);
  return { heartbeatPlanPath, queuePath, effectivePath, capabilityPath, authPath, physicalPath, admissionPath, acceptancePath };
}

const compile = (fixture, expectedStatus = 0) => invoke("compile-codex-spark-capacity-heartbeat-dispatch.mjs", [
  fixture.heartbeatPlanPath,
  fixture.queuePath,
  fixture.effectivePath,
  fixture.capabilityPath,
  fixture.authPath,
  fixture.physicalPath,
  fixture.admissionPath,
  fixture.acceptancePath,
], expectedStatus);

try {
  let fixture = buildFixture();
  let dispatch = compile(fixture);
  assert.equal(dispatch.kind, "evavo-codex-spark-capacity-heartbeat-dispatch-plan-v1");
  assert.equal(dispatch.eligible, true);
  assert.equal(dispatch.fixtureOnly, true);
  assert.equal(dispatch.maximumModelTurns, 1);
  assert.equal(dispatch.maximumConcurrency, 1);
  assert.equal(dispatch.sandboxMode, "workspace-write");
  assert.equal(dispatch.approvalPolicy, "never");
  assert.equal(dispatch.paidFallbackAllowed, false);
  assert.equal(dispatch.repositoryMutationAuthority, false);
  assert.equal(dispatch.publicationAuthority, false);
  assert.equal(dispatch.modelTurnPerformed, false);
  assert.match(dispatch.evidenceBindings.supervisedAcceptanceSha256, /^[0-9a-f]{64}$/);
  assert.match(dispatch.stdinPrompt, /EVAVO_CODEX_SPARK_CAPACITY_HEARTBEAT/);
  assert.match(dispatch.stdinPrompt, /Do not modify any file/);

  fixture = buildFixture();
  const queue = JSON.parse(fs.readFileSync(fixture.queuePath, "utf8"));
  queue.readyCount = 0;
  fs.writeFileSync(fixture.queuePath, `${JSON.stringify(queue, null, 2)}\n`);
  dispatch = compile(fixture, 1);
  assert.ok(dispatch.errors.some((entry) => entry.includes("exact Work Exchange status") || entry.includes("READY work item")));

  fixture = buildFixture();
  const admission = JSON.parse(fs.readFileSync(fixture.admissionPath, "utf8"));
  admission.supervisedAcceptanceSha256 = "0".repeat(64);
  fs.writeFileSync(fixture.admissionPath, `${JSON.stringify(admission, null, 2)}\n`);
  dispatch = compile(fixture, 1);
  assert.ok(dispatch.errors.some((entry) => entry.includes("exact route admission") || entry.includes("supervised acceptance")));

  fixture = buildFixture();
  const capacity = JSON.parse(fs.readFileSync(fixture.effectivePath, "utf8"));
  capacity.eligible = true;
  capacity.effectiveState = "AVAILABLE";
  capacity.routes[0].eligible = true;
  capacity.routes[0].state = "AVAILABLE";
  fs.writeFileSync(fixture.effectivePath, `${JSON.stringify(capacity, null, 2)}\n`);
  dispatch = compile(fixture, 1);
  assert.ok(dispatch.errors.some((entry) => entry.includes("unnecessary while effective capacity is available") || entry.includes("exact effective-capacity status")));

  fixture = buildFixture();
  const auth = JSON.parse(fs.readFileSync(fixture.authPath, "utf8"));
  auth.apiKeyAllowed = true;
  fs.writeFileSync(fixture.authPath, `${JSON.stringify(auth, null, 2)}\n`);
  dispatch = compile(fixture, 1);
  assert.ok(dispatch.errors.some((entry) => entry.includes("exact authentication receipt") || entry.includes("permits API")));

  fixture = buildFixture();
  const capability = JSON.parse(fs.readFileSync(fixture.capabilityPath, "utf8"));
  capability.observedAt = new Date(Date.now() - 20 * 60_000).toISOString();
  fs.writeFileSync(fixture.capabilityPath, `${JSON.stringify(capability, null, 2)}\n`);
  dispatch = compile(fixture, 1);
  assert.ok(dispatch.errors.some((entry) => entry.includes("stale") || entry.includes("exact capability receipt")));

  console.log("Codex Spark capacity-heartbeat dispatch tests passed.");
  console.log("- queue demand and every effective-capacity evidence byte are hash-bound before dispatch");
  console.log("- the one-turn prompt is fixture-only, no-write, no-commit and no-publication");
  console.log("- queue drift, admission tampering, unnecessary probes, mixed/API auth and stale capability evidence fail closed");
  console.log("- no Codex process or model turn is started by this compiler test");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
