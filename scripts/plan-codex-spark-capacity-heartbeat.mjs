#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [queueStatusInput, effectiveCapacityInput, previousStateInput] = process.argv.slice(2);
if (!queueStatusInput || !effectiveCapacityInput) {
  console.error("Usage: node scripts/plan-codex-spark-capacity-heartbeat.mjs <work-exchange-status.json> <effective-capacity-status.json> [previous-probe-state.json]");
  process.exit(2);
}

const MAX_INPUT_BYTES = 1024 * 1024;
const FUTURE_TOLERANCE_MS = 120_000;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

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

const policyEvidence = readJson(path.join(ROOT, "config", "codex-spark-capacity-observation-policy-v1.json"), "capacity-observation policy");
const queueEvidence = readJson(queueStatusInput, "Work Exchange status");
const capacityEvidence = readJson(effectiveCapacityInput, "effective Spark capacity status");
const previousEvidence = previousStateInput ? readJson(previousStateInput, "previous capacity-probe state") : null;
const policy = policyEvidence.value;
const queue = queueEvidence.value;
const capacity = capacityEvidence.value;
const previous = previousEvidence?.value ?? null;
const errors = [];
const now = Date.now();

if (policy.schemaVersion !== 1 || policy.kind !== "evavo-codex-spark-capacity-observation-policy-v1") errors.push("Capacity-observation policy identity is invalid.");
if (policy.paidFallbackAllowed !== false) errors.push("Capacity-observation policy must forbid paid fallback.");
const queueKind = String(queue.kind ?? "");
if (queue.schemaVersion !== 1 || !["evavo-autonomous-work-exchange-status-v1", "evavo-work-exchange-status-v1"].includes(queueKind)) {
  errors.push("Work Exchange status kind/schema is invalid.");
}
const readyCount = Number.isInteger(queue.readyCount)
  ? queue.readyCount
  : Number.isInteger(queue.counts?.READY)
    ? queue.counts.READY
    : null;
if (readyCount === null || readyCount < 0) errors.push("Work Exchange status lacks a non-negative READY count.");
const queueObservedAt = Date.parse(queue.observedAt ?? queue.recordedAt ?? "");
if (!Number.isFinite(queueObservedAt) || now - queueObservedAt > 5 * 60_000 || queueObservedAt - now > FUTURE_TOLERANCE_MS) {
  errors.push("Work Exchange status is stale, future-dated or missing its timestamp.");
}

if (capacity.schemaVersion !== 1 || capacity.kind !== "evavo-worker-capacity-status-v1") errors.push("Effective-capacity status kind/schema is invalid.");
if (capacity.ok !== true) errors.push("Effective-capacity status contains contract errors.");
if (capacity.paidFallbackAllowed !== false || capacity.paidFallbackUsed !== false) errors.push("Effective-capacity status violates zero-paid-fallback policy.");
if (capacity.routeId !== policy.routeId) errors.push("Effective-capacity route differs from observation policy.");
const route = Array.isArray(capacity.routes) ? capacity.routes.find((entry) => entry?.routeId === policy.routeId) : null;
if (!route) errors.push("Effective-capacity status lacks the Spark route.");
else {
  if (route.modelPreference !== policy.modelPreference) errors.push("Effective-capacity model differs from observation policy.");
  if (route.capacityClass !== policy.capacityClass) errors.push("Effective-capacity class differs from observation policy.");
  if (route.paidFallbackAllowed !== false || route.paidFallbackUsed !== false) errors.push("Effective Spark route violates zero-paid-fallback policy.");
}

if (previous !== null) {
  if (previous.schemaVersion !== 1 || previous.kind !== "evavo-codex-spark-capacity-probe-state-v1") errors.push("Previous capacity-probe state kind/schema is invalid.");
  if (previous.routeId !== policy.routeId) errors.push("Previous capacity-probe state belongs to a different route.");
  if (previous.paidFallbackUsed === true) errors.push("Previous capacity-probe state reports paid fallback.");
}

if (errors.length) {
  console.error(JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-spark-capacity-probe-plan-v1",
    eligible: false,
    decision: "REJECT_INVALID_CAPACITY_HEARTBEAT_INPUT",
    errors,
    modelTurnPerformed: false,
    paidFallbackUsed: false,
  }, null, 2));
  process.exit(1);
}

