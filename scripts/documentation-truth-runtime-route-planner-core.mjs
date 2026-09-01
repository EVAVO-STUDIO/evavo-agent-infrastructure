#!/usr/bin/env node

import { createHash } from "node:crypto";

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/;
const REPOSITORY = /^EVAVO-STUDIO\/[A-Za-z0-9._-]{1,100}$/;
const GRANT_ID = /^doc-truth:[0-9a-f]{40}$/;
const MANIFEST_PATHS = new Set(["evavo.capabilities.json", ".evavo/capabilities.json"]);
const DISPATCHABLE = new Set(["AVAILABLE", "DEGRADED"]);
const MAXIMUM_VERIFICATION_AGE_MS = 120_000;
const MAXIMUM_ADMISSION_AGE_MS = 120_000;
const MAXIMUM_ROUTE_LIFETIME_MS = 120_000;
const MAXIMUM_FUTURE_SKEW_MS = 30_000;

function canonicalValue(value, label = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} contains a non-canonical number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonicalValue(entry, `${label}[${index}]`));
  if (OBJECT(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => {
          if (value[key] === undefined) throw new Error(`${label}.${key} is undefined.`);
          return [key, canonicalValue(value[key], `${label}.${key}`)];
        }),
    );
  }
  throw new Error(`${label} contains an unsupported value.`);
}

export function canonicalDocumentationTruthRuntimeRouteJson(value) {
  return JSON.stringify(canonicalValue(value));
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function exactText(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value || value.length > maximum || value.includes("\0")) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value;
}
function exactPattern(value, label, pattern, maximum) {
  const selected = exactText(value, label, maximum);
  if (!pattern.test(selected)) throw new Error(`${label} is invalid.`);
  return selected;
}
function exactSha(value, label, pattern = SHA256) {
  return exactPattern(value, label, pattern, 64);
}
function instant(value, label) {
  const selected = exactText(value, label, 64);
  const milliseconds = Date.parse(selected);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return milliseconds;
}
function assertDigest(value, field, label) {
  if (!OBJECT(value)) throw new Error(`${label} must be an object.`);
  const observed = exactSha(value[field], `${label} ${field}`);
  const body = { ...value };
  delete body[field];
  const expected = sha256(Buffer.from(canonicalDocumentationTruthRuntimeRouteJson(body), "utf8"));
  if (observed !== expected) throw new Error(`${label} digest is invalid.`);
  return observed;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

function validateWorkItem(value) {
  if (!OBJECT(value)) throw new Error("READY documentation-truth work item must be an object.");
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "evavo-autonomous-improvement-work-item-v1" ||
    value.lifecycleState !== "READY" ||
    value.workerClass !== "documentation-truth" ||
    value.workClass !== "capability-manifest-maintenance" ||
    value.category !== "capability-manifest-gap" ||
    value.capacityClass !== "included-consumer" ||
    value.paidFallbackAllowed !== false ||
    value.productionSourceMutationAllowed !== false ||
    value.documentationMetadataMutationAllowed !== true ||
    value.workerMayCommit !== false ||
    value.workerMayPush !== false ||
    value.workerMayPublish !== false ||
    value.maximumChangedFiles !== 1 ||
    !Number.isInteger(value.maximumChangedLines) ||
    value.maximumChangedLines < 1 ||
    value.maximumChangedLines > 600 ||
    value.maximumAutomaticAttempts !== 1 ||
    value.noActionAccepted !== true ||
    value.requiresCurrentHeadMatch !== true ||
    value.dependencyChangeAllowed !== false ||
    value.schemaChangeAllowed !== false ||
    value.publicApiChangeAllowed !== false ||
    value.lease !== null
  ) throw new Error("READY documentation-truth work item identity or authority is invalid.");
  exactPattern(value.id, "Work-item id", ID, 256);
  exactPattern(value.repository, "Work-item repository", REPOSITORY, 140);
  exactSha(value.sourceRevision, "Work-item source revision", SHA1);
  if (
    !Array.isArray(value.allowedPaths) ||
    value.allowedPaths.length < 1 ||
    value.allowedPaths.length > 2 ||
    new Set(value.allowedPaths).size !== value.allowedPaths.length ||
    value.allowedPaths.some((entry) => !MANIFEST_PATHS.has(entry))
  ) throw new Error("READY documentation-truth allowedPaths are invalid.");
  return value;
}

