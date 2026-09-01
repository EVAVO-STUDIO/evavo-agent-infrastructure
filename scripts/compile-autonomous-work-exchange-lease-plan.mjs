#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^EVAVO-STUDIO\/[A-Za-z0-9._-]{1,100}$/;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const ACTIVE_WRITER_STATES = new Set([
  "LEASED",
  "RUNNING",
  "CANDIDATE_READY",
  "VALIDATING",
  "REVIEWING",
  "PUBLISHABLE",
]);
const MAX_BYTES = 32 * 1024 * 1024;

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(ordered(value));
}

function sha256(value) {
  return createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).digest("hex");
}

function readJsonBytes(input, label, maximum = MAX_BYTES) {
  const resolved = fs.realpathSync.native(path.resolve(input));
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
  if (!OBJECT(document)) throw new Error(`${label} must contain a JSON object.`);
  return { resolved, bytes, sha256: sha256(bytes), document };
}

function string(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value || value.length > maximum || value.includes("\0")) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value;
}

function exactSha(value, label, expression = SHA256) {
  const text = string(value, label, 64);
  if (!expression.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}

function parseTime(value, label) {
  const text = string(value, label, 64);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return milliseconds;
}

function safeRelativePath(value, label) {
  const normalized = string(value, label, 512).replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === ".." || part === ".git") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new Error(`${label} is not a safe repository-relative path.`);
  }
  return normalized;
}

function validateDocumentationTruth(work, policy) {
  const rules = policy.documentationTruth;
  if (work.workClass !== rules.workClass || work.category !== rules.category) {
    throw new Error("documentation-truth work class/category is not admitted.");
  }
  if (work.documentationMetadataMutationAllowed !== true) {
    throw new Error("documentation-truth requires explicit bounded metadata authority.");
  }
  const paths = Array.isArray(work.allowedPaths) ? work.allowedPaths.map((item) => safeRelativePath(item, "allowed path")) : [];
  if (paths.length < 1 || paths.length > 2 || paths.some((item) => !rules.canonicalAllowedPaths.includes(item))) {
    throw new Error("documentation-truth may target only canonical capability-manifest paths.");
  }
  if (
    work.maximumChangedFiles !== rules.maximumChangedFiles ||
    !Number.isInteger(work.maximumChangedLines) ||
    work.maximumChangedLines < 1 ||
    work.maximumChangedLines > rules.maximumChangedLines ||
    work.maximumAutomaticAttempts !== rules.maximumAutomaticAttempts
  ) {
    throw new Error("documentation-truth change or retry bounds are invalid.");
  }
  if (work.requiresCurrentHeadMatch !== true || work.noActionAccepted !== true) {
    throw new Error("documentation-truth must require current-head continuity and accept NO_ACTION.");
  }
  for (const key of [
    "productionSourceMutationAllowed",
    "dependencyChangeAllowed",
    "schemaChangeAllowed",
    "publicApiChangeAllowed",
    "workerMayCommit",
    "workerMayPush",
    "workerMayPublish",
  ]) {
    if (work[key] !== false) throw new Error(`documentation-truth ${key} must remain false.`);
  }
}

function validateWork(work, policy) {
  if (work.schemaVersion !== 1 || work.kind !== "evavo-autonomous-improvement-work-item-v1") {
    throw new Error("READY work item kind/schema is invalid.");
  }
  if (work.lifecycleState !== "READY" || work.lease !== null) {
    throw new Error("Lease planning admits only an unleased READY work item.");
  }
  string(work.id, "work item id", 160);
  const repository = string(work.repository, "work item repository", 140);
  if (!REPOSITORY.test(repository)) throw new Error("work item repository is invalid.");
  exactSha(work.sourceRevision, "work item source revision", SHA1);
  exactSha(work.dedupeKey, "work item dedupe key");
  if (!OBJECT(work.origin)) throw new Error("work item origin is missing.");
  exactSha(work.origin.evidenceFingerprintSha256, "work item evidence fingerprint");
  if (!policy.acceptedWorkerClasses.includes(work.workerClass)) throw new Error("work item worker class is not admitted.");
  if (work.capacityClass !== "included-consumer" || work.paidFallbackAllowed !== false) {
    throw new Error("autonomous lease work must remain included-consumer with paid fallback disabled.");
  }
  for (const key of ["workerMayCommit", "workerMayPush", "workerMayPublish"]) {
    if (work[key] !== false) throw new Error(`work item ${key} must remain false.`);
  }
  if (work.workerClass === "documentation-truth") validateDocumentationTruth(work, policy);
}

