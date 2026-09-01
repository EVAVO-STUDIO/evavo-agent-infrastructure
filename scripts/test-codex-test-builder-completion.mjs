#!/usr/bin/env node

import assert from "node:assert/strict";

import { compileCodexTestBuilderCompletion } from "./codex-test-builder-completion-core.mjs";

const ROUTE_ADMISSION = "1".repeat(64);
const ACCEPTANCE = "2".repeat(64);
const CAPABILITY = "3".repeat(64);
const bytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");

const workItem = () => ({
  schemaVersion: 1,
  kind: "evavo-autonomous-work-item-v1",
  id: "work:test-builder-fixture",
  lifecycleState: "LEASED",
  workerClass: "test-generation",
  repository: "EVAVO-STUDIO/example",
  sourceRevision: "a".repeat(40),
  allowedPaths: ["tests/**"],
  forbiddenPaths: ["tests/fixtures/secrets/**"],
  requiredValidation: ["node scripts/test-example.mjs", "repository-test-suite"],
  paidFallbackAllowed: false,
});
const routePlan = () => ({
  schemaVersion: 1,
  kind: "evavo-worker-route-plan-v1",
  eligible: true,
  decision: "DISPATCH_ELIGIBLE",
  routeId: "codex-spark-pro",
  workerClass: "test-generation",
  routeAdmissionSha256: ROUTE_ADMISSION,
  supervisedAcceptanceSha256: ACCEPTANCE,
  capabilityReceiptSha256: CAPABILITY,
  routeAdmissionExpiresAt: "2026-09-01T05:10:00.000Z",
  paidFallbackUsed: false,
  executionPerformed: false,
});
const dispatchPlan = () => ({
  schemaVersion: 1,
  kind: "evavo-codex-worker-dispatch-plan-v1",
  eligible: true,
  workItemId: "work:test-builder-fixture",
  workerId: "spark-test-builder-fixture",
  workerClass: "test-generation",
  repository: "EVAVO-STUDIO/example",
  sourceRevision: "a".repeat(40),
  routeAdmissionSha256: ROUTE_ADMISSION,
  supervisedAcceptanceSha256: ACCEPTANCE,
  capabilityReceiptSha256: CAPABILITY,
  routeAdmissionExpiresAt: "2026-09-01T05:10:00.000Z",
  maximumConcurrency: 1,
  publicationAuthority: false,
  validationAuthority: false,
  paidFallbackUsed: false,
});
const runReceipt = (summary = {
  resultState: "SUCCESS",
  changedPaths: ["tests/example-regression.test.mjs"],
  assertionsAdded: ["Rejects a stale state transition"],
  assumptions: [],
  followUp: ["Run the externally owned repository validation queue"],
}) => ({
  schemaVersion: 1,
  kind: "evavo-codex-worker-run-v1",
  routeId: "codex-spark-pro",
  workItemId: "work:test-builder-fixture",
  workerId: "spark-test-builder-fixture",
  repository: "EVAVO-STUDIO/example",
  sourceRevision: "a".repeat(40),
  routeAdmissionSha256: ROUTE_ADMISSION,
  supervisedAcceptanceSha256: ACCEPTANCE,
  capabilityReceiptSha256: CAPABILITY,
  certificationMode: false,
  supervisedPhysicalAcceptanceVerifiedAtStart: true,
  startedAt: "2026-09-01T05:01:00.000Z",
  finishedAt: "2026-09-01T05:02:00.000Z",
  exitCode: 0,
  modelTurnCompleted: true,
  structuredTurnCompleted: true,
  candidateHeadChanged: false,
  candidateDirtyAfter: summary.resultState === "SUCCESS",
  deterministicValidationPerformed: false,
  paidFallbackUsed: false,
  publicationPerformed: false,
  jsonl: { parsedWorkerSummary: summary },
});

function compile({ work = workItem(), route = routePlan(), dispatch = dispatchPlan(), run = runReceipt() } = {}) {
  return compileCodexTestBuilderCompletion({
    workItem: work,
    workItemBytes: bytes(work),
    routePlan: route,
    routePlanBytes: bytes(route),
    dispatchPlan: dispatch,
    dispatchPlanBytes: bytes(dispatch),
    runReceipt: run,
    runReceiptBytes: bytes(run),
  });
}

