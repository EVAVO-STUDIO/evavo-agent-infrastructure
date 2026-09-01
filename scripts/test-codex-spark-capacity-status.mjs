#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  canonicalJson,
  compileCodexSparkCapacityStatus,
  sha256Bytes,
} from "./codex-spark-capacity-status-core.mjs";

const NOW = new Date("2026-09-01T05:00:00.000Z");
const policy = {
  schemaVersion: 1,
  kind: "evavo-codex-spark-capacity-status-policy-v1",
  owner: "EVAVO-STUDIO/evavo-agent-infrastructure",
  routeId: "codex-spark-pro",
  modelPreference: "gpt-5.3-codex-spark",
  capacityClass: "included-consumer",
  allowedRawCapacityStates: ["AVAILABLE", "DEGRADED", "RATE_LIMITED", "EXHAUSTED", "AUTH_REQUIRED", "OFFLINE"],
  dispatchableRawCapacityStates: ["AVAILABLE", "DEGRADED"],
  admittedWorkerClasses: ["test-generation"],
  maximumConcurrency: 1,
  maximumCapacityObservationAgeSeconds: 600,
  maximumCapabilityReceiptAgeSeconds: 600,
  maximumRouteAdmissionAgeSeconds: 600,
  maximumPhysicalAcceptanceAgeSeconds: 604800,
  maximumFutureClockSkewSeconds: 120,
  requireSupervisedPhysicalAcceptance: true,
  requireSameCapabilityReceiptForVerificationAndDispatch: true,
  preserveRawCapacityStateSeparately: true,
  paidFallbackAllowed: false,
};

const bytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
const capacity = (state = "AVAILABLE", observedAt = "2026-09-01T04:55:00.000Z") => ({
  schemaVersion: 1,
  kind: "evavo-codex-capacity-observation-v1",
  observedAt,
  routes: [{
    routeId: "codex-spark-pro",
    state,
    observedAt,
    paidFallbackAllowed: false,
  }],
  paidFallbackAllowed: false,
});
const acceptance = () => ({
  schemaVersion: 1,
  kind: "evavo-codex-spark-safe-physical-acceptance-v1",
  supervisedAt: "2026-08-31T05:00:00.000Z",
  supervision: {
    cleanupComplete: true,
    fixtureRepositoryMainUnchanged: true,
    fixtureRepositoryClean: true,
    fixtureRepositoryRemoteCount: 0,
    registeredWorktreesAfterCleanup: 1,
  },
});
const capability = () => ({
  schemaVersion: 1,
  kind: "evavo-codex-worker-capability-probe-v1",
  eligibleForWorkerDispatch: true,
  observedAt: "2026-09-01T04:56:00.000Z",
  version: "fixture-codex",
  capabilities: {
    jsonFlag: "--json",
    modelFlag: "--model",
    sandboxFlag: "--sandbox",
    approvalFlag: "--ask-for-approval",
  },
});
const verification = (patch = {}) => ({
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
  ...patch,
});

function compile({ capacityDocument = capacity(), acceptanceDocument = acceptance(), capabilityDocument = capability(), verificationDocument = verification() } = {}) {
  return compileCodexSparkCapacityStatus({
    policy,
    capacityObservation: capacityDocument,
    capacityObservationBytes: bytes(capacityDocument),
    supervisedAcceptance: acceptanceDocument,
    supervisedAcceptanceBytes: bytes(acceptanceDocument),
    capabilityReceipt: capabilityDocument,
    capabilityReceiptBytes: bytes(capabilityDocument),
    acceptanceVerification: verificationDocument,
    acceptanceVerificationBytes: bytes(verificationDocument),
    now: NOW,
  });
}

{
  const syntax = spawnSync(process.execPath, ["--check", "scripts/assemble-codex-spark-capacity-status.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 256 * 1024,
  });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || syntax.error?.message);

  const missingArguments = spawnSync(process.execPath, ["scripts/assemble-codex-spark-capacity-status.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 256 * 1024,
  });
  assert.equal(missingArguments.status, 2);
  const error = JSON.parse(String(missingArguments.stderr).trim());
  assert.equal(error.kind, "evavo-worker-capacity-status-assembly-error-v1");
  assert.equal(error.ok, false);
  assert.equal(error.physicalPathsReturned, false);
  assert.equal(error.credentialValuesReturned, false);
  assert.equal(error.modelTurnPerformed, false);
  assert.equal(error.repositoryMutationPerformed, false);
  assert.equal(error.publicationPerformed, false);
}

