#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  canonicalDocumentationTruthRuntimeRouteJson,
  compileDocumentationTruthRuntimeRoutePlan,
} from "./documentation-truth-runtime-route-planner-core.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const seal = (value, field) => {
  const body = { ...value };
  delete body[field];
  return {
    ...body,
    [field]: sha256(Buffer.from(canonicalDocumentationTruthRuntimeRouteJson(body), "utf8")),
  };
};
const now = new Date("2026-09-01T12:00:00.000Z");
const iso = (milliseconds) => new Date(milliseconds).toISOString();

const work = {
  schemaVersion: 1,
  kind: "evavo-autonomous-improvement-work-item-v1",
  id: "work:documentation-truth:fixture",
  lifecycleState: "READY",
  repository: "EVAVO-STUDIO/example",
  sourceRevision: "8".repeat(40),
  workerClass: "documentation-truth",
  workClass: "capability-manifest-maintenance",
  category: "capability-manifest-gap",
  capacityClass: "included-consumer",
  paidFallbackAllowed: false,
  productionSourceMutationAllowed: false,
  documentationMetadataMutationAllowed: true,
  workerMayCommit: false,
  workerMayPush: false,
  workerMayPublish: false,
  allowedPaths: ["evavo.capabilities.json"],
  maximumChangedFiles: 1,
  maximumChangedLines: 600,
  maximumAutomaticAttempts: 1,
  noActionAccepted: true,
  requiresCurrentHeadMatch: true,
  dependencyChangeAllowed: false,
  schemaChangeAllowed: false,
  publicApiChangeAllowed: false,
  lease: null,
};

function verification(overrides = {}) {
  return seal({
    schemaVersion: 1,
    kind: "evavo-local-storage-documentation-truth-runtime-grant-verification-v1",
    accepted: true,
    verifiedAt: now.toISOString(),
    grantId: `doc-truth:${"1".repeat(40)}`,
    grantBodySha256: "2".repeat(64),
    requestSha256: "3".repeat(64),
    agentVerificationSha256: "4".repeat(64),
    agentVerificationBytesSha256: "5".repeat(64),
    requestBytesSha256: "6".repeat(64),
    envelopeBytesSha256: "7".repeat(64),
    trustAnchorBytesSha256: "8".repeat(64),
    policySha256: "9".repeat(64),
    v2PolicySha256: "a".repeat(64),
    v3PolicySha256: "b".repeat(64),
    v2ClientReceiptSha256: "c".repeat(64),
    clientPolicyVersion: 3,
    pathSafetyVerified: true,
    parentComponentSymlinkSafetyVerified: true,
    pathTraversalRejected: true,
    agentInfrastructureMainSha: "d".repeat(40),
    agentInfrastructureTreeSha: "e".repeat(40),
    localStorageMainSha: "f".repeat(40),
    localStorageTreeSha: "0".repeat(40),
    candidateAcceptanceSha256: "d".repeat(64),
    crossRepositoryDesignSha256: "e".repeat(64),
    workItemId: work.id,
    workItemSha256: "1".repeat(64),
    targetRepository: work.repository,
    targetSourceRevision: work.sourceRevision,
    expiresAt: iso(now.getTime() + 10 * 60_000),
    consumedUses: 0,
    remainingUses: 1,
    maximumConcurrency: 1,
    workerClass: "documentation-truth",
    workClass: "capability-manifest-maintenance",
    routeId: "codex-spark-pro",
    capacityClass: "included-consumer",
    exactRequestIdentityVerified: true,
    agentSourceUnchanged: true,
    localStorageSourceUnchanged: true,
    signatureCreated: false,
    grantConsumed: false,
    capacitySelected: false,
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
    privateKeyAccessed: false,
    ...overrides,
  }, "clientReceiptSha256");
}