{
  const completion = compile();
  assert.equal(completion.kind, "evavo-codex-test-builder-completion-v1");
  assert.equal(completion.lifecycleState, "READY_FOR_DETERMINISTIC_VALIDATION");
  assert.equal(completion.resultState, "SUCCESS");
  assert.deepEqual(completion.changedPaths, ["tests/example-regression.test.mjs"]);
  assert.equal(completion.routeAdmissionSha256, ROUTE_ADMISSION);
  assert.equal(completion.supervisedAcceptanceSha256, ACCEPTANCE);
  assert.equal(completion.capabilityReceiptSha256, CAPABILITY);
  assert.equal(completion.validationRequired, true);
  assert.equal(completion.deterministicValidationPerformed, false);
  assert.equal(completion.deterministicValidationPassed, false);
  assert.equal(completion.modelSessionMayClaimValidation, false);
  assert.equal(completion.workerCommitPerformed, false);
  assert.equal(completion.paidFallbackUsed, false);
  assert.equal(completion.publicationPerformed, false);
  assert.match(completion.workerSummarySha256, /^[0-9a-f]{64}$/);
  assert.match(completion.completionSha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(completion).includes("C:\\"), false);
}

{
  const route = routePlan();
  route.routeAdmissionSha256 = "4".repeat(64);
  assert.throws(() => compile({ route }), /Route admission identity changed/);
}

{
  const run = runReceipt();
  run.supervisedAcceptanceSha256 = "4".repeat(64);
  assert.throws(() => compile({ run }), /Supervised acceptance identity changed/);
}

{
  const run = runReceipt();
  run.capabilityReceiptSha256 = "4".repeat(64);
  assert.throws(() => compile({ run }), /capability identity changed/i);
}

{
  const run = runReceipt({
    resultState: "SUCCESS",
    changedPaths: ["src/production.mjs"],
    assertionsAdded: ["Adds coverage"],
    assumptions: [],
    followUp: [],
  });
  assert.throws(() => compile({ run }), /outside the admitted allowlist/);
}

{
  const run = runReceipt({
    resultState: "SUCCESS",
    changedPaths: ["tests/fixtures/secrets/token.json"],
    assertionsAdded: ["Adds coverage"],
    assumptions: [],
    followUp: [],
  });
  assert.throws(() => compile({ run }), /forbidden path/);
}

{
  const run = runReceipt({
    resultState: "SUCCESS",
    changedPaths: ["tests/example.test.mjs"],
    assertionsAdded: ["All tests passed"],
    assumptions: [],
    followUp: [],
  });
  assert.throws(() => compile({ run }), /claimed deterministic validation/);
}

{
  const summary = {
    resultState: "NO_ACTION",
    changedPaths: [],
    assertionsAdded: [],
    assumptions: ["Existing coverage already exercises the requested boundary"],
    followUp: [],
  };
  const completion = compile({ run: runReceipt(summary) });
  assert.equal(completion.lifecycleState, "NO_ACTION_REVIEW");
  assert.equal(completion.validationRequired, false);
  assert.deepEqual(completion.changedPaths, []);
}

{
  const route = routePlan();
  route.routeAdmissionExpiresAt = "2026-09-01T05:00:30.000Z";
  assert.throws(() => compile({ route }), /after route admission expired/);
}

{
  const run = runReceipt();
  run.candidateHeadChanged = true;
  assert.throws(() => compile({ run }), /changed candidate HEAD/);
}

{
  const run = runReceipt();
  run.certificationMode = true;
  assert.throws(() => compile({ run }), /Fixture certification receipts/);
}

{
  const run = runReceipt();
  run.jsonl.parsedWorkerSummary.unexpected = true;
  assert.throws(() => compile({ run }), /summary fields differ/);
}

{
  const summary = {
    resultState: "NEEDS_DEEP_WORKER",
    changedPaths: ["tests/partial.test.mjs"],
    assertionsAdded: [],
    assumptions: [],
    followUp: ["Production semantics require architecture review"],
  };
  assert.throws(() => compile({ run: runReceipt(summary) }), /may not retain worker-authored changed paths/);
}

{
  const first = compile();
  const second = compile();
  assert.equal(first.completionSha256, second.completionSha256);
  const run = runReceipt();
  run.finishedAt = "2026-09-01T05:02:01.000Z";
  const changed = compile({ run });
  assert.notEqual(first.completionSha256, changed.completionSha256);
}

console.log("Codex Test Builder completion tests passed.");
console.log("- route admission, supervised acceptance and capability identities remain continuous through execution");
console.log("- only allowlisted uncommitted test changes can become ready for deterministic validation");
console.log("- model output cannot claim tests passed, commit, publish or complete fixture certification as normal work");
console.log("- NO_ACTION and escalation states retain no worker-authored patch");