function validateGrantVerification(value, nowMs) {
  if (!OBJECT(value)) throw new Error("Local Storage grant verification receipt must be an object.");
  assertDigest(value, "clientReceiptSha256", "Local Storage grant verification receipt");
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "evavo-local-storage-documentation-truth-runtime-grant-verification-v1" ||
    value.accepted !== true ||
    value.clientPolicyVersion !== 3 ||
    value.pathSafetyVerified !== true ||
    value.parentComponentSymlinkSafetyVerified !== true ||
    value.pathTraversalRejected !== true ||
    value.exactRequestIdentityVerified !== true ||
    value.agentSourceUnchanged !== true ||
    value.localStorageSourceUnchanged !== true ||
    value.workerClass !== "documentation-truth" ||
    value.workClass !== "capability-manifest-maintenance" ||
    value.routeId !== "codex-spark-pro" ||
    value.capacityClass !== "included-consumer" ||
    value.consumedUses !== 0 ||
    value.remainingUses !== 1 ||
    value.maximumConcurrency !== 1
  ) throw new Error("Local Storage grant verification receipt identity is invalid.");
  for (const field of [
    "signatureCreated",
    "grantConsumed",
    "capacitySelected",
    "queueMutationPerformed",
    "leaseAcquired",
    "modelTurnPerformed",
    "repositoryMutationPerformed",
    "commitPerformed",
    "pushPerformed",
    "publicationPerformed",
    "deploymentPerformed",
    "financialActionPerformed",
    "paidFallbackUsed",
    "privateKeyAccessed",
  ]) {
    if (value[field] !== false) throw new Error(`Local Storage grant verification must keep ${field}=false.`);
  }
  const verifiedAt = instant(value.verifiedAt, "Grant verification verifiedAt");
  const expiresAt = instant(value.expiresAt, "Grant verification expiresAt");
  if (verifiedAt - nowMs > MAXIMUM_FUTURE_SKEW_MS) throw new Error("Local Storage grant verification is future-dated.");
  if (nowMs - verifiedAt > MAXIMUM_VERIFICATION_AGE_MS) throw new Error("Local Storage grant verification is stale.");
  if (expiresAt <= nowMs) throw new Error("Runtime activation grant is expired.");
  exactPattern(value.grantId, "Grant verification grantId", GRANT_ID, 64);
  exactPattern(value.workItemId, "Grant verification workItemId", ID, 256);
  exactPattern(value.targetRepository, "Grant verification targetRepository", REPOSITORY, 140);
  for (const field of [
    "grantBodySha256",
    "requestSha256",
    "candidateAcceptanceSha256",
    "crossRepositoryDesignSha256",
    "workItemSha256",
    "clientReceiptSha256",
  ]) exactSha(value[field], `Grant verification ${field}`);
  for (const field of ["agentInfrastructureMainSha", "localStorageMainSha", "targetSourceRevision"]) {
    exactSha(value[field], `Grant verification ${field}`, SHA1);
  }
  return { value, verifiedAt, expiresAt };
}

function validateCapacityAdmission(value, nowMs) {
  if (!OBJECT(value)) throw new Error("Documentation-truth capacity admission must be an object.");
  assertDigest(value, "admissionSha256", "Documentation-truth capacity admission");
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "evavo-documentation-truth-runtime-capacity-admission-v1" ||
    value.eligible !== true ||
    value.decision !== "ADMITTED" ||
    value.routeId !== "codex-spark-pro" ||
    value.modelPreference !== "gpt-5.3-codex-spark" ||
    value.capacityClass !== "included-consumer" ||
    !DISPATCHABLE.has(value.rawCapacityState) ||
    !Array.isArray(value.admittedWorkerClasses) ||
    value.admittedWorkerClasses.length !== 1 ||
    value.admittedWorkerClasses[0] !== "documentation-truth" ||
    value.maximumConcurrency !== 1 ||
    value.physicalAcceptanceAccepted !== true ||
    value.candidateCampaignAccepted !== true ||
    value.signedRuntimeGrantRequired !== true ||
    value.paidFallbackAllowed !== false
  ) throw new Error("Documentation-truth capacity admission identity is invalid.");
  for (const field of [
    "executionPerformed",
    "queueMutationPerformed",
    "leaseAcquired",
    "modelTurnPerformed",
    "repositoryMutationPerformed",
    "publicationPerformed",
  ]) {
    if (value[field] !== false) throw new Error(`Documentation-truth capacity admission must keep ${field}=false.`);
  }
  const observedAt = instant(value.observedAt, "Capacity admission observedAt");
  const expiresAt = instant(value.expiresAt, "Capacity admission expiresAt");
  if (observedAt - nowMs > MAXIMUM_FUTURE_SKEW_MS) throw new Error("Documentation-truth capacity admission is future-dated.");
  if (nowMs - observedAt > MAXIMUM_ADMISSION_AGE_MS) throw new Error("Documentation-truth capacity admission is stale.");
  if (expiresAt <= nowMs) throw new Error("Documentation-truth capacity admission is expired.");
  if (expiresAt - observedAt > MAXIMUM_ROUTE_LIFETIME_MS) {
    throw new Error("Documentation-truth capacity admission lifetime exceeds policy.");
  }
  exactPattern(value.grantId, "Capacity admission grantId", GRANT_ID, 64);
  exactPattern(value.workItemId, "Capacity admission workItemId", ID, 256);
  exactPattern(value.repository, "Capacity admission repository", REPOSITORY, 140);
  for (const field of [
    "candidateAcceptanceSha256",
    "crossRepositoryDesignSha256",
    "grantBodySha256",
    "requestSha256",
    "workItemSha256",
    "capacityStatusSha256",
    "physicalAcceptanceSha256",
    "admissionSha256",
  ]) exactSha(value[field], `Capacity admission ${field}`);
  for (const field of ["agentInfrastructureMainSha", "localStorageMainSha", "sourceRevision"]) {
    exactSha(value[field], `Capacity admission ${field}`, SHA1);
  }
  return { value, observedAt, expiresAt };
}