function admission(grant, overrides = {}) {
  return seal({
    schemaVersion: 1,
    kind: "evavo-documentation-truth-runtime-capacity-admission-v1",
    eligible: true,
    decision: "ADMITTED",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    rawCapacityState: "AVAILABLE",
    admittedWorkerClasses: ["documentation-truth"],
    maximumConcurrency: 1,
    agentInfrastructureMainSha: grant.agentInfrastructureMainSha,
    localStorageMainSha: grant.localStorageMainSha,
    candidateAcceptanceSha256: grant.candidateAcceptanceSha256,
    crossRepositoryDesignSha256: grant.crossRepositoryDesignSha256,
    grantId: grant.grantId,
    grantBodySha256: grant.grantBodySha256,
    requestSha256: grant.requestSha256,
    workItemId: grant.workItemId,
    workItemSha256: grant.workItemSha256,
    repository: grant.targetRepository,
    sourceRevision: grant.targetSourceRevision,
    capacityStatusSha256: "2".repeat(64),
    physicalAcceptanceSha256: "3".repeat(64),
    observedAt: now.toISOString(),
    expiresAt: iso(now.getTime() + 90_000),
    physicalAcceptanceAccepted: true,
    candidateCampaignAccepted: true,
    signedRuntimeGrantRequired: true,
    paidFallbackAllowed: false,
    executionPerformed: false,
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
    ...overrides,
  }, "admissionSha256");
}

{
  const grant = verification();
  const capacity = admission(grant);
  const workBefore = structuredClone(work);
  const grantBefore = structuredClone(grant);
  const admissionBefore = structuredClone(capacity);
  const plan = compileDocumentationTruthRuntimeRoutePlan({
    workItem: work,
    grantVerification: grant,
    capacityAdmission: capacity,
    now,
  });
  assert.deepEqual(work, workBefore);
  assert.deepEqual(grant, grantBefore);
  assert.deepEqual(capacity, admissionBefore);
  assert.equal(plan.kind, "evavo-documentation-truth-runtime-route-plan-v1");
  assert.equal(plan.eligible, true);
  assert.equal(plan.decision, "DISPATCH_ELIGIBLE");
  assert.equal(plan.workerClass, "documentation-truth");
  assert.equal(plan.workClass, "capability-manifest-maintenance");
  assert.equal(plan.routeId, "codex-spark-pro");
  assert.equal(plan.capacityClass, "included-consumer");
  assert.equal(plan.workItemId, work.id);
  assert.equal(plan.repository, work.repository);
  assert.equal(plan.sourceRevision, work.sourceRevision);
  assert.equal(plan.grantId, grant.grantId);
  assert.equal(plan.grantBodySha256, grant.grantBodySha256);
  assert.equal(plan.requestSha256, grant.requestSha256);
  assert.equal(plan.routeAdmissionSha256, capacity.admissionSha256);
  assert.equal(plan.maximumConcurrency, 1);
  assert.equal(plan.expiresAt, capacity.expiresAt);
  for (const field of [
    "paidFallbackUsed",
    "executionPerformed",
    "queueMutationPerformed",
    "leaseAcquired",
    "modelTurnPerformed",
    "repositoryMutationPerformed",
    "publicationPerformed",
  ]) assert.equal(plan[field], false, field);
  const body = { ...plan };
  delete body.routePlanSha256;
  assert.equal(
    plan.routePlanSha256,
    sha256(Buffer.from(canonicalDocumentationTruthRuntimeRouteJson(body), "utf8")),
  );
}

{
  const grant = verification();
  const bad = { ...grant, clientReceiptSha256: "0".repeat(64) };
  assert.throws(
    () => compileDocumentationTruthRuntimeRoutePlan({ workItem: work, grantVerification: bad, capacityAdmission: admission(grant), now }),
    /grant verification receipt digest is invalid/,
  );
}