{
  const status = compile();
  assert.equal(status.kind, "evavo-worker-capacity-status-v1");
  assert.equal(status.routes.length, 1);
  const route = status.routes[0];
  assert.equal(route.routeId, "codex-spark-pro");
  assert.equal(route.state, "AVAILABLE");
  assert.equal(route.rawCapacityState, "AVAILABLE");
  assert.equal(route.capacityDispatchable, true);
  assert.equal(route.physicalAdmissionAccepted, true);
  assert.equal(route.dispatchEligible, true);
  assert.equal(route.routeAdmission.admitted, true);
  assert.equal(route.routeAdmission.admissionState, "ADMITTED");
  assert.deepEqual(route.admittedWorkerClasses, ["test-generation"]);
  assert.equal(route.maximumConcurrency, 1);
  assert.equal(route.maximumAutomaticConcurrency, 1);
  assert.match(route.routeAdmissionSha256, /^[0-9a-f]{64}$/);
  assert.equal(route.routeAdmissionSha256, route.routeAdmission.routeAdmissionSha256);
  assert.equal(route.routeAdmission.evidence.supervisedAcceptance.sha256, route.supervisedAcceptanceSha256);
  assert.equal(route.routeAdmission.evidence.capabilityReceipt.sha256, route.capabilityReceiptSha256);
  assert.equal(status.capacityAloneIsExecutionAuthority, false);
  assert.equal(status.paidFallbackUsed, false);
  assert.equal(status.modelTurnPerformed, false);
  assert.equal(status.repositoryMutationPerformed, false);
  assert.equal(status.publicationPerformed, false);
  assert.ok(Date.parse(status.expiresAt) > NOW.getTime());
  assert.ok(Date.parse(status.expiresAt) - NOW.getTime() <= 600_000);
}

{
  const status = compile({ capacityDocument: capacity("EXHAUSTED") });
  const route = status.routes[0];
  assert.equal(route.state, "EXHAUSTED");
  assert.equal(route.rawCapacityState, "EXHAUSTED");
  assert.equal(route.physicalAdmissionAccepted, true);
  assert.equal(route.capacityDispatchable, false);
  assert.equal(route.dispatchEligible, false);
  assert.equal(route.routeAdmission.admissionState, "CAPACITY_UNAVAILABLE");
  assert.deepEqual(route.routeAdmission.admissionErrors, []);
}

{
  const status = compile({ verificationDocument: verification({ accepted: false, supervisedCleanupProven: false, errors: ["fixture rejected"] }) });
  const route = status.routes[0];
  assert.equal(route.rawCapacityState, "AVAILABLE");
  assert.equal(route.capacityDispatchable, true);
  assert.equal(route.physicalAdmissionAccepted, false);
  assert.equal(route.dispatchEligible, false);
  assert.equal(route.routeAdmission.admissionState, "PHYSICAL_ADMISSION_REJECTED");
  assert.ok(route.routeAdmission.admissionErrors.some((entry) => entry.includes("not positively verified")));
}

{
  const status = compile({ capacityDocument: capacity("AVAILABLE", "2026-09-01T04:30:00.000Z") });
  const route = status.routes[0];
  assert.equal(route.dispatchEligible, false);
  assert.ok(route.routeAdmission.admissionErrors.some((entry) => entry.includes("stale")));
}

{
  const status = compile({ verificationDocument: verification({ workerClasses: ["test-generation", "fast-coding"] }) });
  const route = status.routes[0];
  assert.equal(route.dispatchEligible, false);
  assert.ok(route.routeAdmission.admissionErrors.some((entry) => entry.includes("worker classes")));
}

{
  const status = compile({ verificationDocument: verification({ maximumConcurrency: 2 }) });
  const route = status.routes[0];
  assert.equal(route.dispatchEligible, false);
  assert.ok(route.routeAdmission.admissionErrors.some((entry) => entry.includes("concurrency")));
}

{
  const unsafe = capacity();
  unsafe.routes[0].paidFallbackAllowed = true;
  assert.throws(() => compile({ capacityDocument: unsafe }), /paid fallback/i);
}

{
  const firstCapacity = capacity();
  const first = compile({ capacityDocument: firstCapacity });
  const secondCapacity = capacity();
  secondCapacity.observer = "different-exact-bytes";
  const second = compile({ capacityDocument: secondCapacity });
  assert.notEqual(first.routes[0].capacityObservationSha256, second.routes[0].capacityObservationSha256);
  assert.notEqual(first.routes[0].routeAdmissionSha256, second.routes[0].routeAdmissionSha256);
  assert.equal(
    first.routes[0].routeAdmissionSha256,
    sha256Bytes(Buffer.from(canonicalJson({
      ...first.routes[0].routeAdmission,
      routeAdmissionSha256: undefined,
    }), "utf8")),
    "route admission digest remains deterministic when recomputed over the digest-free body",
  );
}

{
  const statusText = JSON.stringify(compile());
  assert.equal(/(?:[A-Za-z]:[\\/]|\/tmp\/|\/home\/)/.test(statusText), false);
  assert.equal(statusText.includes("OPENAI_API_KEY"), false);
  assert.equal(statusText.includes("GH_TOKEN"), false);
}

console.log("Codex Spark capacity status tests passed.");
console.log("- the capacity assembler parses and emits a bounded pathless error envelope on invalid invocation");
console.log("- raw capacity remains separate from supervised physical admission");
console.log("- available capacity cannot bypass rejected, stale, broadened or over-concurrent admission evidence");
console.log("- exhausted capacity remains exhausted even when physical admission is valid");
console.log("- route admission is short-lived, exact-byte bound, pathless and zero-paid-fallback");
