#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const script = path.join(root, "scripts", "assemble-codex-spark-effective-capacity.mjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-effective-capacity-"));
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const write = (name, value) => {
  const file = path.join(temporary, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "w" });
  return file;
};
const nowIso = () => new Date().toISOString();
const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();

function fixture(overrides = {}) {
  const raw = {
    schemaVersion: 1,
    kind: "evavo-codex-spark-raw-capacity-observation-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    state: "AVAILABLE",
    observedAt: nowIso(),
    source: "synthetic-contract-test",
    evidenceClass: "observed-not-inferred",
    maximumConcurrency: 4,
    paidFallbackAllowed: false,
    paidFallbackUsed: false,
    ...overrides.raw,
  };
  const capability = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-capability-probe-v1",
    eligibleForWorkerDispatch: true,
    observedAt: nowIso(),
    version: "fixture-codex",
    capabilities: {
      jsonFlag: "--json",
      modelFlag: "--model",
      sandboxFlag: "--sandbox",
      approvalFlag: "--ask-for-approval",
    },
    ...overrides.capability,
  };
  const authentication = {
    schemaVersion: 1,
    kind: "evavo-codex-chatgpt-auth-policy-probe-v1",
    accepted: true,
    authPolicyAccepted: true,
    authenticationClass: "chatgpt-consumer",
    chatgptOnly: true,
    apiKeyAllowed: false,
    mixedLoginAllowed: false,
    observedAt: nowIso(),
    ...overrides.authentication,
  };
  const supervisedAcceptanceSha256 = "a".repeat(64);
  const physical = {
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
    observedAt: nowIso(),
    ...overrides.physical,
  };

  const rawPath = write("raw.json", raw);
  const capabilityPath = write("capability.json", capability);
  const authenticationPath = write("authentication.json", authentication);
  const physicalPath = write("physical.json", physical);
  const admission = {
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
    admittedAt: nowIso(),
    expiresAt: minutesFromNow(5),
    supervisedAcceptanceSha256,
    codexCapabilityReceiptSha256: hash(capabilityPath),
    physicalAcceptanceVerificationSha256: hash(physicalPath),
    ...overrides.admission,
  };
  const admissionPath = write("admission.json", admission);
  return { rawPath, capabilityPath, authenticationPath, physicalPath, admissionPath };
}

function invoke(paths) {
  const result = spawnSync(
    process.execPath,
    [script, paths.rawPath, paths.capabilityPath, paths.authenticationPath, paths.physicalPath, paths.admissionPath],
    { cwd: root, encoding: "utf8", shell: false },
  );
  const text = String(result.status === 0 ? result.stdout : result.stderr).trim();
  let receipt;
  try {
    receipt = JSON.parse(text);
  } catch {
    throw new Error(`Effective-capacity assembler returned invalid JSON. status=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  return { result, receipt };
}

try {
  let run = invoke(fixture());
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.kind, "evavo-worker-capacity-status-v1");
  assert.equal(run.receipt.ok, true);
  assert.equal(run.receipt.eligible, true);
  assert.equal(run.receipt.effectiveState, "AVAILABLE");
  assert.deepEqual(run.receipt.routes[0].admittedWorkerClasses, ["test-generation"]);
  assert.equal(run.receipt.routes[0].maximumConcurrency, 1);
  assert.equal(run.receipt.routes[0].paidFallbackAllowed, false);
  assert.equal(run.receipt.capacityInferredFromTransport, false);
  assert.equal(run.receipt.capacityInferredFromAuthentication, false);
  assert.equal(run.receipt.capacityInferredFromPhysicalAcceptance, false);

  run = invoke(fixture({ raw: { state: "EXHAUSTED" } }));
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.effectiveState, "EXHAUSTED");
  assert.equal(run.receipt.rawState, "EXHAUSTED");
  assert.equal(run.receipt.eligible, false);
  assert.equal(run.receipt.routes[0].maximumConcurrency, 0);

  run = invoke(fixture({ raw: { state: "RATE_LIMITED" } }));
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.effectiveState, "RATE_LIMITED");
  assert.equal(run.receipt.eligible, false);

  run = invoke(
    fixture({
      admission: {
        admittedAt: minutesFromNow(-20),
        expiresAt: minutesFromNow(5),
      },
    }),
  );
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.effectiveState, "UNKNOWN");
  assert.equal(run.receipt.eligible, false);
  assert.ok(run.receipt.blockingReasons.some((entry) => entry.includes("route-admission:timestamp-stale")));

  const mismatched = fixture();
  const admissionMismatch = JSON.parse(fs.readFileSync(mismatched.admissionPath, "utf8"));
  admissionMismatch.codexCapabilityReceiptSha256 = "b".repeat(64);
  fs.writeFileSync(mismatched.admissionPath, `${JSON.stringify(admissionMismatch, null, 2)}\n`);
  run = invoke(mismatched);
  assert.equal(run.result.status, 1);
  assert.equal(run.receipt.ok, false);
  assert.ok(run.receipt.contractErrors.some((entry) => entry.includes("exact Codex capability receipt")));

  run = invoke(fixture({ admission: { workerClasses: ["test-generation", "fast-coding"] } }));
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.contractErrors.some((entry) => entry.includes("unapproved worker classes")));

  run = invoke(fixture({ physical: { maximumConcurrency: 2 } }));
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.contractErrors.some((entry) => entry.includes("concurrency ceiling")));

  run = invoke(
    fixture({
      authentication: {
        accepted: false,
        authPolicyAccepted: false,
        chatgptOnly: false,
        eligibleForConsumerAuth: false,
      },
    }),
  );
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.effectiveState, "AUTH_REQUIRED");
  assert.equal(run.receipt.eligible, false);

  run = invoke(fixture({ raw: { paidFallbackUsed: true } }));
  assert.equal(run.result.status, 1);
  assert.ok(run.receipt.contractErrors.some((entry) => entry.includes("paid fallback")));

  run = invoke(fixture({ capability: { observedAt: minutesFromNow(-20) } }));
  assert.equal(run.result.status, 0, run.result.stderr);
  assert.equal(run.receipt.effectiveState, "OFFLINE");
  assert.equal(run.receipt.eligible, false);

  console.log("Codex Spark effective-capacity tests passed.");
  console.log("- raw exhaustion and rate limits remain authoritative");
  console.log("- transport, authentication and physical acceptance cannot impersonate capacity");
  console.log("- only test-generation at concurrency one survives the initial admission intersection");
  console.log("- stale, mismatched, escalated or paid-fallback evidence fails closed");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
