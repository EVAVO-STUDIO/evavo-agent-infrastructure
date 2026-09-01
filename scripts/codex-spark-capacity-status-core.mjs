#!/usr/bin/env node

import { createHash } from "node:crypto";

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA256 = /^[0-9a-f]{64}$/;

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, ordered(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(ordered(value));
}

export function sha256Bytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

function exactBytes(value, fallback) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(canonicalJson(fallback), "utf8");
}

function assertPolicy(policy) {
  if (!OBJECT(policy) || policy.schemaVersion !== 1 || policy.kind !== "evavo-codex-spark-capacity-status-policy-v1") {
    throw new Error("Spark capacity status policy identity is invalid.");
  }
  if (typeof policy.routeId !== "string" || !policy.routeId) throw new Error("Spark capacity status policy routeId is invalid.");
  if (typeof policy.modelPreference !== "string" || !policy.modelPreference) throw new Error("Spark capacity status policy modelPreference is invalid.");
  if (!Array.isArray(policy.allowedRawCapacityStates) || policy.allowedRawCapacityStates.length === 0) {
    throw new Error("Spark capacity status policy must define allowed raw capacity states.");
  }
  if (!Array.isArray(policy.dispatchableRawCapacityStates) || policy.dispatchableRawCapacityStates.length === 0) {
    throw new Error("Spark capacity status policy must define dispatchable raw capacity states.");
  }
  if (!Array.isArray(policy.admittedWorkerClasses) || policy.admittedWorkerClasses.length === 0) {
    throw new Error("Spark capacity status policy must define admitted worker classes.");
  }
  if (!Number.isInteger(policy.maximumConcurrency) || policy.maximumConcurrency < 1) {
    throw new Error("Spark capacity status policy maximumConcurrency is invalid.");
  }
  for (const field of [
    "maximumCapacityObservationAgeSeconds",
    "maximumCapabilityReceiptAgeSeconds",
    "maximumRouteAdmissionAgeSeconds",
    "maximumPhysicalAcceptanceAgeSeconds",
    "maximumFutureClockSkewSeconds",
  ]) {
    if (!Number.isInteger(policy[field]) || policy[field] < 1) throw new Error(`Spark capacity status policy ${field} is invalid.`);
  }
  if (policy.paidFallbackAllowed !== false) throw new Error("Spark capacity status policy must forbid paid fallback.");
}

function routeObservation(document, routeId) {
  if (!OBJECT(document)) throw new Error("Raw capacity observation must be a JSON object.");
  if (Array.isArray(document.routes)) {
    const matches = document.routes.filter((entry) => OBJECT(entry) && entry.routeId === routeId);
    if (matches.length !== 1) throw new Error(`Raw capacity observation must contain exactly one ${routeId} route.`);
    return { root: document, route: matches[0] };
  }
  if (document.routeId !== routeId) throw new Error(`Raw capacity observation routeId must be ${routeId}.`);
  return { root: document, route: document };
}

function isoTime(value, label) {
  if (typeof value !== "string" || !value) return { ok: false, label, value: null, milliseconds: null };
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? { ok: true, label, value: new Date(milliseconds).toISOString(), milliseconds }
    : { ok: false, label, value, milliseconds: null };
}

