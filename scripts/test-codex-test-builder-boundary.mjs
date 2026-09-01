#!/usr/bin/env node

import assert from "node:assert/strict";

import {
  bindCodexTestBuilderCompletion,
  canonicalJson,
  sha256Bytes,
} from "./codex-test-builder-boundary-core.mjs";

const SOURCE = "a".repeat(40);
const WORKER = "spark-boundary-fixture";
const PATH = "tests/boundary.test.mjs";
const ROUTE = "1".repeat(64);
const ACCEPTANCE = "2".repeat(64);
const CAPABILITY = "3".repeat(64);
const bytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
const digest = (value) => sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
const withDigest = (body, field) => ({ ...body, [field]: digest(body) });

function fixture() {
  const workItem = {
    schemaVersion: 1,
    kind: "evavo-autonomous-work-item-v1",
    id: "work:boundary-fixture",
    lifecycleState: "LEASED",
    workerClass: "test-generation",
    repository: "EVAVO-STUDIO/example",
    sourceRevision: SOURCE,
    allowedPaths: ["tests/**"],
    forbiddenPaths: ["tests/secrets/**"],
    requiredValidation: [{ executable: "node", argv: ["scripts/test-example.mjs"] }],
    paidFallbackAllowed: false,
  };
  const workBytes = bytes(workItem);
  const routeBody = {
    schemaVersion: 1,
    kind: "evavo-worker-route-plan-v1",
    eligible: true,
    decision: "DISPATCH_ELIGIBLE",
    workerClass: workItem.workerClass,
    repository: workItem.repository,
    sourceRevision: SOURCE,
    routeId: "codex-spark-pro",
    routeAdmissionSha256: ROUTE,
    supervisedAcceptanceSha256: ACCEPTANCE,
    capabilityReceiptSha256: CAPABILITY,
    paidFallbackUsed: false,
  };
  const routePlan = withDigest(routeBody, "routePlanSha256");
  const routeBytes = bytes(routePlan);
  const legacy = "4".repeat(64);
  const dispatchBody = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-dispatch-plan-v1",
    eligible: true,
    dispatchBindingVersion: 1,
    legacyDispatchPlanSha256: legacy,
    workItemId: workItem.id,
    workerId: WORKER,
    workerClass: workItem.workerClass,
    repository: workItem.repository,
    sourceRevision: SOURCE,
    routeId: "codex-spark-pro",
    routePlanSha256: routePlan.routePlanSha256,
    routePlanBytesSha256: sha256Bytes(routeBytes),
    workItemBytesSha256: sha256Bytes(workBytes),
    allowedPathsSha256: digest(workItem.allowedPaths),
    forbiddenPathsSha256: digest(workItem.forbiddenPaths),
    requiredValidationSha256: digest(workItem.requiredValidation),
    routeAdmissionSha256: ROUTE,
    supervisedAcceptanceSha256: ACCEPTANCE,
    capabilityReceiptSha256: CAPABILITY,
    validationAuthority: false,
    publicationAuthority: false,
    paidFallbackUsed: false,
  };
  const dispatchPlan = withDigest(dispatchBody, "dispatchPlanSha256");
  const dispatchBytes = bytes(dispatchPlan);
  const runReceipt = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-run-v1",
    workItemId: workItem.id,
    workerId: WORKER,
    workerClass: workItem.workerClass,
    repository: workItem.repository,
    sourceRevision: SOURCE,
    routePlanSha256: routePlan.routePlanSha256,
    dispatchPlanSha256: dispatchPlan.dispatchPlanSha256,
    dispatchPlanBytesSha256: sha256Bytes(dispatchBytes),
    routeAdmissionSha256: ROUTE,
    supervisedAcceptanceSha256: ACCEPTANCE,
    capabilityReceiptSha256: CAPABILITY,
    routeAdmissionVerifiedAtStart: true,
    supervisedPhysicalAcceptanceVerifiedAtStart: true,
    startedAt: "2026-09-01T05:00:00.000Z",
    finishedAt: "2026-09-01T05:01:00.000Z",
    exitCode: 0,
    modelTurnCompleted: true,
    structuredTurnCompleted: true,
    candidateHeadChanged: false,
    candidateDirtyAfter: true,
    deterministicValidationPerformed: false,
    publicationPerformed: false,
    paidFallbackUsed: false,
  };
  const manifest = [{
    path: PATH,
    origin: "tracked",
    state: "present",
    byteLength: 22,
    sha256: "5".repeat(64),
    executable: false,
  }];
  const state = {
    schemaVersion: 1,
    kind: "evavo-codex-candidate-state-v1",
    sourceRevision: SOURCE,
    candidateHead: SOURCE,
    candidateDirty: true,
    changedPaths: [PATH],
    trackedPaths: [PATH],
    untrackedPaths: [],
    stagedPaths: [],
    unmergedPaths: [],
    statusSha256: "6".repeat(64),
    statusByteLength: 31,
    trackedPathListSha256: "7".repeat(64),
    stagedPathListSha256: "8".repeat(64),
    untrackedListSha256: "9".repeat(64),
    unmergedListSha256: "a".repeat(64),
    trackedPatchSha256: "b".repeat(64),
    trackedPatchByteLength: 128,
    candidateFileManifest: manifest,
    candidateFileManifestSha256: digest(manifest),
    untrackedFileManifestSha256: digest([]),
    changedFileBytes: 22,
    gitIndexSha256: "c".repeat(64),
    gitIndexByteLength: 256,
  };
  const observationBody = {
    schemaVersion: 1,
    kind: "evavo-codex-candidate-change-observation-v1",
    observedAt: "2026-09-01T05:01:01.000Z",
    workItemId: workItem.id,
    workerId: WORKER,
    repository: workItem.repository,
    sourceRevision: SOURCE,
    candidateHead: SOURCE,
    candidateHeadChanged: false,
    candidateDirty: true,
    changedPaths: [PATH],
    changedPathCount: 1,
    trackedPaths: [PATH],
    untrackedPaths: [],
    stagedPaths: [],
    stagedPathCount: 0,
    indexChanged: false,
    unmergedPaths: [],
    unmergedPathCount: 0,
    statusSha256: state.statusSha256,
    trackedDiffSha256: state.trackedPatchSha256,
    trackedPathListSha256: state.trackedPathListSha256,
    stagedDiffSha256: state.stagedPathListSha256,
    untrackedListSha256: state.untrackedListSha256,
    unmergedListSha256: state.unmergedListSha256,
    trackedPatchSha256: state.trackedPatchSha256,
    trackedPatchByteLength: state.trackedPatchByteLength,
    candidateFileManifest: manifest,
    candidateFileManifestSha256: state.candidateFileManifestSha256,
    untrackedFileManifestSha256: state.untrackedFileManifestSha256,
    changedFileBytes: 22,
    gitIndexSha256: state.gitIndexSha256,
    gitIndexByteLength: state.gitIndexByteLength,
    candidateState: state,
    candidateStateSha256: digest(state),
    snapshotStable: true,
    snapshotPasses: 2,
    gitObservationPerformed: true,
    candidateBytesMutatedByObserver: false,
    gitIndexMutationAccepted: false,
    workerCommitAccepted: false,
    deterministicValidationPerformed: false,
    publicationPerformed: false,
  };
  const candidateObservation = withDigest(observationBody, "observationSha256");
  const baseBody = {
    schemaVersion: 1,
    kind: "evavo-codex-test-builder-completion-v1",
    workItemId: workItem.id,
    workerId: WORKER,
    repository: workItem.repository,
    sourceRevision: SOURCE,
    workerClass: workItem.workerClass,
    resultState: "SUCCESS",
    lifecycleState: "READY_FOR_DETERMINISTIC_VALIDATION",
    changedPaths: [PATH],
    routeAdmissionSha256: ROUTE,
    supervisedAcceptanceSha256: ACCEPTANCE,
    capabilityReceiptSha256: CAPABILITY,
    deterministicValidationPerformed: false,
    publicationPerformed: false,
    workerCommitPerformed: false,
    publicationAuthority: false,
  };
  const baseCompletion = withDigest(baseBody, "completionSha256");
  return { workItem, routePlan, dispatchPlan, runReceipt, candidateObservation, baseCompletion };
}

