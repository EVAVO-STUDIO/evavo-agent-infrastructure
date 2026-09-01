#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { sha256Canonical } from "./codex-spark-capacity-status-core.mjs";

const [workItemInput, capacityStatusInput] = process.argv.slice(2);
if (!workItemInput || !capacityStatusInput) {
  console.error("Usage: node scripts/plan-codex-spark-admitted-route.mjs <ready-work-item.json> <capacity-status.json>");
  process.exit(2);
}

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^EVAVO-STUDIO\/[A-Za-z0-9._-]{1,100}$/;
const ROUTE_ID = "codex-spark-pro";
const MAX_STATUS_AGE_MS = 10 * 60 * 1000;
const FUTURE_SKEW_MS = 2 * 60 * 1000;

function regularFile(value, label) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return resolved;
}

function readJson(file, label) {
  const bytes = fs.readFileSync(file);
  if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) throw new Error(`${label} has an invalid byte length.`);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON: ${error?.message ?? error}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain a JSON object.`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`);
  return Date.parse(value);
}

function fail(errors, work, route = null) {
  console.log(
    JSON.stringify(
      {
        schemaVersion: 2,
        kind: "evavo-worker-route-plan-v2",
        eligible: false,
        decision: "RETAIN_READY_JOB",
        workItemId: typeof work?.id === "string" ? work.id : null,
        routeId: route?.routeId ?? ROUTE_ID,
        workerClass: typeof work?.workerClass === "string" ? work.workerClass : null,
        reasons: [...new Set(errors)],
        paidFallbackUsed: false,
        executionPerformed: false,
        repositoryMutationPerformed: false,
        publicationAuthority: false,
        truthBoundary:
          "This route planner retains the work item whenever raw capacity, short-lived admission identity, worker-class scope, concurrency or evidence binding is unavailable. It performs no model turn or repository effect.",
      },
      null,
      2,
    ),
  );
}

