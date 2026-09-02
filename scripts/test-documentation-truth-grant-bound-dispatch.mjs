#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  canonicalJson,
  compileGrantBoundDispatchPlan,
  sha256,
  validateBoundRunReceipt,
  validateGrantBoundDispatchPlan
} from "./documentation-truth-grant-bound-dispatch-core.mjs";

const sha = (character, length = 64) => character.repeat(length);
const bytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const policy = {
  schemaVersion: 1,
  kind: "evavo-codex-documentation-truth-grant-bound-dispatch-policy-v1",
  acceptedLeaseReceiptKind: "evavo-autonomous-work-exchange-lease-effect-receipt-v2",
  acceptedDispatchPlanKind: "evavo-codex-documentation-truth-dispatch-plan-v1",
  acceptedRunReceiptKind: "evavo-codex-documentation-truth-run-v1",
  workerClass: "documentation-truth",
  workClass: "capability-manifest-maintenance",
  requiredGrantTruth: {
    runtimeGrantVerificationPerformed: true,
    grantConsumed: true,
    grantConsumptionRecorded: true,
    grantConsumedUses: 1,
    grantRemainingUses: 0
  }
};
const work = {
  schemaVersion: 1,
  kind: "evavo-autonomous-improvement-work-item-v1",
  id: `work:capability-gap:${sha("a", 24)}`,
  lifecycleState: "LEASED",
  repository: "EVAVO-STUDIO/example",
  sourceRevision: sha("b", 40),
  workerClass: "documentation-truth",
  workClass: "capability-manifest-maintenance",
  lease: {
    schemaVersion: 2,
    kind: "evavo-autonomous-work-exchange-lease-v2",
    planSha256: sha("c"),
    workerId: "doc-worker-1",
    workerClass: "documentation-truth",
    routeAdmissionSha256: sha("d"),
    expiresAt: "2026-09-02T12:10:00.000Z"
  }
};
function leaseReceipt(patch = {}) {
  const body = {
    schemaVersion: 2,
    kind: "evavo-autonomous-work-exchange-lease-effect-receipt-v2",
    ok: true,
    planSha256: work.lease.planSha256,
    workItemId: work.id,
    repository: work.repository,
    sourceRevision: work.sourceRevision,
    workerId: work.lease.workerId,
    workerClass: work.workerClass,
    routeAdmissionSha256: work.lease.routeAdmissionSha256,
    leaseExpiresAt: work.lease.expiresAt,
    runtimeGrantVerificationPerformed: true,
    grantConsumed: true,
    grantConsumptionRecorded: true,
    runtimeActivationGrantId: `doc-truth:${sha("e", 40)}`,
    runtimeActivationGrantBodySha256: sha("f"),
    runtimeActivationGrantVerificationSha256: sha("1"),
    runtimeGrantConsumptionSha256: sha("2"),
    grantConsumedUses: 1,
    grantRemainingUses: 0,
    queueMutationPerformed: true,
    itemsLeased: 1,
    leaseAcquired: true,
    modelTurnPerformed: false,
    deterministicValidationPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
    ...patch
  };
  return { ...body, receiptSha256: sha256(canonicalJson(body)) };
}
function basePlan(patch = {}) {
  const body = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-dispatch-plan-v1",
    eligible: true,
    workerId: work.lease.workerId,
    workItemId: work.id,
    workerClass: work.workerClass,
    workClass: work.workClass,
    repository: work.repository,
    sourceRevision: work.sourceRevision,
    leasePlanSha256: work.lease.planSha256,
    leaseExpiresAt: work.lease.expiresAt,
    routeAdmissionSha256: work.lease.routeAdmissionSha256,
    modelTurnPerformed: false,
    candidateWorktreeMutationPerformed: false,
    primaryRepositoryMutationPerformed: false,
    deterministicValidationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    paidFallbackUsed: false,
    ...patch
  };
  return { ...body, dispatchPlanSha256: sha256(canonicalJson(body)) };
}
function runReceipt(plan, planBytes, patch = {}) {
  const body = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-run-v1",
    ok: true,
    dispatchPlanSha256: plan.dispatchPlanSha256,
    dispatchPlanBytesSha256: sha256(planBytes),
    workItemId: plan.workItemId,
    repository: plan.repository,
    sourceRevision: plan.sourceRevision,
    workerId: plan.workerId,
    workerClass: plan.workerClass,
    leasePlanSha256: plan.leasePlanSha256,
    leaseExpiresAt: plan.leaseExpiresAt,
    modelTurnPerformed: true,
    structuredTurnCompleted: true,
    primaryRepositoryMutationPerformed: false,
    deterministicValidationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    paidFallbackUsed: false,
    ...patch
  };
  return { ...body, receiptSha256: sha256(canonicalJson(body)) };
}

