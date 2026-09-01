#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_INPUT_BYTES = 1024 * 1024;
const FUTURE_TOLERANCE_MS = 120_000;
const argv = process.argv.slice(2);
if (argv.length !== 5) {
  console.error(
    "Usage: node scripts/assemble-codex-spark-effective-capacity.mjs " +
      "<raw-capacity.json> <codex-capability.json> <chatgpt-auth-policy.json> " +
      "<physical-acceptance-verification.json> <route-admission.json>",
  );
  process.exit(2);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isSha256 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const asArray = (value) => (Array.isArray(value) ? value : []);
const uniqueStrings = (value) => [...new Set(asArray(value).filter((entry) => typeof entry === "string" && entry.length > 0))];
const boundedInteger = (value, minimum = 1, maximum = 64) =>
  Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;

function readEvidence(input, label) {
  const resolved = fs.realpathSync.native(path.resolve(input));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  if (stat.size < 2 || stat.size > MAX_INPUT_BYTES) {
    throw new Error(`${label} size is outside the bounded contract.`);
  }
  const bytes = fs.readFileSync(resolved);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must contain UTF-8 JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain one JSON object.`);
  }
  return { value, sha256: sha256(bytes), bytes: bytes.length };
}

function firstValue(object, names) {
  for (const name of names) {
    if (object?.[name] !== undefined && object?.[name] !== null) return object[name];
  }
  return null;
}

function binding(object, name) {
  return (
    object?.[name] ??
    object?.bindings?.[name] ??
    object?.evidenceBindings?.[name] ??
    object?.admissionBindings?.[name] ??
    null
  );
}

function timestampStatus(object, names, maximumAgeSeconds, now) {
  const raw = firstValue(object, names);
  const parsed = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return { fresh: false, value: raw, reason: "timestamp-missing-or-invalid" };
  if (parsed - now > FUTURE_TOLERANCE_MS) return { fresh: false, value: raw, reason: "timestamp-future-dated" };
  if (now - parsed > maximumAgeSeconds * 1000) return { fresh: false, value: raw, reason: "timestamp-stale" };
  return { fresh: true, value: raw, ageSeconds: Math.max(0, Math.floor((now - parsed) / 1000)) };
}

const policyEvidence = readEvidence(
  path.join(ROOT, "config", "codex-spark-effective-capacity-v1.json"),
  "effective-capacity policy",
);
const policy = policyEvidence.value;
const [rawEvidence, capabilityEvidence, authenticationEvidence, physicalEvidence, admissionEvidence] = [
  readEvidence(argv[0], "raw Spark capacity observation"),
  readEvidence(argv[1], "Codex capability receipt"),
  readEvidence(argv[2], "ChatGPT authentication-policy receipt"),
  readEvidence(argv[3], "physical-acceptance verification"),
  readEvidence(argv[4], "short-lived route admission"),
];

const raw = rawEvidence.value;
const capability = capabilityEvidence.value;
const authentication = authenticationEvidence.value;
const physical = physicalEvidence.value;
const admission = admissionEvidence.value;
const contractErrors = [];
const blockingReasons = [];
const now = Date.now();

if (policy.schemaVersion !== 1 || policy.kind !== "evavo-codex-spark-effective-capacity-policy-v1") {
  contractErrors.push("Effective-capacity policy identity is invalid.");
}
if (policy.paidFallbackAllowed !== false) contractErrors.push("Effective-capacity policy must forbid paid fallback.");

if (raw.schemaVersion !== 1 || raw.kind !== "evavo-codex-spark-raw-capacity-observation-v1") {
  contractErrors.push("Raw capacity observation kind/schema is invalid.");
}
if (raw.routeId !== policy.routeId) contractErrors.push("Raw capacity route differs from policy.");
if (raw.modelPreference !== policy.modelPreference) contractErrors.push("Raw capacity model differs from policy.");
if (raw.capacityClass !== policy.capacityClass) contractErrors.push("Raw capacity class differs from policy.");
if (raw.evidenceClass !== "observed-not-inferred") contractErrors.push("Raw capacity must be explicitly observed, never inferred.");
if (raw.paidFallbackUsed !== false || raw.paidFallbackAllowed === true) contractErrors.push("Raw capacity evidence permits or reports paid fallback.");
const rawStates = new Set(policy.rawCapacityStates ?? []);
if (!rawStates.has(raw.state)) contractErrors.push("Raw capacity state is not admitted by policy.");
const rawFreshness = timestampStatus(raw, ["observedAt", "recordedAt", "completedAt"], policy.maximumAgeSeconds.rawCapacityObservation, now);
if (!rawFreshness.fresh) blockingReasons.push(`raw-capacity:${rawFreshness.reason}`);

if (capability.schemaVersion !== 1 || capability.kind !== "evavo-codex-worker-capability-probe-v1") {
  contractErrors.push("Codex capability receipt kind/schema is invalid.");
}
if (capability.eligibleForWorkerDispatch !== true) blockingReasons.push("codex-capability:not-dispatch-eligible");
for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
  if (typeof capability.capabilities?.[key] !== "string" || !capability.capabilities[key]) {
    contractErrors.push(`Codex capability receipt lacks ${key}.`);
  }
}
const capabilityFreshness = timestampStatus(
  capability,
  ["observedAt", "recordedAt", "completedAt"],
  policy.maximumAgeSeconds.codexCapabilityProbe,
  now,
);
if (!capabilityFreshness.fresh) blockingReasons.push(`codex-capability:${capabilityFreshness.reason}`);

const authKind = String(authentication.kind ?? "");
if (authentication.schemaVersion !== 1 || !authKind.includes("codex") || !authKind.includes("auth")) {
  contractErrors.push("ChatGPT authentication-policy receipt kind/schema is invalid.");
}
const authenticationAccepted =
  authentication.accepted === true ||
  authentication.authPolicyAccepted === true ||
  authentication.chatgptOnly === true ||
  authentication.chatgptConsumerOnly === true ||
  authentication.eligibleForConsumerAuth === true;
const authenticationClass = firstValue(authentication, ["authenticationClass", "authClass", "loginClass"]);
if (authenticationClass !== null && authenticationClass !== "chatgpt-consumer") {
  contractErrors.push("Authentication-policy receipt does not identify ChatGPT consumer authentication.");
}
if (
  authentication.apiKeyAllowed === true ||
  authentication.apiLoginAllowed === true ||
  authentication.mixedLoginAllowed === true ||
  authentication.providerApiCredentialsRequired === true
) {
  contractErrors.push("Authentication-policy receipt permits API or mixed login.");
}
if (!authenticationAccepted) blockingReasons.push("chatgpt-authentication:not-accepted");
const authenticationFreshness = timestampStatus(
  authentication,
  ["observedAt", "recordedAt", "completedAt", "verifiedAt"],
  policy.maximumAgeSeconds.chatgptAuthenticationProbe,
  now,
);
if (!authenticationFreshness.fresh) blockingReasons.push(`chatgpt-authentication:${authenticationFreshness.reason}`);

if (
  physical.schemaVersion !== 1 ||
  physical.kind !== "evavo-codex-spark-safe-physical-acceptance-verification-v1"
) {
  contractErrors.push("Physical-acceptance verification kind/schema is invalid.");
}
if (physical.accepted !== true || physical.supervisedCleanupProven !== true) {
  blockingReasons.push("physical-acceptance:not-accepted");
}
if (physical.routeId !== policy.routeId || physical.modelPreference !== policy.modelPreference) {
  contractErrors.push("Physical-acceptance verification route/model differs from policy.");
}
if (physical.paidFallbackAllowed !== false) contractErrors.push("Physical acceptance does not forbid paid fallback.");
const physicalClasses = uniqueStrings(physical.workerClasses);
const policyClasses = uniqueStrings(policy.initialAdmission?.workerClasses);
const unadmittedPhysicalClasses = physicalClasses.filter((entry) => !policyClasses.includes(entry));
if (unadmittedPhysicalClasses.length) {
  contractErrors.push(`Physical acceptance admits unapproved worker classes: ${unadmittedPhysicalClasses.join(", ")}.`);
}
const physicalConcurrency = boundedInteger(physical.maximumConcurrency);
if (physicalConcurrency === null) contractErrors.push("Physical-acceptance concurrency is invalid.");
else if (physicalConcurrency > policy.initialAdmission.maximumConcurrency) {
  contractErrors.push("Physical acceptance exceeds the initial concurrency ceiling.");
}
const physicalFreshness = timestampStatus(
  physical,
  ["observedAt", "verifiedAt", "completedAt", "recordedAt", "generatedAt"],
  policy.maximumAgeSeconds.physicalAcceptanceVerification,
  now,
);
if (!physicalFreshness.fresh) blockingReasons.push(`physical-acceptance:${physicalFreshness.reason}`);

const admissionKind = String(admission.kind ?? "");
if (
  admission.schemaVersion !== 1 ||
  !(admissionKind === "evavo-codex-spark-route-admission-v1" || admissionKind.includes("codex-spark-route-admission"))
) {
  contractErrors.push("Short-lived route-admission kind/schema is invalid.");
}
const routeAdmitted = admission.accepted === true || admission.admitted === true || admission.eligible === true;
if (!routeAdmitted) blockingReasons.push("route-admission:not-accepted");
if (admission.routeId !== policy.routeId || admission.modelPreference !== policy.modelPreference) {
  contractErrors.push("Route admission route/model differs from policy.");
}
if (admission.capacityClass !== undefined && admission.capacityClass !== policy.capacityClass) {
  contractErrors.push("Route admission capacity class differs from policy.");
}
if (admission.paidFallbackAllowed !== false || admission.paidFallbackUsed === true) {
  contractErrors.push("Route admission does not preserve zero-paid-fallback policy.");
}
const admissionClasses = uniqueStrings(firstValue(admission, ["workerClasses", "admittedWorkerClasses"]));
const unadmittedRouteClasses = admissionClasses.filter((entry) => !policyClasses.includes(entry));
if (unadmittedRouteClasses.length) {
  contractErrors.push(`Route admission contains unapproved worker classes: ${unadmittedRouteClasses.join(", ")}.`);
}
const admissionConcurrency = boundedInteger(firstValue(admission, ["maximumConcurrency", "admittedMaximumConcurrency"]));
if (admissionConcurrency === null) contractErrors.push("Route-admission concurrency is invalid.");
else if (admissionConcurrency > policy.initialAdmission.maximumConcurrency) {
  contractErrors.push("Route admission exceeds the initial concurrency ceiling.");
}
const admissionFreshness = timestampStatus(
  admission,
  ["admittedAt", "issuedAt", "observedAt", "recordedAt", "completedAt"],
  policy.maximumAgeSeconds.routeAdmission,
  now,
);
if (!admissionFreshness.fresh) blockingReasons.push(`route-admission:${admissionFreshness.reason}`);
const expiresAtRaw = firstValue(admission, ["expiresAt", "validUntil"]);
const expiresAt = typeof expiresAtRaw === "string" ? Date.parse(expiresAtRaw) : Number.NaN;
if (!Number.isFinite(expiresAt)) contractErrors.push("Route admission expiry is missing or invalid.");
else if (expiresAt <= now) blockingReasons.push("route-admission:expired");
else if (expiresAt - now > policy.maximumAgeSeconds.routeAdmission * 1000 + FUTURE_TOLERANCE_MS) {
  contractErrors.push("Route admission expiry exceeds the short-lived policy ceiling.");
}

const capabilityBinding = binding(admission, "codexCapabilityReceiptSha256");
const physicalBinding = binding(admission, "physicalAcceptanceVerificationSha256");
const supervisedAcceptanceSha256 = binding(admission, "supervisedAcceptanceSha256");
if (!isSha256(capabilityBinding) || capabilityBinding !== capabilityEvidence.sha256) {
  contractErrors.push("Route admission is not bound to the exact Codex capability receipt.");
}
if (!isSha256(physicalBinding) || physicalBinding !== physicalEvidence.sha256) {
  contractErrors.push("Route admission is not bound to the exact physical-acceptance verification.");
}
if (!isSha256(supervisedAcceptanceSha256)) {
  contractErrors.push("Route admission lacks a supervised physical-acceptance SHA-256 binding.");
}
const physicalSupervisedBinding = binding(physical, "supervisedAcceptanceSha256");
if (physicalSupervisedBinding !== null && physicalSupervisedBinding !== supervisedAcceptanceSha256) {
  contractErrors.push("Route admission and physical verification disagree on supervised acceptance identity.");
}

const rawState = rawStates.has(raw.state) ? raw.state : "UNKNOWN";
let effectiveState = "UNKNOWN";
if (["RATE_LIMITED", "EXHAUSTED", "AUTH_REQUIRED", "OFFLINE", "UNKNOWN"].includes(rawState)) {
  effectiveState = rawState;
} else if (!capabilityFreshness.fresh || capability.eligibleForWorkerDispatch !== true) {
  effectiveState = "OFFLINE";
} else if (!authenticationFreshness.fresh || !authenticationAccepted) {
  effectiveState = "AUTH_REQUIRED";
} else if (
  contractErrors.length === 0 &&
  rawFreshness.fresh &&
  physicalFreshness.fresh &&
  physical.accepted === true &&
  physical.supervisedCleanupProven === true &&
  admissionFreshness.fresh &&
  Number.isFinite(expiresAt) &&
  expiresAt > now &&
  routeAdmitted
) {
  effectiveState = rawState;
}

const effectiveClasses = policyClasses.filter(
  (entry) => physicalClasses.includes(entry) && admissionClasses.includes(entry),
);
if (["AVAILABLE", "DEGRADED"].includes(effectiveState) && effectiveClasses.length === 0) {
  contractErrors.push("No worker class survives policy, physical-acceptance and route-admission intersection.");
  effectiveState = "UNKNOWN";
}
const rawConcurrency = boundedInteger(raw.maximumConcurrency) ?? Number.POSITIVE_INFINITY;
const concurrencyCandidates = [
  policy.initialAdmission.maximumConcurrency,
  physicalConcurrency ?? 0,
  admissionConcurrency ?? 0,
  rawConcurrency,
];
const effectiveConcurrency = ["AVAILABLE", "DEGRADED"].includes(effectiveState)
  ? Math.max(0, Math.min(...concurrencyCandidates))
  : 0;
if (["AVAILABLE", "DEGRADED"].includes(effectiveState) && effectiveConcurrency < 1) {
  contractErrors.push("Effective concurrency is zero despite an available state.");
  effectiveState = "UNKNOWN";
}

const eligible =
  contractErrors.length === 0 &&
  (policy.eligibleEffectiveStates ?? []).includes(effectiveState) &&
  effectiveClasses.length > 0 &&
  effectiveConcurrency >= 1;
const observedAt = new Date(now).toISOString();
const routeStatus = {
  routeId: policy.routeId,
  modelPreference: policy.modelPreference,
  capacityClass: policy.capacityClass,
  state: effectiveState,
  rawState,
  eligible,
  admittedWorkerClasses: eligible ? effectiveClasses : [],
  workerClasses: eligible ? effectiveClasses : [],
  maximumConcurrency: eligible ? effectiveConcurrency : 0,
  maximumAutomaticConcurrency: eligible ? effectiveConcurrency : 0,
  paidFallbackAllowed: false,
  paidFallbackUsed: false,
  supervisedAcceptanceSha256: isSha256(supervisedAcceptanceSha256) ? supervisedAcceptanceSha256 : null,
  codexCapabilityReceiptSha256: capabilityEvidence.sha256,
  physicalAcceptanceVerificationSha256: physicalEvidence.sha256,
  routeAdmissionSha256: admissionEvidence.sha256,
  rawCapacityObservationSha256: rawEvidence.sha256,
};

const result = {
  schemaVersion: 1,
  kind: "evavo-worker-capacity-status-v1",
  ok: contractErrors.length === 0,
  observedAt,
  routeId: policy.routeId,
  eligible,
  effectiveState,
  rawState,
  routes: [routeStatus],
  evidence: {
    policy: { sha256: policyEvidence.sha256, bytes: policyEvidence.bytes },
    rawCapacity: {
      state: rawState,
      observedAt: rawFreshness.value,
      fresh: rawFreshness.fresh,
      source: raw.source ?? null,
      evidenceClass: raw.evidenceClass ?? null,
      sha256: rawEvidence.sha256,
      bytes: rawEvidence.bytes,
    },
    transport: {
      eligible: capability.eligibleForWorkerDispatch === true,
      version: capability.version ?? null,
      observedAt: capabilityFreshness.value,
      fresh: capabilityFreshness.fresh,
      sha256: capabilityEvidence.sha256,
      bytes: capabilityEvidence.bytes,
    },
    authentication: {
      accepted: authenticationAccepted,
      authenticationClass: authenticationClass ?? "chatgpt-consumer",
      observedAt: authenticationFreshness.value,
      fresh: authenticationFreshness.fresh,
      sha256: authenticationEvidence.sha256,
      bytes: authenticationEvidence.bytes,
    },
    physicalAdmission: {
      accepted: physical.accepted === true,
      supervisedCleanupProven: physical.supervisedCleanupProven === true,
      workerClasses: physicalClasses,
      maximumConcurrency: physicalConcurrency,
      observedAt: physicalFreshness.value,
      fresh: physicalFreshness.fresh,
      sha256: physicalEvidence.sha256,
      bytes: physicalEvidence.bytes,
    },
    routeAdmission: {
      accepted: routeAdmitted,
      workerClasses: admissionClasses,
      maximumConcurrency: admissionConcurrency,
      admittedAt: admissionFreshness.value,
      expiresAt: expiresAtRaw,
      fresh: admissionFreshness.fresh && Number.isFinite(expiresAt) && expiresAt > now,
      sha256: admissionEvidence.sha256,
      bytes: admissionEvidence.bytes,
    },
  },
  blockingReasons: [...new Set(blockingReasons)],
  contractErrors,
  modelTurnPerformed: false,
  accountUsageQueried: false,
  capacityInferredFromTransport: false,
  capacityInferredFromAuthentication: false,
  capacityInferredFromPhysicalAcceptance: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
  paidFallbackAllowed: false,
  paidFallbackUsed: false,
  truthBoundary:
    "Raw Spark capacity remains an independently observed fact. Codex transport, ChatGPT authentication, supervised physical acceptance and short-lived route admission are separately hashed and freshness-checked; none is treated as quota evidence. Availability is emitted only when all independent layers are affirmative and mutually bound.",
};

const serialized = JSON.stringify(result, null, 2);
if (contractErrors.length) console.error(serialized);
else console.log(serialized);
process.exit(contractErrors.length ? 1 : 0);