function validateSnapshot(snapshot, work, now) {
  if (snapshot.schemaVersion !== 1 || !["evavo-work-exchange-state-v1", "evavo-autonomous-work-exchange-state-v1"].includes(snapshot.kind)) {
    throw new Error("Work Exchange snapshot kind/schema is invalid.");
  }
  if (!Number.isInteger(snapshot.generation) || snapshot.generation < 0 || !Array.isArray(snapshot.items)) {
    throw new Error("Work Exchange snapshot generation/items are invalid.");
  }
  const matches = snapshot.items.filter((item) => OBJECT(item) && item.id === work.id);
  if (matches.length !== 1) throw new Error("READY work item must exist exactly once in the snapshot.");
  const target = matches[0];
  for (const key of ["repository", "sourceRevision", "workerClass", "capacityClass", "dedupeKey", "lifecycleState"]) {
    if (target[key] !== work[key]) throw new Error(`snapshot target ${key} differs from the supplied work item.`);
  }
  if (target.lease !== null) throw new Error("snapshot target is already leased.");
  const writer = snapshot.items.find((item) => {
    if (!OBJECT(item) || item.id === work.id || item.repository !== work.repository || !ACTIVE_WRITER_STATES.has(item.lifecycleState)) return false;
    if (!OBJECT(item.lease)) return true;
    if (typeof item.lease.expiresAt !== "string") return true;
    const expiry = Date.parse(item.lease.expiresAt);
    return !Number.isFinite(expiry) || expiry > now;
  });
  if (writer) throw new Error(`repository already has an active writer: ${String(writer.id ?? "unknown")}`);
}

function validateRoute(route, routeBytesSha256, work, policy, now) {
  if (route.schemaVersion !== 1 || route.kind !== policy.acceptedRoutePlanKind || route.eligible !== true || route.decision !== "DISPATCH_ELIGIBLE") {
    throw new Error("Worker route plan is not dispatch eligible.");
  }
  const expectedRouteSha = exactSha(route.routePlanSha256, "route plan SHA-256");
  const routeBody = { ...route };
  delete routeBody.routePlanSha256;
  if (sha256(canonicalJson(routeBody)) !== expectedRouteSha) throw new Error("route plan canonical SHA-256 is invalid.");
  if (route.workerClass !== work.workerClass || route.repository !== work.repository || route.sourceRevision !== work.sourceRevision) {
    throw new Error("route plan work identity differs from the READY item.");
  }
  if (route.capacityClass !== work.capacityClass || route.paidFallbackUsed !== false) {
    throw new Error("route plan capacity or paid-fallback posture differs from the READY item.");
  }
  if (route.executionPerformed !== false || route.validationPerformed !== false || route.publicationPerformed !== false) {
    throw new Error("route plan exceeds planning-only authority.");
  }
  if (route.maximumConcurrency !== 1 || route.maximumAutomaticConcurrency !== 1) {
    throw new Error("route plan exceeds autonomous concurrency one.");
  }
  for (const key of [
    "routeAdmissionSha256",
    "supervisedAcceptanceSha256",
    "capabilityReceiptSha256",
    "capacityObservationSha256",
    "acceptanceVerificationSha256",
    "capacityStatusSha256",
  ]) exactSha(route[key], key);
  const observed = parseTime(route.routeAdmissionObservedAt, "route admission observedAt");
  const expires = parseTime(route.routeAdmissionExpiresAt, "route admission expiresAt");
  if (observed - now > policy.maximumFutureClockSkewSeconds * 1000) throw new Error("route admission is future-dated.");
  if (now - observed > policy.maximumRoutePlanAgeSeconds * 1000) throw new Error("route admission is stale.");
  if (expires <= now + policy.routeExpirySafetyMarginSeconds * 1000) throw new Error("route admission is expired or too close to expiry.");
  return { expectedRouteSha, routeBytesSha256, observed, expires };
}

function parseArguments(argv) {
  if (argv.length !== 4 && argv.length !== 6) {
    throw new Error("Usage: node scripts/compile-autonomous-work-exchange-lease-plan.mjs <ready-work-item.json> <work-exchange-snapshot.json> <route-plan.json> <worker-id> [--now <iso-8601>]");
  }
  const [workPath, snapshotPath, routePath, workerId, option, nowValue] = argv;
  if (argv.length === 6 && option !== "--now") throw new Error("Only --now is accepted as an optional argument.");
  return { workPath, snapshotPath, routePath, workerId, nowValue };
}

