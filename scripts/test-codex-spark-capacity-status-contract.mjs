#!/usr/bin/env node

import assert from "node:assert/strict";
import { compileCodexSparkCapacityStatus } from "./codex-spark-capacity-status-core.mjs";

const NOW = new Date("2026-09-01T08:00:00.000Z");
const digest = (character) => character.repeat(64);
const base = {
  now: NOW,
  routePolicy: {
    id: "codex-spark-pro",
    runtime: "codex",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    paidFallbackAllowed: false,
    workerClasses: ["test-generation", "documentation-truth", "migration"],
    maximumAutomaticConcurrency: 4,
  },
  physicalPolicy: {
    routeId: "codex-spark-pro",
    paidFallbackAllowed: false,
    initialWorkerClasses: ["test-generation"],
    initialMaximumConcurrency: 1,
  },
  capacityObservation: {
    schemaVersion: 1,
    kind: "evavo-codex-spark-capacity-observation-v1",
    routeId: "codex-spark-pro",
    state: "AVAILABLE",
    observedAt: "2026-09-01T07:58:00.000Z",
    maximumConcurrency: 3,
    paidFallbackUsed: false,
  },
  capabilityReceipt: {
    schemaVersion: 1,
    kind: "evavo-codex-worker-capability-probe-v1",
    observedAt: "2026-09-01T07:59:00.000Z",
    eligibleForWorkerDispatch: true,
    capabilities: {
      jsonFlag: "--json",
      modelFlag: "--model",
      sandboxFlag: "--sandbox",
      approvalFlag: "--ask-for-approval",
    },
  },
  authenticationReceipt: {
    schemaVersion: 1,
    kind: "evavo-codex-chatgpt-authentication-admission-v1",
    observedAt: "2026-09-01T07:59:30.000Z",
    accepted: true,
    authenticationClass: "chatgpt-consumer",
    credentialValuesReturned: false,
  },
  physicalVerification: {
    schemaVersion: 1,
    kind: "evavo-codex-spark-safe-physical-acceptance-verification-v1",
    accepted: true,
    routeId: "codex-spark-pro",
    workerClasses: ["test-generation", "documentation-truth"],
    maximumConcurrency: 3,
    paidFallbackAllowed: false,
    errors: [],
  },
  supervisedAt: "2026-09-01T07:57:00.000Z",
  sourceDigests: {
    capacityObservationSha256: digest("a"),
    capabilityReceiptSha256: digest("b"),
    authenticationReceiptSha256: digest("c"),
    supervisedAcceptanceSha256: digest("d"),
  },
};

const compile = (patch = {}) => compileCodexSparkCapacityStatus({ ...base, ...patch });

{
  const status = compile();
  const route = status.routes[0];
  assert.equal(status.kind, "evavo-worker-capacity-status-v1");
  assert.equal(status.rawCapacityAndPhysicalAdmissionAreSeparate, true);
  assert.equal(status.capacityAloneGrantsDispatch, false);
  assert.equal(route.dispatchEligible, true);
  assert.equal(route.decision, "DISPATCH_ELIGIBLE");
  assert.deepEqual(route.workerClasses, ["test-generation"]);
  assert.equal(route.maximumConcurrency, 1);
  assert.equal(route.paidFallbackAllowed, false);
  assert.equal(route.sourceDigests.supervisedAcceptanceSha256, digest("d"));
  assert.match(route.admissionSha256, /^[0-9a-f]{64}$/);
}

{
  const status = compile({
    physicalVerification: null,
    supervisedAt: null,
    sourceDigests: { ...base.sourceDigests, supervisedAcceptanceSha256: null },
  });
  const route = status.routes[0];
  assert.equal(route.rawCapacityState, "AVAILABLE");
  assert.equal(route.physicalAdmissionReady, false);
  assert.equal(route.dispatchEligible, false);
  assert.equal(route.decision, "RETAIN_READY_JOB");
  assert.deepEqual(route.workerClasses, []);
  assert.equal(route.maximumConcurrency, 0);
  assert.ok(route.reasons.includes("PHYSICAL_ADMISSION_NOT_READY"));
}

{
  const status = compile({
    capacityObservation: { ...base.capacityObservation, state: "EXHAUSTED" },
  });
  const route = status.routes[0];
  assert.equal(route.physicalAdmissionReady, true);
  assert.equal(route.rawCapacityState, "EXHAUSTED");
  assert.equal(route.dispatchEligible, false);
  assert.ok(route.reasons.includes("CAPACITY_EXHAUSTED"));
}

{
  const status = compile({
    capabilityReceipt: { ...base.capabilityReceipt, observedAt: "2026-09-01T07:30:00.000Z" },
  });
  assert.equal(status.routes[0].transportReady, false);
  assert.equal(status.routes[0].dispatchEligible, false);
}

{
  const status = compile({
    authenticationReceipt: {
      ...base.authenticationReceipt,
      accepted: false,
      authenticationClass: "unadmitted",
    },
  });
  assert.equal(status.routes[0].authenticationReady, false);
  assert.equal(status.routes[0].dispatchEligible, false);
}

{
  const status = compile({
    routePolicy: { ...base.routePolicy, workerClasses: ["documentation-truth"] },
  });
  assert.equal(status.routes[0].physicalAdmissionReady, true);
  assert.equal(status.routes[0].dispatchEligible, false);
  assert.ok(status.routes[0].reasons.includes("NO_PHYSICALLY_ADMITTED_WORKER_CLASS"));
}

{
  const status = compile({
    physicalVerification: { ...base.physicalVerification, routeId: "other-route" },
  });
  assert.equal(status.routes[0].physicalAdmissionReady, false);
  assert.equal(status.routes[0].dispatchEligible, false);
}

assert.throws(
  () => compile({ capacityObservation: { ...base.capacityObservation, paidFallbackUsed: true } }),
  /paidFallbackUsed=false/,
);
assert.throws(
  () => compile({ routePolicy: { ...base.routePolicy, paidFallbackAllowed: true } }),
  /paid fallback disabled/,
);
assert.throws(
  () => compile({ sourceDigests: { ...base.sourceDigests, supervisedAcceptanceSha256: null } }),
  /requires supervisedAcceptanceSha256/,
);

assert.deepEqual(compile(), compile(), "Fixed source evidence and time must compile deterministically.");

console.log("Codex Spark capacity-status contract tests passed.");
console.log("- raw capacity and physical admission remain distinct");
console.log("- AVAILABLE without supervised admission retains READY work");
console.log("- admitted worker classes are intersected with current route and physical policy");
console.log("- initial concurrency remains one even when upstream evidence advertises more");
console.log("- exhausted capacity, stale transport, rejected auth and route mismatch fail closed");
console.log("- paid fallback remains forbidden");