{
  const lease = leaseReceipt();
  const leaseBytes = bytes(lease);
  const plan = compileGrantBoundDispatchPlan({
    basePlan: basePlan(),
    leaseReceipt: lease,
    leaseReceiptBytes: leaseBytes,
    work,
    workerId: work.lease.workerId,
    policy
  });
  assert.equal(plan.grantConsumedBeforeDispatch, true);
  assert.equal(plan.grantConsumptionRecordedBeforeDispatch, true);
  assert.equal(plan.leaseEffectReceiptBytesSha256, sha256(leaseBytes));
  assert.equal(plan.leaseEffectReceiptSha256, lease.receiptSha256);
  assert.equal(plan.runtimeActivationGrantId, lease.runtimeActivationGrantId);
  const planBody = { ...plan };
  delete planBody.dispatchPlanSha256;
  assert.equal(plan.dispatchPlanSha256, sha256(canonicalJson(planBody)));
  const planBytes = bytes(plan);
  validateGrantBoundDispatchPlan({ plan, planBytes, leaseReceipt: lease, leaseReceiptBytes: leaseBytes, policy });
  const run = runReceipt(plan, planBytes);
  validateBoundRunReceipt({ runReceipt: run, runReceiptBytes: bytes(run), plan, planBytes, policy });
}

{
  const lease = leaseReceipt();
  const tampered = { ...lease, grantConsumed: false };
  assert.throws(() => compileGrantBoundDispatchPlan({ basePlan: basePlan(), leaseReceipt: tampered, leaseReceiptBytes: bytes(tampered), work, workerId: work.lease.workerId, policy }), /receiptSha256 is invalid/);
}

{
  const lease = leaseReceipt({ grantConsumed: false });
  assert.throws(() => compileGrantBoundDispatchPlan({ basePlan: basePlan(), leaseReceipt: lease, leaseReceiptBytes: bytes(lease), work, workerId: work.lease.workerId, policy }), /did not prove grantConsumed/);
}

{
  const lease = leaseReceipt();
  const leaseBytes = bytes(lease);
  const plan = compileGrantBoundDispatchPlan({ basePlan: basePlan(), leaseReceipt: lease, leaseReceiptBytes: leaseBytes, work, workerId: work.lease.workerId, policy });
  const changedBytes = Buffer.from(`${JSON.stringify(lease)} `, "utf8");
  assert.throws(() => validateGrantBoundDispatchPlan({ plan, planBytes: bytes(plan), leaseReceipt: lease, leaseReceiptBytes: changedBytes, policy }), /bytes differ/);
}

{
  const lease = leaseReceipt();
  const leaseBytes = bytes(lease);
  const plan = compileGrantBoundDispatchPlan({ basePlan: basePlan(), leaseReceipt: lease, leaseReceiptBytes: leaseBytes, work, workerId: work.lease.workerId, policy });
  const planBytes = bytes(plan);
  const run = runReceipt(plan, planBytes, { publicationPerformed: true });
  assert.throws(() => validateBoundRunReceipt({ runReceipt: run, runReceiptBytes: bytes(run), plan, planBytes, policy }), /publicationPerformed=false/);
}

{
  const lease = leaseReceipt();
  const leaseBytes = bytes(lease);
  const plan = compileGrantBoundDispatchPlan({ basePlan: basePlan(), leaseReceipt: lease, leaseReceiptBytes: leaseBytes, work, workerId: work.lease.workerId, policy });
  const planBytes = bytes(plan);
  const run = runReceipt(plan, planBytes, { modelTurnPerformed: false });
  assert.throws(() => validateBoundRunReceipt({ runReceipt: run, runReceiptBytes: bytes(run), plan, planBytes, policy }), /does not prove one structured model turn/);
}

console.log("Documentation-truth grant-bound dispatch tests passed.");
console.log("- exact Local Storage lease-receipt bytes and canonical digest are bound into dispatch");
console.log("- runtime grant ID, verification and single-use consumption survive into the dispatch plan");
console.log("- tampering, missing consumption, byte drift and publication widening fail closed");
console.log("- the model-run receipt must bind the exact grant-bound plan bytes");