{
  const grant = verification();
  const capacity = admission(grant);
  const bad = { ...capacity, admissionSha256: "0".repeat(64) };
  assert.throws(
    () => compileDocumentationTruthRuntimeRoutePlan({ workItem: work, grantVerification: grant, capacityAdmission: bad, now }),
    /capacity admission digest is invalid/,
  );
}

{
  const expired = verification({ expiresAt: iso(now.getTime() - 1_000) });
  assert.throws(
    () => compileDocumentationTruthRuntimeRoutePlan({ workItem: work, grantVerification: expired, capacityAdmission: admission(expired), now }),
    /grant is expired/,
  );
  const stale = verification({ verifiedAt: iso(now.getTime() - 121_000) });
  assert.throws(
    () => compileDocumentationTruthRuntimeRoutePlan({ workItem: work, grantVerification: stale, capacityAdmission: admission(stale), now }),
    /verification is stale/,
  );
}

{
  const grant = verification();
  const expired = admission(grant, {
    observedAt: iso(now.getTime() - 60_000),
    expiresAt: iso(now.getTime() - 1_000),
  });
  assert.throws(
    () => compileDocumentationTruthRuntimeRoutePlan({ workItem: work, grantVerification: grant, capacityAdmission: expired, now }),
    /capacity admission is expired/,
  );
  const stale = admission(grant, {
    observedAt: iso(now.getTime() - 121_000),
    expiresAt: iso(now.getTime() + 1_000),
  });
  assert.throws(
    () => compileDocumentationTruthRuntimeRoutePlan({ workItem: work, grantVerification: grant, capacityAdmission: stale, now }),
    /capacity admission is stale/,
  );
}

{
  const grant = verification();
  for (const [overrides, pattern] of [
    [{ admittedWorkerClasses: ["test-generation"] }, /capacity admission identity is invalid/],
    [{ maximumConcurrency: 2 }, /capacity admission identity is invalid/],
    [{ rawCapacityState: "EXHAUSTED" }, /capacity admission identity is invalid/],
    [{ modelTurnPerformed: true }, /must keep modelTurnPerformed=false/],
  ]) {
    assert.throws(
      () => compileDocumentationTruthRuntimeRoutePlan({
        workItem: work,
        grantVerification: grant,
        capacityAdmission: admission(grant, overrides),
        now,
      }),
      pattern,
    );
  }
}

{
  const grant = verification();
  const wrongSource = admission(grant, { sourceRevision: "9".repeat(40) });
  assert.throws(
    () => compileDocumentationTruthRuntimeRoutePlan({ workItem: work, grantVerification: grant, capacityAdmission: wrongSource, now }),
    /sourceRevision continuity failed/,
  );
  const wrongGrant = admission(grant, { grantId: `doc-truth:${"2".repeat(40)}` });
  assert.throws(
    () => compileDocumentationTruthRuntimeRoutePlan({ workItem: work, grantVerification: grant, capacityAdmission: wrongGrant, now }),
    /grantId continuity failed/,
  );
}

{
  const grant = verification({ leaseAcquired: true });
  assert.throws(
    () => compileDocumentationTruthRuntimeRoutePlan({ workItem: work, grantVerification: grant, capacityAdmission: admission(grant), now }),
    /must keep leaseAcquired=false/,
  );
}

{
  const badWork = { ...work, productionSourceMutationAllowed: true };
  const grant = verification();
  assert.throws(
    () => compileDocumentationTruthRuntimeRoutePlan({ workItem: badWork, grantVerification: grant, capacityAdmission: admission(grant), now }),
    /work item identity or authority is invalid/,
  );
}

console.log("Documentation-truth runtime route planner tests passed.");
console.log("- exact READY work, Local v3 grant verification and sealed capacity admission produce one short-lived route plan");
console.log("- stale or expired evidence, digest drift, class/source/grant drift and concurrency or authority widening fail closed");
console.log("- planning performs no capacity observation, physical acceptance, grant consumption, queue, lease, model, Git or publication effect");