function checkFreshness({ value, label, maximumAgeSeconds, futureSkewSeconds, nowMs, errors }) {
  const parsed = isoTime(value, label);
  if (!parsed.ok) {
    errors.push(`${label} is missing or invalid.`);
    return null;
  }
  if (parsed.milliseconds - nowMs > futureSkewSeconds * 1000) errors.push(`${label} is future-dated.`);
  if (nowMs - parsed.milliseconds > maximumAgeSeconds * 1000) errors.push(`${label} is stale.`);
  return parsed;
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const a = [...new Set(left.filter((value) => typeof value === "string"))].sort();
  const b = [...new Set(right.filter((value) => typeof value === "string"))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function evidenceDigest(value, fallback) {
  const bytes = exactBytes(value, fallback);
  return { bytes, sha256: sha256Bytes(bytes), byteLength: bytes.length };
}

export function compileCodexSparkCapacityStatus({
  policy,
  capacityObservation,
  capacityObservationBytes,
  supervisedAcceptance,
  supervisedAcceptanceBytes,
  capabilityReceipt,
  capabilityReceiptBytes,
  acceptanceVerification,
  acceptanceVerificationBytes,
  now = new Date(),
}) {
  assertPolicy(policy);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Capacity status compilation time is invalid.");
  if (!OBJECT(supervisedAcceptance)) throw new Error("Supervised physical acceptance must be a JSON object.");
  if (!OBJECT(capabilityReceipt)) throw new Error("Codex capability receipt must be a JSON object.");
  if (!OBJECT(acceptanceVerification)) throw new Error("Supervised acceptance verification must be a JSON object.");

  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const { root: capacityRoot, route: capacityRoute } = routeObservation(capacityObservation, policy.routeId);
  const rawState = capacityRoute.rawCapacityState ?? capacityRoute.capacityState ?? capacityRoute.state;
  if (typeof rawState !== "string" || !policy.allowedRawCapacityStates.includes(rawState)) {
    throw new Error(`Raw capacity state is invalid for ${policy.routeId}.`);
  }
  if (capacityRoute.paidFallbackAllowed === true || capacityRoot.paidFallbackAllowed === true) {
    throw new Error("Raw capacity observation may not enable paid fallback.");
  }

  const capacityObservedAt = capacityRoute.observedAt ?? capacityRoot.observedAt;
  const admissionErrors = [];
  const capacityTime = checkFreshness({
    value: capacityObservedAt,
    label: "Raw capacity observation timestamp",
    maximumAgeSeconds: policy.maximumCapacityObservationAgeSeconds,
    futureSkewSeconds: policy.maximumFutureClockSkewSeconds,
    nowMs,
    errors: admissionErrors,
  });

  if (capabilityReceipt.kind !== "evavo-codex-worker-capability-probe-v1") {
    admissionErrors.push("Codex capability receipt kind is invalid.");
  }
  if (capabilityReceipt.eligibleForWorkerDispatch !== true) {
    admissionErrors.push("Codex capability receipt is not eligible for worker dispatch.");
  }
  const capabilityTime = checkFreshness({
    value: capabilityReceipt.observedAt,
    label: "Codex capability receipt timestamp",
    maximumAgeSeconds: policy.maximumCapabilityReceiptAgeSeconds,
    futureSkewSeconds: policy.maximumFutureClockSkewSeconds,
    nowMs,
    errors: admissionErrors,
  });
  for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
    if (typeof capabilityReceipt.capabilities?.[key] !== "string" || !capabilityReceipt.capabilities[key]) {
      admissionErrors.push(`Codex capability receipt lacks ${key}.`);
    }
  }

  if (supervisedAcceptance.kind !== "evavo-codex-spark-safe-physical-acceptance-v1" || supervisedAcceptance.schemaVersion !== 1) {
    admissionErrors.push("Supervised physical acceptance kind/schema is invalid.");
  }
  const supervisedTime = checkFreshness({
    value: supervisedAcceptance.supervisedAt,
    label: "Supervised physical acceptance timestamp",
    maximumAgeSeconds: policy.maximumPhysicalAcceptanceAgeSeconds,
    futureSkewSeconds: policy.maximumFutureClockSkewSeconds,
    nowMs,
    errors: admissionErrors,
  });

  if (acceptanceVerification.kind !== "evavo-codex-spark-safe-physical-acceptance-verification-v1") {
    admissionErrors.push("Supervised acceptance verification kind is invalid.");
  }
  if (acceptanceVerification.accepted !== true || acceptanceVerification.supervisedCleanupProven !== true) {
    admissionErrors.push("Supervised physical acceptance was not positively verified.");
  }
  if (acceptanceVerification.routeId !== policy.routeId) admissionErrors.push("Verified Spark route differs from capacity policy.");
  if (acceptanceVerification.modelPreference !== policy.modelPreference) admissionErrors.push("Verified Spark model differs from capacity policy.");
  if (acceptanceVerification.paidFallbackAllowed !== false) admissionErrors.push("Verified Spark admission does not explicitly forbid paid fallback.");
  if (!sameStringSet(acceptanceVerification.workerClasses, policy.admittedWorkerClasses)) {
    admissionErrors.push("Verified Spark worker classes differ from the deliberately admitted set.");
  }
  if (!Number.isInteger(acceptanceVerification.maximumConcurrency) || acceptanceVerification.maximumConcurrency !== policy.maximumConcurrency) {
    admissionErrors.push("Verified Spark concurrency differs from the deliberately admitted limit.");
  }

  const capacityEvidence = evidenceDigest(capacityObservationBytes, capacityObservation);
  const acceptanceEvidence = evidenceDigest(supervisedAcceptanceBytes, supervisedAcceptance);
  const capabilityEvidence = evidenceDigest(capabilityReceiptBytes, capabilityReceipt);
  const verificationEvidence = evidenceDigest(acceptanceVerificationBytes, acceptanceVerification);
  for (const evidence of [capacityEvidence, acceptanceEvidence, capabilityEvidence, verificationEvidence]) {
    if (!SHA256.test(evidence.sha256) || evidence.byteLength < 2) throw new Error("Capacity status evidence digest is invalid.");
  }

  const capacityDispatchable = policy.dispatchableRawCapacityStates.includes(rawState);
  const physicalAdmissionAccepted = admissionErrors.length === 0;
  const expiryCandidates = [nowMs + policy.maximumRouteAdmissionAgeSeconds * 1000];
  if (capacityTime) expiryCandidates.push(capacityTime.milliseconds + policy.maximumCapacityObservationAgeSeconds * 1000);
  if (capabilityTime) expiryCandidates.push(capabilityTime.milliseconds + policy.maximumCapabilityReceiptAgeSeconds * 1000);
  if (supervisedTime) expiryCandidates.push(supervisedTime.milliseconds + policy.maximumPhysicalAcceptanceAgeSeconds * 1000);
  const expiresMs = Math.min(...expiryCandidates);
  if (expiresMs <= nowMs) admissionErrors.push("The compiled Spark route admission would already be expired.");

  const dispatchEligible = capacityDispatchable && physicalAdmissionAccepted && admissionErrors.length === 0 && expiresMs > nowMs;
  const admissionState = dispatchEligible
    ? "ADMITTED"
    : !physicalAdmissionAccepted || admissionErrors.length > 0
      ? "PHYSICAL_ADMISSION_REJECTED"
      : "CAPACITY_UNAVAILABLE";

  const routeAdmissionBody = {
    schemaVersion: 1,
    kind: "evavo-codex-spark-route-admission-v1",
    routeId: policy.routeId,
    modelPreference: policy.modelPreference,
    capacityClass: policy.capacityClass,
    observedAt: nowIso,
    expiresAt: new Date(expiresMs).toISOString(),
    rawCapacityState: rawState,
    capacityDispatchable,
    physicalAdmissionAccepted,
    workerClassAdmissionAccepted: sameStringSet(acceptanceVerification.workerClasses, policy.admittedWorkerClasses),
    admittedWorkerClasses: [...policy.admittedWorkerClasses],
    maximumConcurrency: policy.maximumConcurrency,
    admitted: dispatchEligible,
    dispatchEligible,
    admissionState,
    admissionErrors: [...admissionErrors],
    evidence: {
      capacityObservation: { sha256: capacityEvidence.sha256, byteLength: capacityEvidence.byteLength },
      supervisedAcceptance: { sha256: acceptanceEvidence.sha256, byteLength: acceptanceEvidence.byteLength },
      capabilityReceipt: { sha256: capabilityEvidence.sha256, byteLength: capabilityEvidence.byteLength },
      acceptanceVerification: { sha256: verificationEvidence.sha256, byteLength: verificationEvidence.byteLength },
    },
    capabilityVersion: typeof capabilityReceipt.version === "string" ? capabilityReceipt.version : null,
    sameCapabilityReceiptRequiredAtDispatch: policy.requireSameCapabilityReceiptForVerificationAndDispatch === true,
    paidFallbackAllowed: false,
    modelTurnPerformed: false,
    providerCapacityQueryPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
  };
  const routeAdmissionSha256 = sha256Bytes(Buffer.from(canonicalJson(routeAdmissionBody), "utf8"));
  const routeAdmission = { ...routeAdmissionBody, routeAdmissionSha256 };

  return {
    schemaVersion: 1,
    kind: "evavo-worker-capacity-status-v1",
    observedAt: nowIso,
    expiresAt: routeAdmission.expiresAt,
    routes: [
      {
        routeId: policy.routeId,
        runtime: "codex",
        modelPreference: policy.modelPreference,
        capacityClass: policy.capacityClass,
        state: rawState,
        rawCapacityState: rawState,
        capacityDispatchable,
        physicalAdmissionAccepted,
        admittedWorkerClasses: [...policy.admittedWorkerClasses],
        workerClasses: [...policy.admittedWorkerClasses],
        maximumConcurrency: policy.maximumConcurrency,
        maximumAutomaticConcurrency: policy.maximumConcurrency,
        dispatchEligible,
        admissionState,
        routeAdmissionSha256,
        supervisedAcceptanceSha256: acceptanceEvidence.sha256,
        capabilityReceiptSha256: capabilityEvidence.sha256,
        capacityObservationSha256: capacityEvidence.sha256,
        acceptanceVerificationSha256: verificationEvidence.sha256,
        paidFallbackAllowed: false,
        routeAdmission,
      },
    ],
    rawCapacityPreservedSeparately: true,
    physicalAdmissionPreservedSeparately: true,
    capacityAloneIsExecutionAuthority: false,
    supervisedAcceptancePathReturned: false,
    capabilityReceiptPathReturned: false,
    modelTurnPerformed: false,
    providerCapacityQueryPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
    paidFallbackUsed: false,
    truthBoundary: "This read-only status joins exact raw-capacity, Codex-capability and supervised-acceptance evidence without conflating them. The raw capacity state remains visible even when physical admission is rejected. Only a short-lived digest-bound route admission can make dispatchEligible true.",
  };
}