function bind(source = fixture()) {
  return bindCodexTestBuilderCompletion({
    workItem: source.workItem,
    workItemBytes: bytes(source.workItem),
    routePlan: source.routePlan,
    routePlanBytes: bytes(source.routePlan),
    dispatchPlan: source.dispatchPlan,
    dispatchPlanBytes: bytes(source.dispatchPlan),
    runReceipt: source.runReceipt,
    runReceiptBytes: bytes(source.runReceipt),
    candidateObservation: source.candidateObservation,
    candidateObservationBytes: bytes(source.candidateObservation),
    baseCompletion: source.baseCompletion,
  });
}

{
  const result = bind();
  assert.equal(result.completionBindingVersion, 1);
  assert.equal(result.candidateContentContinuityProven, true);
  assert.equal(result.lifecycleState, "READY_FOR_DETERMINISTIC_VALIDATION");
  for (const field of [
    "baseCompletionSha256", "workItemBytesSha256", "routePlanSha256", "routePlanBytesSha256",
    "dispatchPlanSha256", "dispatchPlanBytesSha256", "runReceiptBytesSha256",
    "candidateObservationSha256", "candidateObservationBytesSha256", "candidateStateSha256",
    "trackedPatchSha256", "candidateFileManifestSha256", "candidateGitIndexSha256",
    "requiredValidationSha256", "completionSha256",
  ]) assert.match(result[field], /^[0-9a-f]{64}$/, field);
  const body = { ...result };
  delete body.completionSha256;
  assert.equal(result.completionSha256, digest(body));
}

