#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [workItemPath, capacityPath] = process.argv.slice(2);
if (!workItemPath || !capacityPath || process.argv.slice(2).length !== 2) {
  console.error("Usage: node scripts/plan-worker-route.mjs <work-item.json> <capacity-status.json>");
  process.exit(2);
}

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA256 = /^[0-9a-f]{64}$/;
const DISPATCHABLE = new Set(["AVAILABLE", "DEGRADED"]);

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, ordered(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(ordered(value));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJsonBytes(file, label) {
  const resolved = fs.realpathSync.native(path.resolve(file));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  const bytes = fs.readFileSync(resolved);
  if (bytes.length < 2 || bytes.length > 8 * 1024 * 1024) throw new Error(`${label} is outside the bounded 8 MiB limit.`);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
  if (!OBJECT(document)) throw new Error(`${label} must contain a JSON object.`);
  return { bytes, document };
}

function isoMilliseconds(value) {
  if (typeof value !== "string" || !value) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const a = [...new Set(left.filter((value) => typeof value === "string"))].sort();
  const b = [...new Set(right.filter((value) => typeof value === "string"))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function digestFreeAdmission(admission) {
  const { routeAdmissionSha256: _ignored, ...body } = admission;
  return body;
}

function inspectSparkStatus({ statusRoot, status, route, workItem, policy, now }) {
  const errors = [];
  if (statusRoot.schemaVersion !== 1 || statusRoot.kind !== "evavo-worker-capacity-status-v1") {
    errors.push("capacity status kind/schema is not canonical");
  }
  if (status.routeId !== route.id) errors.push("capacity status route identity changed");
  if (status.runtime !== undefined && status.runtime !== route.runtime) errors.push("capacity status runtime differs from route policy");
  if (status.modelPreference !== route.modelPreference) errors.push("capacity status model differs from route policy");
  if (status.capacityClass !== route.capacityClass) errors.push("capacity status class differs from route policy");
  if (status.paidFallbackAllowed !== false) errors.push("capacity status does not forbid paid fallback");
  if (status.state !== status.rawCapacityState) errors.push("capacity status did not preserve the raw state exactly");
  if (!route.statusStates.includes(status.rawCapacityState)) errors.push("capacity status raw state is not admitted by route policy");

  const statusObservedAt = isoMilliseconds(statusRoot.observedAt);
  const statusExpiresAt = isoMilliseconds(statusRoot.expiresAt);
  if (statusObservedAt === null || statusExpiresAt === null) errors.push("capacity status timestamps are invalid");
  else {
    if (statusObservedAt - now > policy.maximumFutureClockSkewSeconds * 1000) errors.push("capacity status is future-dated");
    if (now - statusObservedAt > policy.maximumCapacityObservationAgeSeconds * 1000) errors.push("capacity status is stale");
    if (statusExpiresAt <= now) errors.push("capacity status is expired");
  }

  const admission = status.routeAdmission;
  if (!OBJECT(admission) || admission.schemaVersion !== 1 || admission.kind !== "evavo-codex-spark-route-admission-v1") {
    errors.push("route admission object is missing or invalid");
    return { eligible: false, reason: "NO_CURRENT_PHYSICAL_ROUTE_ADMISSION", errors };
  }
  if (!SHA256.test(String(admission.routeAdmissionSha256 ?? ""))) errors.push("route admission digest is invalid");
  else {
    const recomputed = sha256Bytes(Buffer.from(canonicalJson(digestFreeAdmission(admission)), "utf8"));
    if (recomputed !== admission.routeAdmissionSha256) errors.push("route admission digest does not match its canonical body");
  }
  if (status.routeAdmissionSha256 !== admission.routeAdmissionSha256) errors.push("capacity route and nested admission digests differ");
  if (admission.routeId !== route.id || admission.modelPreference !== route.modelPreference || admission.capacityClass !== route.capacityClass) {
    errors.push("route admission policy identity changed");
  }
  if (admission.rawCapacityState !== status.rawCapacityState) errors.push("route admission raw capacity state differs from status");
  if (admission.paidFallbackAllowed !== false) errors.push("route admission does not forbid paid fallback");
  if (admission.physicalAdmissionAccepted !== true) errors.push("supervised physical admission is not accepted");
  if (admission.workerClassAdmissionAccepted !== true) errors.push("worker-class admission is not accepted");
  if (admission.admitted !== true || admission.dispatchEligible !== true || status.dispatchEligible !== true) {
    errors.push("route admission is not dispatch eligible");
  }
  if (!sameStringSet(admission.admittedWorkerClasses, route.workerClasses) || !admission.admittedWorkerClasses.includes(workItem.workerClass)) {
    errors.push("route admission worker classes differ from route policy or requested work");
  }
  if (
    !Number.isInteger(admission.maximumConcurrency) ||
    admission.maximumConcurrency < 1 ||
    admission.maximumConcurrency > route.maximumAutomaticConcurrency ||
    status.maximumConcurrency !== admission.maximumConcurrency ||
    status.maximumAutomaticConcurrency !== admission.maximumConcurrency
  ) {
    errors.push("route admission concurrency exceeds or differs from route policy");
  }

  const admissionObservedAt = isoMilliseconds(admission.observedAt);
  const admissionExpiresAt = isoMilliseconds(admission.expiresAt);
  if (admissionObservedAt === null || admissionExpiresAt === null) errors.push("route admission timestamps are invalid");
  else {
    if (admissionObservedAt - now > policy.maximumFutureClockSkewSeconds * 1000) errors.push("route admission is future-dated");
    if (now - admissionObservedAt > policy.maximumRouteAdmissionAgeSeconds * 1000) errors.push("route admission is stale");
    if (admissionExpiresAt <= now) errors.push("route admission is expired");
    if (admissionExpiresAt - admissionObservedAt > policy.maximumRouteAdmissionAgeSeconds * 1000) errors.push("route admission lifetime exceeds policy");
    if (statusExpiresAt !== null && admissionExpiresAt > statusExpiresAt) errors.push("route admission outlives capacity status");
  }

  const evidence = admission.evidence;
  if (!OBJECT(evidence)) errors.push("route admission evidence map is missing");
  const identities = [
    ["capacityObservation", status.capacityObservationSha256],
    ["supervisedAcceptance", status.supervisedAcceptanceSha256],
    ["capabilityReceipt", status.capabilityReceiptSha256],
    ["acceptanceVerification", status.acceptanceVerificationSha256],
  ];
  for (const [name, routeDigest] of identities) {
    const item = evidence?.[name];
    if (!OBJECT(item) || !SHA256.test(String(item.sha256 ?? "")) || !Number.isInteger(item.byteLength) || item.byteLength < 2) {
      errors.push(`route admission ${name} evidence is invalid`);
    } else if (routeDigest !== item.sha256) {
      errors.push(`capacity route and admission ${name} digests differ`);
    }
  }

  const capacityDispatchable = DISPATCHABLE.has(status.rawCapacityState) && admission.capacityDispatchable === true;
  if (!capacityDispatchable) {
    return { eligible: false, reason: "NO_ZERO_COST_CAPACITY_ROUTE_AVAILABLE", errors };
  }
  if (errors.length > 0) {
    const classError = errors.some((entry) => entry.includes("worker class"));
    return { eligible: false, reason: classError ? "WORKER_CLASS_NOT_PHYSICALLY_ADMITTED" : "NO_CURRENT_PHYSICAL_ROUTE_ADMISSION", errors };
  }
  return {
    eligible: true,
    reason: null,
    errors: [],
    admission,
    maximumConcurrency: admission.maximumConcurrency,
  };
}

try {
  const routing = readJsonBytes("config/worker-capacity-routing-v1.json", "worker routing policy").document;
  const sparkPolicy = readJsonBytes("config/codex-spark-capacity-status-v1.json", "Spark capacity status policy").document;
  const workEvidence = readJsonBytes(workItemPath, "work item");
  const capacityEvidence = readJsonBytes(capacityPath, "capacity status");
  const workItem = workEvidence.document;
  const capacity = capacityEvidence.document;
  const errors = [];

  if (routing.schemaVersion !== 1 || routing.kind !== "evavo-worker-capacity-routing") errors.push("Worker routing policy identity is invalid.");
  if (sparkPolicy.schemaVersion !== 1 || sparkPolicy.kind !== "evavo-codex-spark-capacity-status-policy-v1") errors.push("Spark capacity policy identity is invalid.");
  if (workItem.lifecycleState !== "READY") errors.push("Work item must be READY before route planning.");
  if (typeof workItem.workerClass !== "string" || !workItem.workerClass) errors.push("Work item requires workerClass.");
  if (typeof workItem.capacityClass !== "string" || !workItem.capacityClass) errors.push("Work item requires capacityClass.");
  if (workItem.paidFallbackAllowed !== false) errors.push("Spare-capacity work must explicitly disable paid fallback.");
  if (typeof workItem.repository !== "string" || !workItem.repository) errors.push("Work item requires repository.");
  if (typeof workItem.sourceRevision !== "string" || !/^[0-9a-f]{40}$/.test(workItem.sourceRevision)) errors.push("Work item requires an exact lowercase source revision.");
  if (errors.length) {
    console.error(JSON.stringify({ kind: "evavo-worker-route-plan-v1", eligible: false, errors }, null, 2));
    process.exit(1);
  }

  const now = Date.now();
  const statusByRoute = new Map((Array.isArray(capacity.routes) ? capacity.routes : []).map((entry) => [entry?.routeId, entry]));
  const candidates = [];
  const matching = [];
  for (const route of routing.workerRoutes ?? []) {
    if (!route.workerClasses?.includes(workItem.workerClass) || route.capacityClass !== workItem.capacityClass || route.paidFallbackAllowed !== false) continue;
    const status = statusByRoute.get(route.id);
    if (!OBJECT(status)) {
      matching.push({ routeId: route.id, rawCapacityState: "UNKNOWN", reason: "CAPACITY_STATUS_MISSING", errors: [] });
      continue;
    }
    if (route.runtime === "codex") {
      const inspection = inspectSparkStatus({ statusRoot: capacity, status, route, workItem, policy: sparkPolicy, now });
      matching.push({ routeId: route.id, rawCapacityState: status.rawCapacityState ?? status.state ?? "UNKNOWN", reason: inspection.reason, errors: inspection.errors });
      if (inspection.eligible) candidates.push({ route, status, inspection });
      continue;
    }
    const state = status.rawCapacityState ?? status.state;
    const eligible = DISPATCHABLE.has(state) && status.paidFallbackAllowed !== true;
    matching.push({ routeId: route.id, rawCapacityState: state ?? "UNKNOWN", reason: eligible ? null : "NO_ZERO_COST_CAPACITY_ROUTE_AVAILABLE", errors: [] });
    if (eligible) candidates.push({ route, status, inspection: { maximumConcurrency: status.maximumConcurrency ?? route.maximumAutomaticConcurrency } });
  }

  if (candidates.length === 0) {
    const reasons = matching.map((entry) => entry.reason).filter(Boolean);
    const reason = reasons.includes("WORKER_CLASS_NOT_PHYSICALLY_ADMITTED")
      ? "WORKER_CLASS_NOT_PHYSICALLY_ADMITTED"
      : reasons.includes("NO_CURRENT_PHYSICAL_ROUTE_ADMISSION")
        ? "NO_CURRENT_PHYSICAL_ROUTE_ADMISSION"
        : "NO_ZERO_COST_CAPACITY_ROUTE_AVAILABLE";
    console.log(JSON.stringify({
      schemaVersion: 1,
      kind: "evavo-worker-route-plan-v1",
      eligible: false,
      decision: "RETAIN_READY_JOB",
      reason,
      workerClass: workItem.workerClass,
      repository: workItem.repository,
      sourceRevision: workItem.sourceRevision,
      matchingRoutes: matching,
      capacityStatusSha256: sha256Bytes(capacityEvidence.bytes),
      paidFallbackUsed: false,
      executionPerformed: false,
      validationPerformed: false,
      publicationPerformed: false,
      truthBoundary: "No route is selected when raw zero-cost capacity is unavailable or when the current supervised physical admission, worker-class admission, evidence digests or short-lived route-admission lifetime fail closed.",
    }, null, 2));
    process.exit(0);
  }

  const stateRank = { AVAILABLE: 0, DEGRADED: 1 };
  candidates.sort((left, right) =>
    (stateRank[left.status.rawCapacityState ?? left.status.state] ?? 9) - (stateRank[right.status.rawCapacityState ?? right.status.state] ?? 9) ||
    String(left.route.id).localeCompare(String(right.route.id)),
  );
  const selected = candidates[0];
  const admission = selected.inspection.admission;
  const planBody = {
    schemaVersion: 1,
    kind: "evavo-worker-route-plan-v1",
    eligible: true,
    decision: "DISPATCH_ELIGIBLE",
    workerClass: workItem.workerClass,
    repository: workItem.repository,
    sourceRevision: workItem.sourceRevision,
    routeId: selected.route.id,
    runtime: selected.route.runtime,
    modelPreference: selected.route.modelPreference,
    capacityClass: selected.route.capacityClass,
    capacityState: selected.status.rawCapacityState ?? selected.status.state,
    rawCapacityState: selected.status.rawCapacityState ?? selected.status.state,
    maximumConcurrency: selected.inspection.maximumConcurrency,
    maximumAutomaticConcurrency: selected.inspection.maximumConcurrency,
    capacityStatusSha256: sha256Bytes(capacityEvidence.bytes),
    routeAdmissionSha256: admission?.routeAdmissionSha256 ?? null,
    routeAdmissionObservedAt: admission?.observedAt ?? null,
    routeAdmissionExpiresAt: admission?.expiresAt ?? null,
    supervisedAcceptanceSha256: selected.status.supervisedAcceptanceSha256 ?? null,
    capabilityReceiptSha256: selected.status.capabilityReceiptSha256 ?? null,
    capacityObservationSha256: selected.status.capacityObservationSha256 ?? null,
    acceptanceVerificationSha256: selected.status.acceptanceVerificationSha256 ?? null,
    paidFallbackUsed: false,
    executionPerformed: false,
    validationPerformed: false,
    publicationPerformed: false,
    truthBoundary: "This short-lived plan selects one zero-paid-fallback route only after exact raw-capacity, supervised physical-acceptance, same-capability, worker-class and concurrency evidence agree. It performs no model turn, deterministic validation, Git mutation or publication.",
  };
  console.log(JSON.stringify({
    ...planBody,
    routePlanSha256: sha256Bytes(Buffer.from(canonicalJson(planBody), "utf8")),
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-worker-route-plan-v1",
    eligible: false,
    errors: [String(error?.message ?? error).slice(0, 1000)],
    paidFallbackUsed: false,
    executionPerformed: false,
    validationPerformed: false,
    publicationPerformed: false,
  }, null, 2));
  process.exit(1);
}