try {
  const input = parseArguments(process.argv.slice(2));
  if (!WORKER_ID.test(input.workerId)) throw new Error("worker id is invalid.");
  const policySource = readJsonBytes(path.join(ROOT, "config/autonomous-work-exchange-lease-planning-v1.json"), "lease policy", 1024 * 1024);
  const policy = policySource.document;
  if (policy.schemaVersion !== 1 || policy.kind !== "evavo-autonomous-work-exchange-lease-planning-policy-v1") {
    throw new Error("lease planning policy kind/schema is invalid.");
  }
  if (policy.nonAuthorities?.modelExecution !== true || policy.nonAuthorities?.publication !== true || policy.nonAuthorities?.paidFallback !== true) {
    throw new Error("lease planning policy non-authorities are incomplete.");
  }

  const workSource = readJsonBytes(input.workPath, "READY work item", 2 * 1024 * 1024);
  const snapshotSource = readJsonBytes(input.snapshotPath, "Work Exchange snapshot");
  const routeSource = readJsonBytes(input.routePath, "worker route plan", 8 * 1024 * 1024);
  const work = workSource.document;
  const snapshot = snapshotSource.document;
  const route = routeSource.document;
  const now = input.nowValue ? parseTime(input.nowValue, "--now") : Date.now();

  validateWork(work, policy);
  validateSnapshot(snapshot, work, now);
  const routeIdentity = validateRoute(route, routeSource.sha256, work, policy, now);

  const secondsUntilRouteExpiry = Math.floor((routeIdentity.expires - now) / 1000) - policy.routeExpirySafetyMarginSeconds;
  const ttlSeconds = Math.min(policy.maximumLeaseTtlSeconds, secondsUntilRouteExpiry);
  if (ttlSeconds < policy.minimumLeaseTtlSeconds) throw new Error("route admission cannot sustain the minimum lease lifetime.");
  const leasedAt = new Date(now).toISOString();
  const leaseExpiresAt = new Date(now + ttlSeconds * 1000).toISOString();
  const dispatchIntentIdentity = {
    schemaVersion: 1,
    kind: "evavo-autonomous-work-exchange-dispatch-intent-identity-v1",
    workItemId: work.id,
    workerId: input.workerId,
    workerClass: work.workerClass,
    repository: work.repository,
    sourceRevision: work.sourceRevision,
    routePlanSha256: routeIdentity.expectedRouteSha,
    routeAdmissionSha256: route.routeAdmissionSha256,
    expectedSnapshotSha256: snapshotSource.sha256,
    expectedGeneration: snapshot.generation,
    leasedAt,
    leaseExpiresAt,
  };
  const dispatchIntentSha256 = sha256(canonicalJson(dispatchIntentIdentity));

  const planBody = {
    schemaVersion: 2,
    kind: policy.outputPlanKind,
    eligible: true,
    decision: "LEASE_REQUIRED",
    action: policy.action,
    workItemId: work.id,
    repository: work.repository,
    sourceRevision: work.sourceRevision,
    workerId: input.workerId,
    workerClass: work.workerClass,
    capacityClass: work.capacityClass,
    routeId: route.routeId,
    runtime: route.runtime,
    modelPreference: route.modelPreference,
    routePlanSha256: routeIdentity.expectedRouteSha,
    routePlanBytesSha256: routeIdentity.routeBytesSha256,
    routeAdmissionSha256: route.routeAdmissionSha256,
    routeAdmissionObservedAt: route.routeAdmissionObservedAt,
    routeAdmissionExpiresAt: route.routeAdmissionExpiresAt,
    supervisedAcceptanceSha256: route.supervisedAcceptanceSha256,
    capabilityReceiptSha256: route.capabilityReceiptSha256,
    capacityObservationSha256: route.capacityObservationSha256,
    acceptanceVerificationSha256: route.acceptanceVerificationSha256,
    capacityStatusSha256: route.capacityStatusSha256,
    dispatchIntentSha256,
    expectedSnapshotSha256: snapshotSource.sha256,
    expectedGeneration: snapshot.generation,
    workItemBytesSha256: workSource.sha256,
    leasedAt,
    leaseExpiresAt,
    effectiveTtlSeconds: ttlSeconds,
    maximumItemsLeased: policy.maximumItemsLeased,
    oneWriterPerRepository: policy.oneWriterPerRepository,
    arguments: {
      workItemId: work.id,
      repository: work.repository,
      sourceRevision: work.sourceRevision,
      workerId: input.workerId,
      workerClass: work.workerClass,
      routePlanSha256: routeIdentity.expectedRouteSha,
      routeAdmissionSha256: route.routeAdmissionSha256,
      dispatchIntentSha256,
      expectedSnapshotSha256: snapshotSource.sha256,
      expectedGeneration: snapshot.generation,
      leasedAt,
      leaseExpiresAt,
      maximumItemsLeased: 1,
      oneWriterPerRepository: true
    },
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    deterministicValidationPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    paidFallbackUsed: false,
    truthBoundary: "This short-lived plan may lease one exact READY item only after Local Storage rechecks the same snapshot, generation, route admission and one-writer boundary under its canonical lock. It cannot start a model, validate, mutate Git, publish, deploy or use paid capacity."
  };
  process.stdout.write(`${JSON.stringify({ ...planBody, planSha256: sha256(canonicalJson(planBody)) }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 2,
    kind: "evavo-autonomous-work-exchange-lease-plan-v2",
    eligible: false,
    decision: "RETAIN_READY_JOB",
    errors: [String(error?.message ?? error).slice(0, 1200)],
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    deterministicValidationPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    paidFallbackUsed: false
  }, null, 2)}\n`);
  process.exitCode = 1;
}