{
  const source = fixture();
  source.workItem.requiredValidation.push({ task: "extra" });
  assert.throws(() => bind(source), /byte\/path\/validation identities differ/);
}

{
  const source = fixture();
  source.dispatchPlan.dispatchPlanSha256 = "f".repeat(64);
  assert.throws(() => bind(source), /canonical body/);
}

{
  const source = fixture();
  source.runReceipt.dispatchPlanBytesSha256 = "f".repeat(64);
  assert.throws(() => bind(source), /exact bound dispatch plan/);
}

{
  const source = fixture();
  source.candidateObservation.candidateState.candidateFileManifest[0].sha256 = "f".repeat(64);
  const state = source.candidateObservation.candidateState;
  source.candidateObservation.candidateStateSha256 = digest(state);
  const body = { ...source.candidateObservation };
  delete body.observationSha256;
  source.candidateObservation.observationSha256 = digest(body);
  assert.throws(() => bind(source), /manifest digest is invalid/);
}

{
  const source = fixture();
  source.candidateObservation.snapshotStable = false;
  const body = { ...source.candidateObservation };
  delete body.observationSha256;
  source.candidateObservation.observationSha256 = digest(body);
  assert.throws(() => bind(source), /stability boundary/);
}

{
  const source = fixture();
  source.candidateObservation.observedAt = "2026-09-01T05:20:00.000Z";
  const body = { ...source.candidateObservation };
  delete body.observationSha256;
  source.candidateObservation.observationSha256 = digest(body);
  assert.throws(() => bind(source), /post-turn window/);
}

{
  const first = bind();
  const second = bind();
  assert.equal(first.completionSha256, second.completionSha256);
}

console.log("Codex Test Builder exact-bound completion tests passed.");
console.log("- leased work, route, final dispatch and run receipts remain exact-byte and canonical-digest continuous");
console.log("- stable two-pass candidate state binds exact patch, changed-file, untracked-file and index identities");
console.log("- validation-request drift, dispatch drift, content drift and observation-time drift fail closed");
console.log("- the result remains pre-validation and grants no commit, push, publication or paid-fallback authority");
