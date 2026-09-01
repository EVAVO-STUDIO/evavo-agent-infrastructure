#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  canonicalJson,
  compileCodexTestBuilderCompletion,
  sha256Bytes,
} from "./codex-test-builder-completion-core.mjs";

const ROUTE_ADMISSION = "1".repeat(64);
const ACCEPTANCE = "2".repeat(64);
const CAPABILITY = "3".repeat(64);
const SOURCE = "a".repeat(40);
const DEFAULT_PATH = "tests/example-regression.test.mjs";
const bytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");

const workItem = () => ({
  schemaVersion: 1,
  kind: "evavo-autonomous-work-item-v1",
  id: "work:test-builder-fixture",
  lifecycleState: "LEASED",
  workerClass: "test-generation",
  repository: "EVAVO-STUDIO/example",
  sourceRevision: SOURCE,
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
  sourceRevision: SOURCE,
  routeAdmissionSha256: ROUTE_ADMISSION,
  supervisedAcceptanceSha256: ACCEPTANCE,
  capabilityReceiptSha256: CAPABILITY,
  routeAdmissionExpiresAt: "2026-09-01T05:10:00.000Z",
  maximumConcurrency: 1,
  publicationAuthority: false,
  validationAuthority: false,
  paidFallbackUsed: false,
});
const defaultSummary = () => ({
  resultState: "SUCCESS",
  changedPaths: [DEFAULT_PATH],
  assertionsAdded: ["Rejects a stale state transition"],
  assumptions: [],
  followUp: ["Run the externally owned repository validation queue"],
});
const runReceipt = (summary = defaultSummary()) => ({
  schemaVersion: 1,
  kind: "evavo-codex-worker-run-v1",
  routeId: "codex-spark-pro",
  workItemId: "work:test-builder-fixture",
  workerId: "spark-test-builder-fixture",
  workerClass: "test-generation",
  repository: "EVAVO-STUDIO/example",
  sourceRevision: SOURCE,
  routeAdmissionSha256: ROUTE_ADMISSION,
  supervisedAcceptanceSha256: ACCEPTANCE,
  capabilityReceiptSha256: CAPABILITY,
  certificationMode: false,
  routeAdmissionVerifiedAtStart: true,
  supervisedPhysicalAcceptanceVerifiedAtStart: true,
  startedAt: "2026-09-01T05:01:00.000Z",
  finishedAt: "2026-09-01T05:02:00.000Z",
  exitCode: 0,
  modelTurnCompleted: true,
  structuredTurnCompleted: true,
  candidateHeadAfter: SOURCE,
  candidateHeadChanged: false,
  candidateDirtyAfter: summary.resultState === "SUCCESS",
  deterministicValidationPerformed: false,
  paidFallbackUsed: false,
  publicationPerformed: false,
  jsonl: { parsedWorkerSummary: summary },
});
function observation({
  changedPaths = [DEFAULT_PATH],
  trackedPaths = changedPaths,
  untrackedPaths = [],
  stagedPaths = [],
  unmergedPaths = [],
  candidateDirty = changedPaths.length > 0 || stagedPaths.length > 0 || unmergedPaths.length > 0,
  observedAt = "2026-09-01T05:02:01.000Z",
} = {}) {
  const body = {
    schemaVersion: 1,
    kind: "evavo-codex-candidate-change-observation-v1",
    observedAt,
    workItemId: "work:test-builder-fixture",
    workerId: "spark-test-builder-fixture",
    repository: "EVAVO-STUDIO/example",
    sourceRevision: SOURCE,
    candidateHead: SOURCE,
    candidateHeadChanged: false,
    candidateDirty,
    changedPaths: [...changedPaths],
    changedPathCount: changedPaths.length,
    trackedPaths: [...trackedPaths],
    untrackedPaths: [...untrackedPaths],
    stagedPaths: [...stagedPaths],
    stagedPathCount: stagedPaths.length,
    indexChanged: stagedPaths.length > 0,
    unmergedPaths: [...unmergedPaths],
    unmergedPathCount: unmergedPaths.length,
    statusSha256: "4".repeat(64),
    trackedDiffSha256: "5".repeat(64),
    stagedDiffSha256: "6".repeat(64),
    untrackedListSha256: "7".repeat(64),
    unmergedListSha256: "8".repeat(64),
    gitObservationPerformed: true,
    candidateBytesMutatedByObserver: false,
    gitIndexMutationAccepted: false,
    workerCommitAccepted: false,
    physicalPathsReturned: false,
    credentialValuesReturned: false,
    deterministicValidationPerformed: false,
    publicationPerformed: false,
    truthBoundary: "fixture observation",
  };
  return {
    ...body,
    observationSha256: sha256Bytes(Buffer.from(canonicalJson(body), "utf8")),
  };
}

function compile({
  work = workItem(),
  route = routePlan(),
  dispatch = dispatchPlan(),
  run = runReceipt(),
  observed = observation(),
} = {}) {
  return compileCodexTestBuilderCompletion({
    workItem: work,
    workItemBytes: bytes(work),
    routePlan: route,
    routePlanBytes: bytes(route),
    dispatchPlan: dispatch,
    dispatchPlanBytes: bytes(dispatch),
    runReceipt: run,
    runReceiptBytes: bytes(run),
    candidateObservation: observed,
    candidateObservationBytes: bytes(observed),
  });
}