try {
  const work = readJson(regularFile(workItemInput, "READY work item"), "READY work item");
  const status = readJson(regularFile(capacityStatusInput, "Spark capacity status"), "Spark capacity status");
  const errors = [];

  if (work.lifecycleState !== "READY") errors.push("WORK_ITEM_NOT_READY");
  if (typeof work.id !== "string" || !work.id.trim()) errors.push("WORK_ITEM_ID_INVALID");
  if (typeof work.workerClass !== "string" || !work.workerClass.trim()) errors.push("WORKER_CLASS_INVALID");
  if (work.capacityClass !== "included-consumer") errors.push("CAPACITY_CLASS_NOT_INCLUDED_CONSUMER");
  if (work.paidFallbackAllowed !== false) errors.push("PAID_FALLBACK_NOT_DISABLED");
  if (!REPOSITORY.test(String(work.repository ?? ""))) errors.push("REPOSITORY_INVALID");
  if (!SHA1.test(String(work.sourceRevision ?? "").toLowerCase())) errors.push("SOURCE_REVISION_INVALID");

  if (status.schemaVersion !== 1 || status.kind !== "evavo-worker-capacity-status-v1") {
    throw new Error("Spark capacity status kind/schema is invalid.");
  }
  if (status.capacityAloneGrantsDispatch !== false || status.paidFallbackAllowed !== false || status.paidFallbackUsed !== false) {
    throw new Error("Spark capacity status exceeds the zero-paid-fallback truth boundary.");
  }
  const statusTime = timestamp(status.observedAt, "Capacity status observedAt");
  const now = Date.now();
  if (statusTime > now + FUTURE_SKEW_MS || now - statusTime > MAX_STATUS_AGE_MS) errors.push("CAPACITY_STATUS_STALE");

  const routes = Array.isArray(status.routes) ? status.routes : [];
  const matches = routes.filter((entry) => entry?.routeId === ROUTE_ID);
  if (matches.length !== 1) throw new Error("Capacity status must contain exactly one codex-spark-pro route.");
  const route = matches[0];
  if (route.capacityClass !== "included-consumer") errors.push("ROUTE_CAPACITY_CLASS_INVALID");
  if (route.paidFallbackAllowed !== false || route.paidFallbackUsed !== false) errors.push("ROUTE_PAID_FALLBACK_INVALID");
  if (route.dispatchEligible !== true || route.decision !== "DISPATCH_ELIGIBLE") errors.push("ROUTE_NOT_DISPATCH_ELIGIBLE");
  if (!["AVAILABLE", "DEGRADED"].includes(route.rawCapacityState)) errors.push("ROUTE_CAPACITY_NOT_DISPATCHABLE");
  if (route.transportReady !== true) errors.push("CODEX_TRANSPORT_NOT_READY");
  if (route.authenticationReady !== true) errors.push("CHATGPT_AUTH_NOT_READY");
  if (route.physicalAdmissionReady !== true) errors.push("PHYSICAL_ADMISSION_NOT_READY");

  const admissionExpires = timestamp(route.admissionExpiresAt, "Route admission expiry");
  if (admissionExpires <= now || admissionExpires > statusTime + MAX_STATUS_AGE_MS + FUTURE_SKEW_MS) {
    errors.push("ROUTE_ADMISSION_EXPIRED_OR_OVERSIZED");
  }
  if (!SHA256.test(String(route.admissionSha256 ?? ""))) errors.push("ROUTE_ADMISSION_SHA256_INVALID");
  if (!Array.isArray(route.workerClasses) || !route.workerClasses.includes(work.workerClass)) {
    errors.push("WORKER_CLASS_NOT_ADMITTED");
  }
  if (!Number.isInteger(route.maximumConcurrency) || route.maximumConcurrency !== 1) {
    errors.push("INITIAL_CONCURRENCY_MUST_REMAIN_ONE");
  }

  const sourceDigests = route.sourceDigests;
  if (!sourceDigests || typeof sourceDigests !== "object" || Array.isArray(sourceDigests)) {
    errors.push("ROUTE_SOURCE_DIGESTS_MISSING");
  } else {
    for (const field of [
      "capacityObservationSha256",
      "capabilityReceiptSha256",
      "authenticationReceiptSha256",
      "supervisedAcceptanceSha256",
    ]) {
      if (!SHA256.test(String(sourceDigests[field] ?? ""))) errors.push(`ROUTE_${field.toUpperCase()}_INVALID`);
    }
  }

  if (errors.length === 0) {
    const identity = {
      schemaVersion: 1,
      kind: "evavo-codex-spark-route-admission-identity-v1",
      routeId: ROUTE_ID,
      rawCapacityState: route.rawCapacityState,
      workerClasses: route.workerClasses,
      maximumConcurrency: route.maximumConcurrency,
      capacityClass: route.capacityClass,
      paidFallbackAllowed: false,
      sourceDigests,
      admittedAt: status.observedAt,
      expiresAt: route.admissionExpiresAt,
    };
    if (sha256Canonical(identity) !== route.admissionSha256) errors.push("ROUTE_ADMISSION_DIGEST_MISMATCH");
  }

  if (errors.length) {
    fail(errors, work, route);
    process.exit(0);
  }

  console.log(
    JSON.stringify(
      {
        schemaVersion: 2,
        kind: "evavo-worker-route-plan-v2",
        eligible: true,
        decision: "DISPATCH_ELIGIBLE",
        workItemId: work.id,
        repository: work.repository,
        sourceRevision: String(work.sourceRevision).toLowerCase(),
        workerClass: work.workerClass,
        routeId: ROUTE_ID,
        runtime: route.runtime,
        modelPreference: route.modelPreference,
        capacityClass: "included-consumer",
        capacityState: route.rawCapacityState,
        maximumConcurrency: 1,
        routeAdmissionSha256: route.admissionSha256,
        routeAdmissionExpiresAt: route.admissionExpiresAt,
        supervisedAcceptanceSha256: route.sourceDigests.supervisedAcceptanceSha256,
        capabilityReceiptSha256: route.sourceDigests.capabilityReceiptSha256,
        authenticationReceiptSha256: route.sourceDigests.authenticationReceiptSha256,
        capacityObservationSha256: route.sourceDigests.capacityObservationSha256,
        paidFallbackAllowed: false,
        paidFallbackUsed: false,
        executionPerformed: false,
        repositoryMutationPerformed: false,
        publicationAuthority: false,
        truthBoundary:
          "This plan binds one READY work item to one short-lived, digest-verified, supervised Spark admission. Runtime must rehash the same supervised acceptance, use the same fresh capability receipt, enforce workerClass and concurrency one, and reverify admission before starting Codex.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        schemaVersion: 2,
        kind: "evavo-worker-route-plan-error-v2",
        eligible: false,
        errorType: error?.constructor?.name ?? "Error",
        errorMessage: String(error?.message ?? error).slice(0, 4096),
        paidFallbackUsed: false,
        executionPerformed: false,
        repositoryMutationPerformed: false,
        publicationAuthority: false,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
