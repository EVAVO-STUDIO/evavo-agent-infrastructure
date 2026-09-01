#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(
  ROOT,
  "config",
  "documentation-truth-route-bound-lease-v2.json",
);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/;
const REPOSITORY = /^EVAVO-STUDIO\/[A-Za-z0-9._-]{1,100}$/;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const FALSE_AUTHORITY_FIELDS = Object.freeze([
  "configurationMutationPerformed",
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
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function text(value, label, maximum = 4096) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    /[\u0000\r\n]/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value;
}

function digest(value, label, pattern = SHA256) {
  const selected = text(value, label, 64).toLowerCase();
  if (!pattern.test(selected)) throw new Error(`${label} is invalid.`);
  return selected;
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, ordered(value[key])]),
  );
}

function canonical(value) {
  return JSON.stringify(ordered(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function without(value, key) {
  const result = { ...value };
  delete result[key];
  return result;
}

function regularJson(value, label, maximum = MAX_INPUT_BYTES) {
  const resolved = fs.realpathSync.native(path.resolve(text(value, `${label} path`)));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximum) {
    throw new Error(`${label} must be a bounded regular non-symlink file.`);
  }
  const bytes = fs.readFileSync(resolved);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
  return { path: resolved, bytes, sha256: sha256(bytes), document: object(document, label) };
}

function parseTime(value, label) {
  const selected = text(value, label, 64);
  const milliseconds = Date.parse(selected);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return milliseconds;
}

function canonicalTime(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function assertNoAuthority(document, label) {
  for (const field of FALSE_AUTHORITY_FIELDS) {
    if (document[field] === true) throw new Error(`${label} claims prohibited ${field}.`);
  }
}

function parseArguments(values) {
  const allowed = new Set([
    "--readiness",
    "--activation-run",
    "--route-plan",
    "--repository-head",
    "--worker-id",
    "--lease-seconds",
    "--now",
  ]);
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || !value || result.has(name)) {
      throw new Error("Route-bound lease arguments are invalid or duplicated.");
    }
    result.set(name, value);
  }
  for (const required of [
    "--readiness",
    "--activation-run",
    "--route-plan",
    "--repository-head",
    "--worker-id",
  ]) {
    if (!result.has(required)) throw new Error(`Missing required argument ${required}.`);
  }
  return result;
}

function verifiedCanonicalDigest(document, field, label) {
  const expected = digest(document[field], `${label}.${field}`);
  const observed = sha256(Buffer.from(canonical(without(document, field)), "utf8"));
  if (expected !== observed) throw new Error(`${label} canonical digest does not match.`);
  return expected;
}

function freshness({ observedAt, maximumAgeSeconds, futureSkewSeconds, now, label }) {
  if (observedAt - now > futureSkewSeconds * 1000) {
    throw new Error(`${label} is future-dated.`);
  }
  if (now - observedAt > maximumAgeSeconds * 1000) {
    throw new Error(`${label} is stale.`);
  }
}

function safeError(value) {
  let selected = String(value ?? "route-bound lease compilation failed");
  selected = selected.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  selected = selected.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  selected = selected.replace(
    /(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi,
    "credential=<redacted>",
  );
  return selected.slice(0, 1200);
}

function retainReady({ policy, readiness, route, now, reason, evidence }) {
  const body = {
    schemaVersion: 2,
    kind: policy.leasePlanKind,
    eligible: false,
    decision: "RETAIN_READY",
    reason,
    workItemId: readiness.workItemId,
    repository: readiness.repository,
    sourceRevision: readiness.sourceRevision,
    workerClass: policy.workerClass,
    workClass: policy.workClass,
    capacityClass: policy.capacityClass,
    routeId: route?.routeId ?? policy.routeId,
    observedAt: canonicalTime(now),
    expectedSnapshotSha256: readiness.evidence.workExchangeState,
    expectedGeneration: readiness.workExchangeGeneration,
    evidence,
    configurationMutationPerformed: false,
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
    truthBoundary: "The current route or lifetime cannot support a lease. The exact work item remains READY and no model capacity or mutation authority is consumed.",
  };
  return { ...body, leasePlanSha256: sha256(Buffer.from(canonical(body), "utf8")) };
}

try {
  const args = parseArguments(process.argv.slice(2));
  const policyEvidence = regularJson(POLICY_PATH, "route-bound lease policy", 2 * 1024 * 1024);
  const policy = policyEvidence.document;
  if (
    policy.schemaVersion !== 2 ||
    policy.kind !== "evavo-documentation-truth-route-bound-lease-policy-v2" ||
    policy.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure"
  ) {
    throw new Error("Route-bound lease policy identity is invalid.");
  }
  for (const field of [
    "queueMutationAuthority",
    "leaseAuthority",
    "modelAuthority",
    "repositoryMutationAuthority",
    "commitAuthority",
    "pushAuthority",
    "publicationAuthority",
    "deploymentAuthority",
    "financialAuthority",
    "paidFallbackAllowed",
  ]) {
    if (policy[field] !== false) throw new Error(`Route-bound lease policy must keep ${field}=false.`);
  }
  if (
    policy.maximumConcurrency !== 1 ||
    policy.maximumAutomaticAttempts !== 1 ||
    policy.minimumLeaseSeconds !== 60 ||
    policy.defaultLeaseSeconds !== 180 ||
    policy.maximumLeaseSeconds !== 300
  ) {
    throw new Error("Route-bound lease limits drifted.");
  }

  const readinessEvidence = regularJson(args.get("--readiness"), "lease readiness");
  const activationEvidence = regularJson(args.get("--activation-run"), "activation run");
  const routeEvidence = regularJson(args.get("--route-plan"), "worker route plan");
  const headEvidence = regularJson(args.get("--repository-head"), "repository head observation");
  const readiness = readinessEvidence.document;
  const activation = activationEvidence.document;
  const route = routeEvidence.document;
  const head = headEvidence.document;
  const nowInput = args.get("--now");
  const nowDate = nowInput ? new Date(nowInput) : new Date();
  if (!Number.isFinite(nowDate.getTime())) throw new Error("--now is invalid.");
  const now = nowDate.getTime();
  const futureSkew = policy.maximumFutureClockSkewSeconds;

  if (
    readiness.schemaVersion !== 2 ||
    readiness.kind !== policy.readinessKind ||
    readiness.decision !== "LEASE_READY" ||
    readiness.ready !== true
  ) {
    throw new Error("Local Storage readiness is not LEASE_READY.");
  }
  const readinessSha256 = verifiedCanonicalDigest(readiness, "readinessSha256", "lease readiness");
  if (
    readiness.workerClass !== policy.workerClass ||
    readiness.workClass !== policy.workClass ||
    readiness.capacityClass !== policy.capacityClass ||
    readiness.maximumConcurrency !== 1 ||
    readiness.maximumAutomaticAttempts !== 1 ||
    readiness.oneWriterPerRepository !== true ||
    readiness.activeRepositoryWriterWorkItemId !== null
  ) {
    throw new Error("Lease readiness identity or one-writer boundary differs from policy.");
  }
  if (!REPOSITORY.test(readiness.repository ?? "") || !SHA1.test(readiness.sourceRevision ?? "")) {
    throw new Error("Lease readiness repository or source revision is invalid.");
  }
  if (!Number.isInteger(readiness.workExchangeGeneration) || readiness.workExchangeGeneration < 0) {
    throw new Error("Lease readiness Work Exchange generation is invalid.");
  }
  assertNoAuthority(readiness, "Lease readiness");
  const readinessObservedAt = parseTime(readiness.observedAt, "lease readiness observedAt");
  freshness({
    observedAt: readinessObservedAt,
    maximumAgeSeconds: policy.maximumReadinessAgeSeconds,
    futureSkewSeconds: futureSkew,
    now,
    label: "Lease readiness",
  });
  const readinessDigests = object(readiness.evidence, "lease readiness evidence");
  for (const name of ["policy", "activationRun", "workExchangeState", "repositoryHead"]) {
    digest(readinessDigests[name], `lease readiness evidence.${name}`);
  }

  if (
    activation.schemaVersion !== 2 ||
    activation.kind !== policy.activationKind ||
    activation.decision !== "ACTIVATE_ELIGIBLE" ||
    activation.eligible !== true
  ) {
    throw new Error("Activation run is not ACTIVATE_ELIGIBLE.");
  }
  const activationSha256 = verifiedCanonicalDigest(
    activation,
    "activationRunSha256",
    "activation run",
  );
  if (
    readiness.activationRunSha256 !== activationSha256 ||
    readinessDigests.activationRun !== activationEvidence.sha256
  ) {
    throw new Error("Lease readiness is not bound to the exact activation run.");
  }
  if (
    activation.repository !== readiness.repository ||
    activation.sourceRevision !== readiness.sourceRevision ||
    activation.workerClass !== policy.workerClass ||
    activation.workClass !== policy.workClass ||
    activation.capacityClass !== policy.capacityClass ||
    activation.maximumConcurrency !== 1 ||
    activation.maximumAutomaticAttempts !== 1
  ) {
    throw new Error("Activation and readiness identities differ.");
  }
  assertNoAuthority(activation, "Activation run");
  const activationObservedAt = parseTime(activation.observedAt, "activation observedAt");
  const activationExpiresAt = parseTime(activation.expiresAt, "activation expiresAt");
  if (activationObservedAt - now > futureSkew * 1000 || activationExpiresAt <= now) {
    throw new Error("Activation run is future-dated or expired.");
  }

  const observedHeadRepository = head.repository ?? head.repositoryFullName;
  const observedHeadSha = String(head.sha ?? head.headSha ?? head.sourceRevision ?? "").toLowerCase();
  const observedHeadBranch = head.ref ?? head.branch ?? head.defaultBranch;
  if (
    observedHeadRepository !== readiness.repository ||
    observedHeadSha !== readiness.sourceRevision ||
    observedHeadBranch !== "main"
  ) {
    throw new Error("Current-main observation differs from lease readiness.");
  }
  if (
    policy.requireTrustedReadOnlyHeadObservation === true &&
    (head.trusted !== true || head.readOnly !== true)
  ) {
    throw new Error("Current-main observation is not trusted read-only evidence.");
  }
  if (readinessDigests.repositoryHead !== headEvidence.sha256) {
    throw new Error("Lease readiness is not bound to the exact repository-head bytes.");
  }
  assertNoAuthority(head, "Repository-head observation");
  const headObservedAt = parseTime(
    head.observedAt ?? head.recordedAt ?? head.createdAt,
    "repository head observedAt",
  );
  freshness({
    observedAt: headObservedAt,
    maximumAgeSeconds: policy.maximumHeadAgeSeconds,
    futureSkewSeconds: futureSkew,
    now,
    label: "Repository-head observation",
  });

  const commonEvidence = {
    policy: policyEvidence.sha256,
    readiness: readinessEvidence.sha256,
    activationRun: activationEvidence.sha256,
    routePlan: routeEvidence.sha256,
    repositoryHead: headEvidence.sha256,
  };

  if (route.eligible !== true || route.decision !== "DISPATCH_ELIGIBLE") {
    const output = retainReady({
      policy,
      readiness,
      route,
      now,
      reason: route.reason ?? "NO_CURRENT_DOCUMENTATION_TRUTH_ROUTE",
      evidence: commonEvidence,
    });
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exit(0);
  }
  if (route.schemaVersion !== 1 || route.kind !== policy.routePlanKind) {
    throw new Error("Worker route plan kind/schema is invalid.");
  }
  const routePlanSha256 = verifiedCanonicalDigest(route, "routePlanSha256", "worker route plan");
  if (
    route.workerClass !== policy.workerClass ||
    route.repository !== readiness.repository ||
    route.sourceRevision !== readiness.sourceRevision ||
    route.routeId !== policy.routeId ||
    route.runtime !== policy.runtime ||
    route.modelPreference !== policy.modelPreference ||
    route.capacityClass !== policy.capacityClass ||
    !policy.dispatchableRawCapacityStates.includes(route.rawCapacityState) ||
    route.capacityState !== route.rawCapacityState ||
    route.maximumConcurrency !== 1 ||
    route.maximumAutomaticConcurrency !== 1 ||
    route.paidFallbackUsed !== false ||
    route.executionPerformed !== false ||
    route.validationPerformed !== false ||
    route.publicationPerformed !== false
  ) {
    throw new Error("Worker route plan differs from the documentation-truth policy.");
  }
  for (const field of [
    "capacityStatusSha256",
    "routeAdmissionSha256",
    "supervisedAcceptanceSha256",
    "capabilityReceiptSha256",
    "capacityObservationSha256",
    "acceptanceVerificationSha256",
  ]) {
    digest(route[field], `worker route plan.${field}`);
  }
  const routeObservedAt = parseTime(route.routeAdmissionObservedAt, "route admission observedAt");
  const routeExpiresAt = parseTime(route.routeAdmissionExpiresAt, "route admission expiresAt");
  freshness({
    observedAt: routeObservedAt,
    maximumAgeSeconds: policy.maximumRoutePlanAgeSeconds,
    futureSkewSeconds: futureSkew,
    now,
    label: "Route admission",
  });
  if (routeExpiresAt <= now) throw new Error("Route admission is expired.");

  const workerId = text(args.get("--worker-id"), "worker id", 128);
  if (!WORKER_ID.test(workerId)) throw new Error("Worker id is invalid.");
  const leaseSecondsInput = args.get("--lease-seconds");
  const leaseSeconds = leaseSecondsInput === undefined
    ? policy.defaultLeaseSeconds
    : Number.parseInt(leaseSecondsInput, 10);
  if (
    !Number.isSafeInteger(leaseSeconds) ||
    String(leaseSeconds) !== String(leaseSecondsInput ?? policy.defaultLeaseSeconds) ||
    leaseSeconds < policy.minimumLeaseSeconds ||
    leaseSeconds > policy.maximumLeaseSeconds
  ) {
    throw new Error("Requested lease duration is outside policy.");
  }
  const leaseExpiresAt = now + leaseSeconds * 1000;
  if (leaseExpiresAt > activationExpiresAt || leaseExpiresAt > routeExpiresAt) {
    const output = retainReady({
      policy,
      readiness,
      route,
      now,
      reason: "INSUFFICIENT_ACTIVATION_OR_ROUTE_LIFETIME",
      evidence: commonEvidence,
    });
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exit(0);
  }
  const planExpiresAt = Math.min(
    now + Math.min(60, policy.maximumReadinessAgeSeconds) * 1000,
    activationExpiresAt,
    routeExpiresAt,
  );

  const body = {
    schemaVersion: 2,
    kind: policy.leasePlanKind,
    eligible: true,
    decision: "LEASE_REQUIRED",
    action: policy.action,
    workItemId: readiness.workItemId,
    repository: readiness.repository,
    sourceRevision: readiness.sourceRevision,
    workerId,
    workerClass: policy.workerClass,
    workClass: policy.workClass,
    capacityClass: policy.capacityClass,
    routeId: policy.routeId,
    runtime: policy.runtime,
    modelPreference: policy.modelPreference,
    rawCapacityState: route.rawCapacityState,
    maximumConcurrency: 1,
    maximumAutomaticAttempts: 1,
    oneWriterPerRepository: true,
    expectedSnapshotSha256: readinessDigests.workExchangeState,
    expectedGeneration: readiness.workExchangeGeneration,
    readinessSha256,
    readinessBytesSha256: readinessEvidence.sha256,
    activationRunSha256: activationSha256,
    activationRunBytesSha256: activationEvidence.sha256,
    repositoryHeadBytesSha256: headEvidence.sha256,
    routePlanSha256,
    routePlanBytesSha256: routeEvidence.sha256,
    capacityStatusSha256: route.capacityStatusSha256,
    routeAdmissionSha256: route.routeAdmissionSha256,
    supervisedAcceptanceSha256: route.supervisedAcceptanceSha256,
    capabilityReceiptSha256: route.capabilityReceiptSha256,
    capacityObservationSha256: route.capacityObservationSha256,
    acceptanceVerificationSha256: route.acceptanceVerificationSha256,
    routeAdmissionObservedAt: canonicalTime(routeObservedAt),
    routeAdmissionExpiresAt: canonicalTime(routeExpiresAt),
    observedAt: canonicalTime(now),
    expiresAt: canonicalTime(planExpiresAt),
    leaseSeconds,
    leaseExpiresAt: canonicalTime(leaseExpiresAt),
    evidence: commonEvidence,
    configurationMutationPerformed: false,
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
    truthBoundary: policy.truthBoundary,
  };
  process.stdout.write(`${JSON.stringify({
    ...body,
    leasePlanSha256: sha256(Buffer.from(canonical(body), "utf8")),
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 2,
    kind: "evavo-documentation-truth-route-bound-lease-plan-v2",
    eligible: false,
    decision: "REJECTED",
    errorType: error?.constructor?.name ?? "Error",
    errorMessage: safeError(error?.message ?? error),
    configurationMutationPerformed: false,
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
  }, null, 2)}\n`);
  process.exitCode = 1;
}
