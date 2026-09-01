#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compilePhysicalVerificationObservation } from "./codex-spark-physical-verification-observation-core.mjs";
import { compileCodexSparkRouteAdmission } from "./codex-spark-route-admission-core.mjs";

const root = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-canonical-evidence-"));
const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256File = (file) => sha256Bytes(fs.readFileSync(file));
const write = (name, value) => {
  const file = path.join(temporary, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
};
const invoke = (script, args, expectedStatus = 0) => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.status, expectedStatus, `${script}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return JSON.parse(String(expectedStatus === 0 ? result.stdout : result.stderr).trim());
};
const nowMs = Date.now();
const now = new Date(nowMs).toISOString();

try {
  const successfulWorkerRunPath = write("01-successful-worker-run", {
    schemaVersion: 1,
    kind: "evavo-codex-worker-run-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    structuredTurnCompleted: true,
    modelTurnCompleted: true,
    exitCode: 0,
    finishedAt: now,
    paidFallbackAllowed: false,
    paidFallbackUsed: false,
  });
  const rawCapacity = invoke("compile-codex-spark-raw-capacity-observation.mjs", [successfulWorkerRunPath]);
  assert.equal(rawCapacity.state, "AVAILABLE");
  assert.equal(rawCapacity.evidenceClass, "observed-not-inferred");
  const rawCapacityPath = write("02-raw-capacity", rawCapacity);

  const capability = {
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
  };
  const capabilityPath = write("03-capability", capability);

  const rawAuthProbePath = write("04-raw-auth-probe", {
    schemaVersion: 1,
    kind: "evavo-codex-chatgpt-auth-policy-probe-v1",
    observedAt: now,
    forcedLoginMethod: "chatgpt",
    credentialValuesRead: false,
  });
  const authentication = invoke("compile-codex-chatgpt-auth-observation.mjs", [rawAuthProbePath]);
  assert.equal(authentication.accepted, true);
  assert.equal(authentication.authenticationClass, "chatgpt-consumer");
  const authenticationPath = write("05-authentication", authentication);

  const acceptance = {
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
  };
  const acceptancePath = write("06-supervised-acceptance", acceptance);
  const acceptanceBytes = fs.readFileSync(acceptancePath);
  const capabilityBytes = fs.readFileSync(capabilityPath);
  const baseVerification = {
    schemaVersion: 1,
    kind: "evavo-codex-spark-safe-physical-acceptance-verification-v1",
    accepted: true,
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    workerClasses: ["test-generation"],
    maximumConcurrency: 1,
    paidFallbackAllowed: false,
    supervisedCleanupProven: true,
    errors: [],
    codexVersion: capability.version,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
  };
  const physicalVerification = compilePhysicalVerificationObservation({
    acceptanceBytes,
    capabilityBytes,
    verification: baseVerification,
  });
  assert.equal(physicalVerification.supervisedAcceptanceSha256, sha256File(acceptancePath));
  assert.equal(physicalVerification.codexCapabilityReceiptSha256, sha256File(capabilityPath));
  const physicalVerificationPath = write("07-physical-verification", physicalVerification);

  const routeAdmission = compileCodexSparkRouteAdmission({
    acceptanceBytes,
    capabilityBytes,
    authenticationBytes: fs.readFileSync(authenticationPath),
    physicalVerificationBytes: fs.readFileSync(physicalVerificationPath),
    acceptance,
    capability,
    authentication,
    physicalVerification,
    baseVerification,
    nowMs,
    ttlSeconds: 600,
  });
  assert.equal(routeAdmission.capacityAvailabilityProven, false);
  assert.equal(routeAdmission.supervisedAcceptanceSha256, sha256File(acceptancePath));
  assert.equal(routeAdmission.codexCapabilityReceiptSha256, sha256File(capabilityPath));
  assert.equal(routeAdmission.chatgptAuthenticationReceiptSha256, sha256File(authenticationPath));
  assert.equal(routeAdmission.physicalAcceptanceVerificationSha256, sha256File(physicalVerificationPath));
  const routeAdmissionPath = write("08-route-admission", routeAdmission);

  const effective = invoke("assemble-codex-spark-effective-capacity.mjs", [
    rawCapacityPath,
    capabilityPath,
    authenticationPath,
    physicalVerificationPath,
    routeAdmissionPath,
  ]);
  assert.equal(effective.ok, true);
  assert.equal(effective.eligible, true);
  assert.equal(effective.effectiveState, "AVAILABLE");
  assert.equal(effective.rawState, "AVAILABLE");
  assert.deepEqual(effective.routes[0].admittedWorkerClasses, ["test-generation"]);
  assert.equal(effective.routes[0].maximumConcurrency, 1);
  assert.equal(effective.routes[0].supervisedAcceptanceSha256, sha256File(acceptancePath));
  assert.equal(effective.routes[0].codexCapabilityReceiptSha256, sha256File(capabilityPath));
  assert.equal(effective.routes[0].physicalAcceptanceVerificationSha256, sha256File(physicalVerificationPath));
  assert.equal(effective.routes[0].routeAdmissionSha256, sha256File(routeAdmissionPath));
  assert.equal(effective.routes[0].rawCapacityObservationSha256, sha256File(rawCapacityPath));
  const effectivePath = write("09-effective-capacity", effective);

  const readyWorkPath = write("10-ready-work", {
    schemaVersion: 1,
    kind: "evavo-autonomous-improvement-work-item-v1",
    id: "work:canonical-pipeline:test-generation",
    lifecycleState: "READY",
    workerClass: "test-generation",
    capacityClass: "included-consumer",
    paidFallbackAllowed: false,
    repository: "EVAVO-STUDIO/evavo-game-runtime",
    sourceRevision: "a".repeat(40),
    objective: "Add focused malformed save-record coverage.",
  });
  const routePlan = invoke("plan-codex-spark-effective-route-v2.mjs", [readyWorkPath, effectivePath]);
  assert.equal(routePlan.schemaVersion, 2);
  assert.equal(routePlan.eligible, true);
  assert.equal(routePlan.decision, "DISPATCH_ELIGIBLE");
  assert.equal(routePlan.workerClass, "test-generation");
  assert.deepEqual(routePlan.admittedWorkerClasses, ["test-generation"]);
  assert.equal(routePlan.maximumConcurrency, 1);
  assert.equal(routePlan.supervisedAcceptanceSha256, sha256File(acceptancePath));
  assert.equal(routePlan.codexCapabilityReceiptSha256, sha256File(capabilityPath));
  assert.equal(routePlan.physicalAcceptanceVerificationSha256, sha256File(physicalVerificationPath));
  assert.equal(routePlan.routeAdmissionSha256, sha256File(routeAdmissionPath));
  assert.equal(routePlan.rawCapacityObservationSha256, sha256File(rawCapacityPath));
  assert.equal(routePlan.effectiveCapacityStatusSha256, sha256File(effectivePath));
  assert.equal(routePlan.paidFallbackUsed, false);
  assert.equal(routePlan.executionPerformed, false);

  const tamperedAdmission = {
    ...routeAdmission,
    codexCapabilityReceiptSha256: "0".repeat(64),
    bindings: {
      ...routeAdmission.bindings,
      codexCapabilityReceiptSha256: "0".repeat(64),
    },
  };
  const tamperedAdmissionPath = write("11-tampered-admission", tamperedAdmission);
  const rejected = invoke("assemble-codex-spark-effective-capacity.mjs", [
    rawCapacityPath,
    capabilityPath,
    authenticationPath,
    physicalVerificationPath,
    tamperedAdmissionPath,
  ], 1);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.contractErrors.some((entry) => entry.includes("exact Codex capability receipt")));

  console.log("Codex Spark canonical evidence-pipeline tests passed.");
  console.log("- successful-turn capacity, ChatGPT-only auth, physical verification and route admission remain separate evidence classes");
  console.log("- exact byte hashes flow through effective capacity and schema-v2 Test Builder route planning");
  console.log("- route admission never proves quota, while tampered cross-evidence bindings fail closed");
  console.log("- no Codex process, repository mutation, validation claim or publication occurs in this pipeline test");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
