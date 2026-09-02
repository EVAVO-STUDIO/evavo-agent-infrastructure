import { createHash } from "node:crypto";

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const GRANT_ID = /^doc-truth:[0-9a-f]{40}$/;

export function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
export const canonicalJson = (value) => JSON.stringify(ordered(value));
export const sha256 = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).digest("hex");

function requireObject(value, label) {
  if (!OBJECT(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function requireString(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value || value.length > maximum || value.includes("\0")) throw new Error(`${label} must be a non-empty bounded string.`);
  return value;
}
function requireSha(value, label, pattern = SHA256) {
  const selected = requireString(value, label, 64);
  if (!pattern.test(selected)) throw new Error(`${label} is invalid.`);
  return selected;
}
function requireFalse(document, fields, label) {
  for (const field of fields) if (document[field] !== false) throw new Error(`${label} must keep ${field}=false.`);
}
function verifySelfDigest(document, field, label) {
  const expected = requireSha(document[field], `${label} ${field}`);
  const body = { ...document };
  delete body[field];
  if (sha256(canonicalJson(body)) !== expected) throw new Error(`${label} ${field} is invalid.`);
  return expected;
}

export function validateGrantBoundLeaseReceipt({ receipt, receiptBytes, work, workerId, policy }) {
  requireObject(receipt, "lease effect receipt");
  requireObject(work, "leased work item");
  requireObject(policy, "grant-bound dispatch policy");
  if (receipt.schemaVersion !== 2 || receipt.kind !== policy.acceptedLeaseReceiptKind || receipt.ok !== true) throw new Error("lease effect receipt identity is invalid.");
  verifySelfDigest(receipt, "receiptSha256", "lease effect receipt");
  if (work.schemaVersion !== 1 || work.kind !== "evavo-autonomous-improvement-work-item-v1" || work.lifecycleState !== "LEASED") throw new Error("work item is not a leased autonomous record.");
  if (work.workerClass !== policy.workerClass || work.workClass !== policy.workClass) throw new Error("work item is not documentation-truth maintenance.");
  const lease = requireObject(work.lease, "work-item route-bound lease");
  if (lease.schemaVersion !== 2 || lease.kind !== "evavo-autonomous-work-exchange-lease-v2") throw new Error("work item lacks a route-bound v2 lease.");
  const continuity = {
    workItemId: work.id,
    repository: work.repository,
    sourceRevision: work.sourceRevision,
    workerId,
    workerClass: work.workerClass,
    planSha256: lease.planSha256,
    routeAdmissionSha256: lease.routeAdmissionSha256,
    leaseExpiresAt: lease.expiresAt
  };
  for (const [field, expected] of Object.entries(continuity)) if (receipt[field] !== expected) throw new Error(`lease effect receipt ${field} continuity failed.`);
  requireSha(receipt.sourceRevision, "lease receipt sourceRevision", SHA1);
  for (const [field, expected] of Object.entries(policy.requiredGrantTruth)) if (receipt[field] !== expected) throw new Error(`lease effect receipt did not prove ${field}.`);
  if (!GRANT_ID.test(String(receipt.runtimeActivationGrantId ?? ""))) throw new Error("lease effect receipt runtime grant ID is invalid.");
  for (const field of ["runtimeActivationGrantBodySha256", "runtimeActivationGrantVerificationSha256", "runtimeGrantConsumptionSha256"]) requireSha(receipt[field], `lease effect receipt ${field}`);
  if (receipt.queueMutationPerformed !== true || receipt.leaseAcquired !== true || receipt.itemsLeased !== 1) throw new Error("lease effect receipt does not prove one exact lease.");
  requireFalse(receipt, ["modelTurnPerformed", "deterministicValidationPerformed", "repositoryMutationPerformed", "commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed", "financialActionPerformed", "paidFallbackUsed"], "lease effect receipt");
  return {
    leaseEffectReceiptBytesSha256: sha256(receiptBytes),
    leaseEffectReceiptSha256: receipt.receiptSha256,
    runtimeActivationGrantId: receipt.runtimeActivationGrantId,
    runtimeActivationGrantBodySha256: receipt.runtimeActivationGrantBodySha256,
    runtimeActivationGrantVerificationSha256: receipt.runtimeActivationGrantVerificationSha256,
    runtimeGrantConsumptionSha256: receipt.runtimeGrantConsumptionSha256
  };
}

export function compileGrantBoundDispatchPlan({ basePlan, leaseReceipt, leaseReceiptBytes, work, workerId, policy }) {
  requireObject(basePlan, "base dispatch plan");
  if (basePlan.schemaVersion !== 1 || basePlan.kind !== policy.acceptedDispatchPlanKind || basePlan.eligible !== true || basePlan.workerClass !== policy.workerClass) throw new Error("base documentation-truth dispatch plan is not eligible.");
  verifySelfDigest(basePlan, "dispatchPlanSha256", "base dispatch plan");
  const leaseIdentity = validateGrantBoundLeaseReceipt({ receipt: leaseReceipt, receiptBytes: leaseReceiptBytes, work, workerId, policy });
  const continuity = {
    workItemId: work.id,
    repository: work.repository,
    sourceRevision: work.sourceRevision,
    workerId,
    workerClass: work.workerClass,
    leasePlanSha256: work.lease.planSha256,
    leaseExpiresAt: work.lease.expiresAt,
    routeAdmissionSha256: work.lease.routeAdmissionSha256
  };
  for (const [field, expected] of Object.entries(continuity)) if (basePlan[field] !== expected) throw new Error(`base dispatch plan ${field} continuity failed.`);
  requireFalse(basePlan, ["modelTurnPerformed", "candidateWorktreeMutationPerformed", "primaryRepositoryMutationPerformed", "deterministicValidationPerformed", "commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed", "paidFallbackUsed"], "base dispatch plan");
  const body = { ...basePlan };
  delete body.dispatchPlanSha256;
  Object.assign(body, leaseIdentity, {
    grantConsumedBeforeDispatch: true,
    grantConsumptionRecordedBeforeDispatch: true
  });
  return { ...body, dispatchPlanSha256: sha256(canonicalJson(body)) };
}

export function validateGrantBoundDispatchPlan({ plan, planBytes, leaseReceipt, leaseReceiptBytes, policy }) {
  requireObject(plan, "grant-bound dispatch plan");
  if (plan.schemaVersion !== 1 || plan.kind !== policy.acceptedDispatchPlanKind || plan.eligible !== true || plan.workerClass !== policy.workerClass) throw new Error("grant-bound dispatch plan identity is invalid.");
  verifySelfDigest(plan, "dispatchPlanSha256", "grant-bound dispatch plan");
  if (plan.grantConsumedBeforeDispatch !== true || plan.grantConsumptionRecordedBeforeDispatch !== true) throw new Error("grant-bound dispatch plan lacks consumed-grant truth.");
  const rawLeaseSha = sha256(leaseReceiptBytes);
  if (plan.leaseEffectReceiptBytesSha256 !== rawLeaseSha) throw new Error("lease effect receipt bytes differ from the dispatch plan.");
  verifySelfDigest(leaseReceipt, "receiptSha256", "lease effect receipt");
  const continuity = {
    leaseEffectReceiptSha256: leaseReceipt.receiptSha256,
    runtimeActivationGrantId: leaseReceipt.runtimeActivationGrantId,
    runtimeActivationGrantBodySha256: leaseReceipt.runtimeActivationGrantBodySha256,
    runtimeActivationGrantVerificationSha256: leaseReceipt.runtimeActivationGrantVerificationSha256,
    runtimeGrantConsumptionSha256: leaseReceipt.runtimeGrantConsumptionSha256,
    workItemId: leaseReceipt.workItemId,
    repository: leaseReceipt.repository,
    sourceRevision: leaseReceipt.sourceRevision,
    workerId: leaseReceipt.workerId,
    workerClass: leaseReceipt.workerClass,
    leasePlanSha256: leaseReceipt.planSha256,
    leaseExpiresAt: leaseReceipt.leaseExpiresAt,
    routeAdmissionSha256: leaseReceipt.routeAdmissionSha256
  };
  for (const [field, expected] of Object.entries(continuity)) if (plan[field] !== expected) throw new Error(`grant-bound dispatch ${field} continuity failed.`);
  for (const [field, expected] of Object.entries(policy.requiredGrantTruth)) if (leaseReceipt[field] !== expected) throw new Error(`lease effect receipt did not prove ${field}.`);
  requireFalse(plan, ["modelTurnPerformed", "candidateWorktreeMutationPerformed", "primaryRepositoryMutationPerformed", "deterministicValidationPerformed", "commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed", "paidFallbackUsed"], "grant-bound dispatch plan");
  return { planBytesSha256: sha256(planBytes), leaseEffectReceiptBytesSha256: rawLeaseSha };
}

export function validateBoundRunReceipt({ runReceipt, runReceiptBytes, plan, planBytes, policy }) {
  requireObject(runReceipt, "documentation-truth run receipt");
  if (runReceipt.schemaVersion !== 1 || runReceipt.kind !== policy.acceptedRunReceiptKind || runReceipt.ok !== true) throw new Error("documentation-truth run receipt identity is invalid.");
  verifySelfDigest(runReceipt, "receiptSha256", "documentation-truth run receipt");
  const continuity = {
    dispatchPlanSha256: plan.dispatchPlanSha256,
    dispatchPlanBytesSha256: sha256(planBytes),
    workItemId: plan.workItemId,
    repository: plan.repository,
    sourceRevision: plan.sourceRevision,
    workerId: plan.workerId,
    workerClass: plan.workerClass,
    leasePlanSha256: plan.leasePlanSha256,
    leaseExpiresAt: plan.leaseExpiresAt
  };
  for (const [field, expected] of Object.entries(continuity)) if (runReceipt[field] !== expected) throw new Error(`documentation-truth run receipt ${field} continuity failed.`);
  if (runReceipt.modelTurnPerformed !== true || runReceipt.structuredTurnCompleted !== true) throw new Error("documentation-truth run receipt does not prove one structured model turn.");
  requireFalse(runReceipt, ["primaryRepositoryMutationPerformed", "deterministicValidationPerformed", "commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed", "paidFallbackUsed"], "documentation-truth run receipt");
  return { runReceiptBytesSha256: sha256(runReceiptBytes), runReceiptSha256: runReceipt.receiptSha256 };
}