{
  const completion = compile();
  assert.equal(completion.kind, "evavo-codex-test-builder-completion-v1");
  assert.equal(completion.lifecycleState, "READY_FOR_DETERMINISTIC_VALIDATION");
  assert.equal(completion.resultState, "SUCCESS");
  assert.deepEqual(completion.changedPaths, [DEFAULT_PATH]);
  assert.deepEqual(completion.workerReportedChangedPaths, [DEFAULT_PATH]);
  assert.deepEqual(completion.independentlyObservedChangedPaths, [DEFAULT_PATH]);
  assert.equal(completion.changedPathContinuityProven, true);
  assert.equal(completion.routeAdmissionSha256, ROUTE_ADMISSION);
  assert.equal(completion.supervisedAcceptanceSha256, ACCEPTANCE);
  assert.equal(completion.capabilityReceiptSha256, CAPABILITY);
  assert.equal(completion.validationRequired, true);
  assert.equal(completion.deterministicValidationPerformed, false);
  assert.equal(completion.deterministicValidationPassed, false);
  assert.equal(completion.modelSessionMayClaimValidation, false);
  assert.equal(completion.candidateIndexChanged, false);
  assert.equal(completion.candidateUnmergedState, false);
  assert.equal(completion.workerCommitPerformed, false);
  assert.equal(completion.paidFallbackUsed, false);
  assert.equal(completion.publicationPerformed, false);
  assert.match(completion.workerSummarySha256, /^[0-9a-f]{64}$/);
  assert.match(completion.candidateObservationSha256, /^[0-9a-f]{64}$/);
  assert.match(completion.completionSha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(completion).includes("C:\\"), false);
}

{
  const route = routePlan();
  route.routeAdmissionSha256 = "9".repeat(64);
  assert.throws(() => compile({ route }), /Route admission identity changed/);
}

{
  const run = runReceipt();
  run.supervisedAcceptanceSha256 = "9".repeat(64);
  assert.throws(() => compile({ run }), /Supervised acceptance identity changed/);
}

{
  const run = runReceipt();
  run.capabilityReceiptSha256 = "9".repeat(64);
  assert.throws(() => compile({ run }), /capability identity changed/i);
}

{
  const summary = defaultSummary();
  summary.changedPaths = ["src/production.mjs"];
  const run = runReceipt(summary);
  const observed = observation({ changedPaths: ["src/production.mjs"] });
  assert.throws(() => compile({ run, observed }), /outside the admitted allowlist/);
}

{
  const summary = defaultSummary();
  summary.changedPaths = ["tests/fixtures/secrets/token.json"];
  const run = runReceipt(summary);
  const observed = observation({ changedPaths: ["tests/fixtures/secrets/token.json"] });
  assert.throws(() => compile({ run, observed }), /forbidden path/);
}

{
  const summary = defaultSummary();
  summary.assertionsAdded = ["All tests passed"];
  assert.throws(() => compile({ run: runReceipt(summary) }), /claimed deterministic validation/);
}

{
  const summary = {
    resultState: "NO_ACTION",
    changedPaths: [],
    assertionsAdded: [],
    assumptions: ["Existing coverage already exercises the requested boundary"],
    followUp: [],
  };
  const run = runReceipt(summary);
  run.candidateDirtyAfter = false;
  const observed = observation({ changedPaths: [], trackedPaths: [], candidateDirty: false });
  const completion = compile({ run, observed });
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
  run.routeAdmissionVerifiedAtStart = false;
  assert.throws(() => compile({ run }), /short-lived route admission/);
}

{
  const run = runReceipt();
  run.jsonl.parsedWorkerSummary.unexpected = true;
  assert.throws(() => compile({ run }), /summary fields differ/);
}

{
  const summary = defaultSummary();
  summary.changedPaths = [];
  const run = runReceipt(summary);
  assert.throws(() => compile({ run }), /reported changedPaths differ/);
}

{
  const summary = defaultSummary();
  summary.changedPaths = [DEFAULT_PATH, "tests/unobserved.test.mjs"];
  const run = runReceipt(summary);
  assert.throws(() => compile({ run }), /reported changedPaths differ/);
}

{
  const observed = observation({ stagedPaths: [DEFAULT_PATH] });
  assert.throws(() => compile({ observed }), /staged\/index changes/);
}

{
  const observed = observation({ unmergedPaths: [DEFAULT_PATH] });
  assert.throws(() => compile({ observed }), /unmerged Git state/);
}

{
  const run = runReceipt();
  run.candidateDirtyAfter = false;
  assert.throws(() => compile({ run }), /dirty state differs/);
}

{
  const observed = observation();
  observed.observationSha256 = "9".repeat(64);
  assert.throws(() => compile({ observed }), /digest does not match/);
}

{
  const observed = observation();
  observed.workerId = "different-worker";
  const { observationSha256: _old, ...body } = observed;
  observed.observationSha256 = sha256Bytes(Buffer.from(canonicalJson(body), "utf8"));
  assert.throws(() => compile({ observed }), /identity differs/);
}

{
  const summary = {
    resultState: "NEEDS_DEEP_WORKER",
    changedPaths: ["tests/partial.test.mjs"],
    assertionsAdded: [],
    assumptions: [],
    followUp: ["Production semantics require architecture review"],
  };
  const run = runReceipt(summary);
  run.candidateDirtyAfter = true;
  const observed = observation({ changedPaths: ["tests/partial.test.mjs"] });
  assert.throws(() => compile({ run, observed }), /may not retain independently observed worker-authored changes/);
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
console.log("- the model-reported path set must exactly equal an independent post-turn Git observation");
console.log("- staged/index changes, unmerged state, commits, hidden extra paths and omitted paths fail closed");
console.log("- only allowlisted uncommitted candidate changes can become ready for deterministic validation");
console.log("- model output cannot claim tests passed, publish or complete fixture certification as normal work");
console.log("- NO_ACTION and escalation states retain no independently observed worker-authored patch");