function same(value, expected, label) {
  if (value !== expected) throw new Error(`${label} continuity failed.`);
}

export function compileDocumentationTruthRuntimeRoutePlan({
  workItem,
  grantVerification,
  capacityAdmission,
  now = new Date(),
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Route planning time is invalid.");
  const nowMs = now.getTime();
  const work = validateWorkItem(workItem);
  const verification = validateGrantVerification(grantVerification, nowMs);
  const admission = validateCapacityAdmission(capacityAdmission, nowMs);
  const grant = verification.value;
  const capacity = admission.value;

  same(grant.workItemId, work.id, "Grant work-item id");
  same(grant.targetRepository, work.repository, "Grant target repository");
  same(grant.targetSourceRevision, work.sourceRevision, "Grant target source revision");
  for (const field of ["workItemId", "repository", "sourceRevision"]) {
    const expected = field === "workItemId" ? work.id : work[field];
    same(capacity[field], expected, `Capacity admission ${field}`);
  }
  for (const field of [
    "grantId",
    "grantBodySha256",
    "requestSha256",
    "workItemSha256",
    "agentInfrastructureMainSha",
    "localStorageMainSha",
    "candidateAcceptanceSha256",
    "crossRepositoryDesignSha256",
  ]) same(capacity[field], grant[field], `Capacity admission ${field}`);

  const expiresAt = Math.min(
    grant.expiresAt ? instant(grant.expiresAt, "Grant expiresAt") : Number.POSITIVE_INFINITY,
    admission.expiresAt,
    nowMs + MAXIMUM_ROUTE_LIFETIME_MS,
  );
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    throw new Error("Documentation-truth route plan would already be expired.");
  }
  const body = {
    schemaVersion: 1,
    kind: "evavo-documentation-truth-runtime-route-plan-v1",
    eligible: true,
    decision: "DISPATCH_ELIGIBLE",
    workerClass: "documentation-truth",
    workClass: "capability-manifest-maintenance",
    routeId: "codex-spark-pro",
    capacityClass: "included-consumer",
    workItemId: work.id,
    workItemSha256: grant.workItemSha256,
    repository: work.repository,
    sourceRevision: work.sourceRevision,
    grantId: grant.grantId,
    grantBodySha256: grant.grantBodySha256,
    requestSha256: grant.requestSha256,
    agentInfrastructureMainSha: grant.agentInfrastructureMainSha,
    localStorageMainSha: grant.localStorageMainSha,
    capacityStatusSha256: capacity.capacityStatusSha256,
    routeAdmissionSha256: capacity.admissionSha256,
    observedAt: now.toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    maximumConcurrency: 1,
    paidFallbackUsed: false,
    executionPerformed: false,
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
  };
  return deepFreeze({
    ...body,
    routePlanSha256: sha256(Buffer.from(canonicalDocumentationTruthRuntimeRouteJson(body), "utf8")),
  });
}

export const DOCUMENTATION_TRUTH_RUNTIME_ROUTE_PLANNER_CONTRACT = deepFreeze({
  workerClass: "documentation-truth",
  workClass: "capability-manifest-maintenance",
  routeId: "codex-spark-pro",
  capacityClass: "included-consumer",
  maximumConcurrency: 1,
  normalRouteRegistered: false,
  capacityAdmissionProducerRegistered: false,
  grantConsumptionAuthority: false,
  queueMutationAuthority: false,
  leaseAuthority: false,
  modelExecutionAuthority: false,
  repositoryMutationAuthority: false,
  publicationAuthority: false,
  paidFallbackAllowed: false,
});
