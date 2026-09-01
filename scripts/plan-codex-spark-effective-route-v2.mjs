#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [workItemInput, effectiveCapacityInput] = process.argv.slice(2);
if (!workItemInput || !effectiveCapacityInput) {
  console.error("Usage: node scripts/plan-codex-spark-effective-route-v2.mjs <ready-work-item.json> <effective-capacity-status.json>");
  process.exit(2);
}

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_STATUS_AGE_MS = 10 * 60_000;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isSha256 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

function readJson(input, label) {
  const resolved = fs.realpathSync.native(path.resolve(input));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  if (stat.size < 2 || stat.size > MAX_INPUT_BYTES) throw new Error(`${label} size is outside the bounded contract.`);
  const bytes = fs.readFileSync(resolved);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must contain UTF-8 JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain one JSON object.`);
  return { value, sha256: sha256(bytes) };
}

const workEvidence = readJson(workItemInput, "READY work item");
const capacityEvidence = readJson(effectiveCapacityInput, "effective Spark capacity status");
const work = workEvidence.value;
const capacity = capacityEvidence.value;
const errors = [];

if (work.lifecycleState !== "READY") errors.push("Work item must be READY before Spark route planning.");
if (typeof work.id !== "string" || !work.id) errors.push("Work item requires an identity.");
if (work.workerClass !== "test-generation") errors.push("Initial Spark route admission only permits test-generation.");
if (work.capacityClass !== "included-consumer") errors.push("Spark work must use included-consumer capacity.");
if (work.paidFallbackAllowed !== false) errors.push("Spark work must explicitly forbid paid fallback.");
if (typeof work.repository !== "string" || !/^EVAVO-STUDIO\/[A-Za-z0-9._-]+$/.test(work.repository)) errors.push("Work item repository is invalid.");
if (typeof work.sourceRevision !== "string" || !/^[0-9a-f]{40}$/.test(work.sourceRevision)) errors.push("Work item source revision is invalid.");

if (capacity.schemaVersion !== 1 || capacity.kind !== "evavo-worker-capacity-status-v1") {
  errors.push("Capacity input must be the canonical assembled effective-capacity status, not a raw probe or observation.");
}
if (capacity.ok !== true) errors.push("Effective-capacity status contains contract errors.");
if (capacity.paidFallbackAllowed !== false || capacity.paidFallbackUsed !== false) errors.push("Effective-capacity status does not preserve zero-paid-fallback policy.");
if (capacity.capacityInferredFromTransport !== false || capacity.capacityInferredFromAuthentication !== false || capacity.capacityInferredFromPhysicalAcceptance !== false) {
  errors.push("Effective-capacity status improperly infers quota from a non-capacity layer.");
}
const observedAt = Date.parse(capacity.observedAt ?? "");
const statusFresh = Number.isFinite(observedAt) && Date.now() - observedAt <= MAX_STATUS_AGE_MS && observedAt - Date.now() <= 120_000;
const routes = Array.isArray(capacity.routes) ? capacity.routes : [];
const spark = routes.find((entry) => entry?.routeId === "codex-spark-pro") ?? null;
if (!spark) errors.push("Effective-capacity status lacks the Spark route.");
else {
  if (spark.modelPreference !== "gpt-5.3-codex-spark") errors.push("Effective Spark route model is invalid.");
  if (spark.capacityClass !== "included-consumer") errors.push("Effective Spark route capacity class is invalid.");
  if (spark.paidFallbackAllowed !== false || spark.paidFallbackUsed !== false) errors.push("Effective Spark route permits or reports paid fallback.");
  for (const field of [
    "supervisedAcceptanceSha256",
    "codexCapabilityReceiptSha256",
    "physicalAcceptanceVerificationSha256",
    "routeAdmissionSha256",
    "rawCapacityObservationSha256",
  ]) {
    if (!isSha256(spark[field])) errors.push(`Effective Spark route lacks ${field}.`);
  }

  const routeClasses = Array.isArray(spark.admittedWorkerClasses) ? spark.admittedWorkerClasses : [];
  const unadmitted = routeClasses.filter((entry) => entry !== "test-generation");
  if (unadmitted.length) errors.push(`Effective Spark route contains unapproved worker classes: ${unadmitted.join(", ")}.`);
  const activeState = ["AVAILABLE", "DEGRADED"].includes(capacity.effectiveState) && ["AVAILABLE", "DEGRADED"].includes(spark.state);
  const activeAdmission = capacity.eligible === true || spark.eligible === true || activeState;
  if (activeAdmission) {
    if (capacity.eligible !== true || spark.eligible !== true || !activeState) errors.push("Available Spark evidence disagrees on effective eligibility/state.");
    if (!routeClasses.includes("test-generation")) errors.push("Available Spark route does not admit Test Builder.");
    if (spark.maximumConcurrency !== 1 || spark.maximumAutomaticConcurrency !== 1) errors.push("Available Spark route must remain at concurrency one.");
  } else {
    if (spark.maximumConcurrency !== 0 || spark.maximumAutomaticConcurrency !== 0) errors.push("Non-eligible Spark route must expose zero executable concurrency.");
    if (routeClasses.length !== 0) errors.push("Non-eligible Spark route must expose no executable worker classes.");
  }
}

if (errors.length) {
  console.error(JSON.stringify({
    schemaVersion: 2,
    kind: "evavo-worker-route-plan-v1",
    eligible: false,
    decision: "REJECT_INVALID_EFFECTIVE_CAPACITY",
    errors,
    paidFallbackUsed: false,
    executionPerformed: false,
  }, null, 2));
  process.exit(1);
}

const effectiveAvailable =
  statusFresh &&
  capacity.eligible === true &&
  spark.eligible === true &&
  ["AVAILABLE", "DEGRADED"].includes(capacity.effectiveState) &&
  ["AVAILABLE", "DEGRADED"].includes(spark.state);

if (!effectiveAvailable) {
  console.log(JSON.stringify({
    schemaVersion: 2,
    kind: "evavo-worker-route-plan-v1",
    eligible: false,
    decision: "RETAIN_READY_JOB",
    reason: statusFresh ? `SPARK_EFFECTIVE_STATE_${String(capacity.effectiveState ?? spark.state ?? "UNKNOWN")}` : "SPARK_EFFECTIVE_CAPACITY_STATUS_STALE",
    routeId: "codex-spark-pro",
    effectiveState: statusFresh ? capacity.effectiveState : "UNKNOWN",
    rawState: capacity.rawState ?? spark.rawState ?? "UNKNOWN",
    effectiveCapacityStatusSha256: capacityEvidence.sha256,
    paidFallbackUsed: false,
    executionPerformed: false,
    truthBoundary: "A non-available or stale effective-capacity receipt retains the READY job. No model turn or paid fallback is attempted.",
  }, null, 2));
  process.exit(0);
}

console.log(JSON.stringify({
  schemaVersion: 2,
  kind: "evavo-worker-route-plan-v1",
  eligible: true,
  decision: "DISPATCH_ELIGIBLE",
  routeId: "codex-spark-pro",
  runtime: "codex",
  modelPreference: spark.modelPreference,
  capacityClass: spark.capacityClass,
  capacityState: spark.state,
  rawCapacityState: spark.rawState,
  workerClass: work.workerClass,
  admittedWorkerClasses: ["test-generation"],
  maximumConcurrency: 1,
  maximumAutomaticConcurrency: 1,
  supervisedAcceptanceSha256: spark.supervisedAcceptanceSha256,
  codexCapabilityReceiptSha256: spark.codexCapabilityReceiptSha256,
  physicalAcceptanceVerificationSha256: spark.physicalAcceptanceVerificationSha256,
  routeAdmissionSha256: spark.routeAdmissionSha256,
  rawCapacityObservationSha256: spark.rawCapacityObservationSha256,
  effectiveCapacityStatusSha256: capacityEvidence.sha256,
  workItemSha256: workEvidence.sha256,
  paidFallbackAllowed: false,
  paidFallbackUsed: false,
  executionPerformed: false,
  truthBoundary:
    "This route plan is admitted only from a fresh assembled effective-capacity status that independently preserves raw quota, transport, authentication, physical acceptance and short-lived admission. It starts no model turn and grants no validation or publication authority.",
}, null, 2));
