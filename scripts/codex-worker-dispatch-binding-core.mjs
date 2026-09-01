#!/usr/bin/env node

import { createHash } from "node:crypto";

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

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
  return createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"))
    .digest("hex");
}

function requireObject(value, label) {
  if (!OBJECT(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}

function requireSha(value, label, expression = SHA256) {
  if (typeof value !== "string" || !expression.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function exactBytes(value, fallback, label) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value)
      : Buffer.from(canonicalJson(fallback), "utf8");
  if (bytes.length < 2 || bytes.length > MAX_EVIDENCE_BYTES) {
    throw new Error(`${label} is outside the bounded 8 MiB evidence limit.`);
  }
  return bytes;
}

function without(value, field) {
  const body = { ...value };
  delete body[field];
  return body;
}

function verifyCanonicalDigest(value, field, label) {
  const expected = requireSha(value[field], `${label} ${field}`);
  const observed = sha256Bytes(Buffer.from(canonicalJson(without(value, field)), "utf8"));
  if (observed !== expected) throw new Error(`${label} ${field} does not match its canonical body.`);
  return expected;
}

function boundedStringArray(value, label, minimum = 0, maximum = 256) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string" || !item || item.length > 2048 || item.includes("\0"))
  ) {
    throw new Error(`${label} must be a bounded non-empty string array.`);
  }
  return value;
}

export function bindCodexWorkerDispatch({
  workItem,
  workItemBytes,
  routePlan,
  routePlanBytes,
  legacyDispatchPlan,
}) {
  requireObject(workItem, "Leased work item");
  requireObject(routePlan, "Worker route plan");
  requireObject(legacyDispatchPlan, "Legacy Codex dispatch plan");
  const exactWorkBytes = exactBytes(workItemBytes, workItem, "Leased work-item evidence");
  const exactRouteBytes = exactBytes(routePlanBytes, routePlan, "Worker route-plan evidence");

  if (workItem.lifecycleState !== "LEASED" || workItem.workerClass !== "test-generation") {
    throw new Error("Bound Codex dispatch requires one leased Test Builder work item.");
  }
  if (workItem.paidFallbackAllowed !== false) throw new Error("Bound Codex dispatch requires paid fallback to remain false.");
  if (typeof workItem.id !== "string" || !workItem.id || typeof workItem.repository !== "string" || !workItem.repository) {
    throw new Error("Leased work-item identity is invalid.");
  }
  requireSha(workItem.sourceRevision, "Leased work-item source revision", SHA1);
  const allowedPaths = boundedStringArray(workItem.allowedPaths, "Leased work-item allowedPaths", 1);
  const forbiddenPaths = boundedStringArray(workItem.forbiddenPaths ?? [], "Leased work-item forbiddenPaths");
  if (!Array.isArray(workItem.requiredValidation) || workItem.requiredValidation.length < 1 || workItem.requiredValidation.length > 128) {
    throw new Error("Leased Test Builder work requires bounded deterministic-validation instructions.");
  }

  if (
    routePlan.schemaVersion !== 1 ||
    routePlan.kind !== "evavo-worker-route-plan-v1" ||
    routePlan.eligible !== true ||
    routePlan.decision !== "DISPATCH_ELIGIBLE"
  ) {
    throw new Error("Bound Codex dispatch requires an eligible v1 worker route plan.");
  }
  const routePlanSha256 = verifyCanonicalDigest(routePlan, "routePlanSha256", "Worker route plan");
  if (
    routePlan.workerClass !== workItem.workerClass ||
    routePlan.repository !== workItem.repository ||
    routePlan.sourceRevision !== workItem.sourceRevision ||
    routePlan.routeId !== "codex-spark-pro"
  ) {
    throw new Error("Worker route-plan identity differs from the leased Test Builder work item.");
  }
  if (
    routePlan.paidFallbackUsed !== false ||
    routePlan.executionPerformed !== false ||
    routePlan.validationPerformed !== false ||
    routePlan.publicationPerformed !== false
  ) {
    throw new Error("Worker route plan exceeds planning-only zero-paid-fallback authority.");
  }

  if (
    legacyDispatchPlan.schemaVersion !== 1 ||
    legacyDispatchPlan.kind !== "evavo-codex-worker-dispatch-plan-v1" ||
    legacyDispatchPlan.eligible !== true
  ) {
    throw new Error("Legacy Codex dispatch compiler did not return one eligible v1 plan.");
  }
  const legacyDispatchPlanSha256 = verifyCanonicalDigest(
    legacyDispatchPlan,
    "dispatchPlanSha256",
    "Legacy Codex dispatch plan",
  );
  if (
    legacyDispatchPlan.workItemId !== workItem.id ||
    legacyDispatchPlan.workerClass !== workItem.workerClass ||
    legacyDispatchPlan.repository !== workItem.repository ||
    legacyDispatchPlan.sourceRevision !== workItem.sourceRevision
  ) {
    throw new Error("Legacy Codex dispatch identity differs from the leased Test Builder work item.");
  }
  if (legacyDispatchPlan.routePlanSha256 !== routePlanSha256) {
    throw new Error("Legacy Codex dispatch canonical route-plan identity differs from the supplied route plan.");
  }
  if (legacyDispatchPlan.routePlanBytesSha256 !== sha256Bytes(exactRouteBytes)) {
    throw new Error("Legacy Codex dispatch route-plan byte identity differs from the supplied route plan.");
  }
  if (
    legacyDispatchPlan.publicationAuthority !== false ||
    legacyDispatchPlan.validationAuthority !== false ||
    legacyDispatchPlan.paidFallbackUsed !== false ||
    legacyDispatchPlan.modelTurnPerformed !== false ||
    legacyDispatchPlan.repositoryMutationPerformed !== false
  ) {
    throw new Error("Legacy Codex dispatch exceeds the bounded worker authority boundary.");
  }

  const body = {
    ...without(legacyDispatchPlan, "dispatchPlanSha256"),
    dispatchBindingVersion: 1,
    legacyDispatchPlanSha256,
    workItemBytesSha256: sha256Bytes(exactWorkBytes),
    allowedPathsSha256: sha256Bytes(Buffer.from(canonicalJson(allowedPaths), "utf8")),
    forbiddenPathsSha256: sha256Bytes(Buffer.from(canonicalJson(forbiddenPaths), "utf8")),
    requiredValidationSha256: sha256Bytes(Buffer.from(canonicalJson(workItem.requiredValidation), "utf8")),
    truthBoundary: "This bound plan preserves the legacy read-only compiler output while additionally binding the exact leased work-item bytes, canonical route-plan bytes, allowed/forbidden path envelopes and deterministic-validation request. The physical runner must verify this final dispatchPlanSha256 and exact plan bytes. It grants one bounded Test Builder model turn only, with no validation, commit, push, publication, deployment or paid-fallback authority.",
  };
  return {
    ...body,
    dispatchPlanSha256: sha256Bytes(Buffer.from(canonicalJson(body), "utf8")),
  };
}