const rawObservedAt = Date.parse(capacity.evidence?.rawCapacity?.observedAt ?? "");
const rawAgeSeconds = Number.isFinite(rawObservedAt) ? Math.max(0, Math.floor((now - rawObservedAt) / 1000)) : null;
const rawFresh = capacity.evidence?.rawCapacity?.fresh === true && rawAgeSeconds !== null && rawAgeSeconds <= policy.rawCapacityFreshSeconds;
const rawState = String(capacity.rawState ?? route.rawState ?? "UNKNOWN");
const effectiveState = String(capacity.effectiveState ?? route.state ?? "UNKNOWN");
const nonCapacityGates = {
  transport: capacity.evidence?.transport?.eligible === true && capacity.evidence?.transport?.fresh === true,
  authentication: capacity.evidence?.authentication?.accepted === true && capacity.evidence?.authentication?.fresh === true,
  physicalAdmission:
    capacity.evidence?.physicalAdmission?.accepted === true &&
    capacity.evidence?.physicalAdmission?.supervisedCleanupProven === true &&
    capacity.evidence?.physicalAdmission?.fresh === true,
  routeAdmission:
    capacity.evidence?.routeAdmission?.accepted === true && capacity.evidence?.routeAdmission?.fresh === true,
};
const allNonCapacityGatesFresh = Object.values(nonCapacityGates).every(Boolean);

let decision = "DEFER_NON_CAPACITY_GATE";
let reason = "NON_CAPACITY_GATE_NOT_FRESH";
let eligible = false;
let nextAllowedAt = null;

if (readyCount < policy.fixtureProbe.minimumReadyWorkCount) {
  decision = "NO_PROBE_NO_READY_WORK";
  reason = "READY_WORK_ABSENT";
} else if (capacity.eligible === true && route.eligible === true && ["AVAILABLE", "DEGRADED"].includes(effectiveState) && rawFresh) {
  decision = "NO_PROBE_CAPACITY_FRESH";
  reason = "EFFECTIVE_CAPACITY_ALREADY_FRESH";
} else if (["RATE_LIMITED", "EXHAUSTED", "AUTH_REQUIRED", "OFFLINE"].includes(rawState) && Number.isFinite(rawObservedAt)) {
  const delay = Number(policy.backoffSeconds?.[rawState] ?? 0);
  const allowedAtMs = rawObservedAt + delay * 1000;
  if (now < allowedAtMs) {
    decision = "DEFER_BACKOFF";
    reason = `RAW_CAPACITY_${rawState}`;
    nextAllowedAt = new Date(allowedAtMs).toISOString();
  } else if (allNonCapacityGatesFresh) {
    decision = "PROBE_ELIGIBLE";
    reason = "BACKOFF_ELAPSED_AND_READY_WORK_EXISTS";
    eligible = true;
  }
} else if (allNonCapacityGatesFresh && (!rawFresh || ["UNKNOWN", "OFFLINE"].includes(effectiveState))) {
  decision = "PROBE_ELIGIBLE";
  reason = "RAW_CAPACITY_STALE_OR_UNKNOWN_WITH_READY_WORK";
  eligible = true;
}

if (eligible && previous !== null) {
  const lastAttempt = Date.parse(previous.lastAttemptAt ?? previous.recordedAt ?? "");
  if (Number.isFinite(lastAttempt)) {
    const allowedAtMs = lastAttempt + policy.fixtureProbe.minimumIntervalSeconds * 1000;
    if (now < allowedAtMs) {
      eligible = false;
      decision = "DEFER_MINIMUM_INTERVAL";
      reason = "CAPACITY_HEARTBEAT_INTERVAL_NOT_ELAPSED";
      nextAllowedAt = new Date(allowedAtMs).toISOString();
    }
  }
  if (previous.inFlight === true) {
    eligible = false;
    decision = "DEFER_PROBE_IN_FLIGHT";
    reason = "CAPACITY_HEARTBEAT_ALREADY_RUNNING";
  }
}

const result = {
  schemaVersion: 1,
  kind: "evavo-codex-spark-capacity-probe-plan-v1",
  eligible,
  decision,
  reason,
  routeId: policy.routeId,
  modelPreference: policy.modelPreference,
  capacityClass: policy.capacityClass,
  rawState,
  effectiveState,
  rawCapacityFresh: rawFresh,
  rawCapacityAgeSeconds: rawAgeSeconds,
  readyCount,
  nonCapacityGates,
  allNonCapacityGatesFresh,
  maximumConcurrency: eligible ? 1 : 0,
  maximumModelTurns: eligible ? 1 : 0,
  fixtureOnly: true,
  nextAllowedAt,
  effectiveCapacityStatusSha256: capacityEvidence.sha256,
  workExchangeStatusSha256: queueEvidence.sha256,
  previousProbeStateSha256: previousEvidence?.sha256 ?? null,
  fixtureRequirements: {
    remoteCount: 0,
    workspaceMustRemainClean: true,
    headMustRemainUnchanged: true,
    repositoryMutationAuthority: false,
    commitAuthority: false,
    pushAuthority: false,
    publicationAuthority: false,
  },
  paidFallbackAllowed: false,
  paidFallbackUsed: false,
  modelTurnPerformed: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
  truthBoundary:
    "This plan cannot manufacture availability. It may request one disposable capacity heartbeat only when READY work exists, raw capacity is stale/unknown or backoff has elapsed, and transport, ChatGPT authentication, supervised physical acceptance and short-lived route admission are all independently fresh.",
};
console.log(JSON.stringify(result, null, 2));
