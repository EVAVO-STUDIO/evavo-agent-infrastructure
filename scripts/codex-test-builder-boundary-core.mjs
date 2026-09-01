#!/usr/bin/env node

import { createHash } from "node:crypto";

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const MAX_CHANGED_FILES = 1024;
const MAX_CHANGED_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CHANGED_BYTES = 64 * 1024 * 1024;
const STATE_KEYS = [
  "schemaVersion", "kind", "sourceRevision", "candidateHead", "candidateDirty",
  "changedPaths", "trackedPaths", "untrackedPaths", "stagedPaths", "unmergedPaths",
  "statusSha256", "statusByteLength", "trackedPathListSha256", "stagedPathListSha256",
  "untrackedListSha256", "unmergedListSha256", "trackedPatchSha256", "trackedPatchByteLength",
  "candidateFileManifest", "candidateFileManifestSha256", "untrackedFileManifestSha256",
  "changedFileBytes", "gitIndexSha256", "gitIndexByteLength",
];
const MANIFEST_KEYS = ["path", "origin", "state", "byteLength", "sha256", "executable"];

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(ordered(value));
}

export function sha256Bytes(value) {
  return createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"))
    .digest("hex");
}

function exactBytes(value, fallback, label) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value)
      : Buffer.from(canonicalJson(fallback), "utf8");
  if (bytes.length < 2 || bytes.length > MAX_EVIDENCE_BYTES) {
    throw new Error(`${label} is outside the bounded 8 MiB limit.`);
  }
  return { sha256: sha256Bytes(bytes), byteLength: bytes.length };
}

function object(value, label) {
  if (!OBJECT(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(object(value, label)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} fields differ from the exact contract.`);
  }
}

function sha(value, label, pattern = SHA256) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a bounded integer.`);
  }
  return value;
}

function time(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid.`);
  return { value: new Date(Date.parse(value)).toISOString(), milliseconds: Date.parse(value) };
}

function without(value, field) {
  const body = { ...value };
  delete body[field];
  return body;
}

function selfDigest(value, field, label) {
  const expected = sha(value[field], `${label} ${field}`);
  const observed = sha256Bytes(Buffer.from(canonicalJson(without(value, field)), "utf8"));
  if (observed !== expected) throw new Error(`${label} ${field} does not match its canonical body.`);
  return expected;
}

function safePath(value, label) {
  if (typeof value !== "string" || !value || value.length > 1024) throw new Error(`${label} is invalid.`);
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  if (
    normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
  ) throw new Error(`${label} is unsafe.`);
  return normalized;
}

function paths(value, label, { maximum = MAX_CHANGED_FILES, canonical = true } = {}) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} must be a bounded array.`);
  const normalized = value.map((entry) => safePath(entry, label));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} contains duplicate paths.`);
  const sorted = [...normalized].sort((left, right) => left.localeCompare(right));
  if (canonical && canonicalJson(normalized) !== canonicalJson(sorted)) throw new Error(`${label} is not canonical.`);
  return canonical ? normalized : sorted;
}

function strings(value, label, minimum = 0, maximum = 256) {
  if (
    !Array.isArray(value) || value.length < minimum || value.length > maximum ||
    value.some((entry) => typeof entry !== "string" || !entry || entry.length > 2048 || entry.includes("\0"))
  ) throw new Error(`${label} must be a bounded string array.`);
  return value;
}

function equal(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function verifyManifest(candidateState) {
  const changedPaths = paths(candidateState.changedPaths, "Candidate state changedPaths");
  const trackedPaths = paths(candidateState.trackedPaths, "Candidate state trackedPaths");
  const untrackedPaths = paths(candidateState.untrackedPaths, "Candidate state untrackedPaths");
  const stagedPaths = paths(candidateState.stagedPaths, "Candidate state stagedPaths");
  const unmergedPaths = paths(candidateState.unmergedPaths, "Candidate state unmergedPaths");
  if (stagedPaths.length || unmergedPaths.length) throw new Error("Candidate state contains staged/index or unmerged changes.");
  if (trackedPaths.some((entry) => untrackedPaths.includes(entry))) throw new Error("Candidate tracked and untracked path sets overlap.");
  const union = [...trackedPaths, ...untrackedPaths].sort((left, right) => left.localeCompare(right));
  if (!equal(changedPaths, union)) throw new Error("Candidate changedPaths differ from tracked/untracked path union.");
  if (candidateState.candidateDirty !== (changedPaths.length > 0)) throw new Error("Candidate dirty truth differs from changedPaths.");

  const manifest = candidateState.candidateFileManifest;
  if (!Array.isArray(manifest) || manifest.length > MAX_CHANGED_FILES) throw new Error("Candidate file manifest is not bounded.");
  const normalized = manifest.map((entry, index) => {
    exactKeys(entry, MANIFEST_KEYS, `Candidate manifest entry ${index}`);
    const itemPath = safePath(entry.path, "Candidate manifest path");
    if (!["tracked", "untracked"].includes(entry.origin) || !["present", "deleted"].includes(entry.state)) {
      throw new Error("Candidate manifest origin/state is invalid.");
    }
    if (typeof entry.executable !== "boolean") throw new Error("Candidate manifest executable truth is invalid.");
    const byteLength = integer(entry.byteLength, "Candidate manifest byte length", 0, MAX_CHANGED_FILE_BYTES);
    if (entry.state === "deleted") {
      if (entry.origin !== "tracked" || byteLength !== 0 || entry.sha256 !== null || entry.executable !== false) {
        throw new Error("Deleted candidate manifest entry is invalid.");
      }
    } else sha(entry.sha256, "Candidate manifest content SHA-256");
    return { ...entry, path: itemPath, byteLength };
  });
  const sorted = [...normalized].sort((left, right) => left.path.localeCompare(right.path) || left.origin.localeCompare(right.origin));
  if (canonicalJson(normalized) !== canonicalJson(sorted)) throw new Error("Candidate file manifest is not canonical.");
  if (new Set(normalized.map((entry) => entry.path)).size !== normalized.length) throw new Error("Candidate file manifest repeats a path.");
  if (!equal(normalized.map((entry) => entry.path).sort((a, b) => a.localeCompare(b)), changedPaths)) {
    throw new Error("Candidate file manifest paths differ from changedPaths.");
  }
  for (const entry of normalized) {
    if (entry.origin === "tracked" && !trackedPaths.includes(entry.path)) throw new Error("Candidate tracked manifest entry is not tracked.");
    if (entry.origin === "untracked" && !untrackedPaths.includes(entry.path)) throw new Error("Candidate untracked manifest entry is not untracked.");
  }
  const changedFileBytes = normalized.reduce((sum, entry) => sum + entry.byteLength, 0);
  if (changedFileBytes > MAX_CHANGED_BYTES || changedFileBytes !== candidateState.changedFileBytes) {
    throw new Error("Candidate changed-file byte count is invalid.");
  }
  if (sha256Bytes(Buffer.from(canonicalJson(normalized), "utf8")) !== candidateState.candidateFileManifestSha256) {
    throw new Error("Candidate file manifest digest is invalid.");
  }
  const untracked = normalized.filter((entry) => entry.origin === "untracked");
  if (sha256Bytes(Buffer.from(canonicalJson(untracked), "utf8")) !== candidateState.untrackedFileManifestSha256) {
    throw new Error("Candidate untracked file manifest digest is invalid.");
  }
  return { changedPaths, trackedPaths, untrackedPaths, changedFileBytes };
}

function verifyCandidateObservation(observation, work, dispatch, run) {
  object(observation, "Candidate observation");
  if (observation.schemaVersion !== 1 || observation.kind !== "evavo-codex-candidate-change-observation-v1") {
    throw new Error("Candidate observation kind/schema is invalid.");
  }
  for (const field of ["workItemId", "workerId", "repository", "sourceRevision"]) {
    const expected = field === "workItemId" ? work.id : field === "workerId" ? dispatch.workerId : work[field];
    if (observation[field] !== expected || run[field] !== expected || dispatch[field] !== expected) {
      throw new Error(`Candidate observation identity differs at ${field}.`);
    }
  }
  if (
    observation.snapshotStable !== true || observation.snapshotPasses !== 2 ||
    observation.gitObservationPerformed !== true || observation.candidateBytesMutatedByObserver !== false ||
    observation.gitIndexMutationAccepted !== false || observation.workerCommitAccepted !== false ||
    observation.deterministicValidationPerformed !== false || observation.publicationPerformed !== false
  ) throw new Error("Candidate observation authority or stability boundary is invalid.");
  if (observation.indexChanged !== false || observation.stagedPathCount !== 0 || observation.unmergedPathCount !== 0) {
    throw new Error("Candidate observation contains staged/index or unmerged state.");
  }

  exactKeys(observation.candidateState, STATE_KEYS, "Candidate state");
  const state = observation.candidateState;
  if (
    state.schemaVersion !== 1 || state.kind !== "evavo-codex-candidate-state-v1" ||
    state.sourceRevision !== work.sourceRevision || state.candidateHead !== work.sourceRevision ||
    observation.candidateHead !== work.sourceRevision || observation.candidateHeadChanged !== false
  ) throw new Error("Candidate state source/HEAD identity is invalid.");
  for (const field of [
    "statusSha256", "trackedPathListSha256", "stagedPathListSha256", "untrackedListSha256",
    "unmergedListSha256", "trackedPatchSha256", "candidateFileManifestSha256",
    "untrackedFileManifestSha256", "gitIndexSha256",
  ]) sha(state[field], `Candidate state ${field}`);
  integer(state.statusByteLength, "Candidate status byte length", 0, MAX_EVIDENCE_BYTES * 4);
  integer(state.trackedPatchByteLength, "Candidate patch byte length", 0, MAX_EVIDENCE_BYTES * 4);
  integer(state.gitIndexByteLength, "Candidate index byte length", 1, MAX_EVIDENCE_BYTES * 4);
  const manifest = verifyManifest(state);
  const stateSha256 = sha(observation.candidateStateSha256, "Candidate state SHA-256");
  if (sha256Bytes(Buffer.from(canonicalJson(state), "utf8")) !== stateSha256) throw new Error("Candidate state digest is invalid.");

  for (const [field, expected] of [
    ["candidateDirty", state.candidateDirty], ["trackedPatchSha256", state.trackedPatchSha256],
    ["candidateFileManifestSha256", state.candidateFileManifestSha256],
    ["untrackedFileManifestSha256", state.untrackedFileManifestSha256],
    ["changedFileBytes", state.changedFileBytes], ["gitIndexSha256", state.gitIndexSha256],
  ]) if (observation[field] !== expected) throw new Error(`Candidate observation differs from candidate state at ${field}.`);
  if (!equal(observation.changedPaths, state.changedPaths) || !equal(observation.trackedPaths, state.trackedPaths) ||
      !equal(observation.untrackedPaths, state.untrackedPaths) || !equal(observation.stagedPaths, state.stagedPaths) ||
      !equal(observation.unmergedPaths, state.unmergedPaths)) {
    throw new Error("Candidate observation path sets differ from candidate state.");
  }
  if (observation.changedPathCount !== manifest.changedPaths.length || observation.candidateDirty !== (manifest.changedPaths.length > 0)) {
    throw new Error("Candidate observation path counts or dirty truth are invalid.");
  }
  const observationSha256 = selfDigest(observation, "observationSha256", "Candidate observation");
  if (run.candidateHeadChanged !== false || run.candidateDirtyAfter !== state.candidateDirty) {
    throw new Error("Candidate state differs from the post-turn run receipt.");
  }
  const observedAt = time(observation.observedAt, "Candidate observation timestamp");
  const finishedAt = time(run.finishedAt, "Codex run finish timestamp");
  if (observedAt.milliseconds < finishedAt.milliseconds - 120_000 || observedAt.milliseconds > finishedAt.milliseconds + 600_000) {
    throw new Error("Candidate observation timestamp is outside the bounded post-turn window.");
  }
  return {
    observationSha256,
    candidateStateSha256: stateSha256,
    trackedPatchSha256: state.trackedPatchSha256,
    candidateFileManifestSha256: state.candidateFileManifestSha256,
    untrackedFileManifestSha256: state.untrackedFileManifestSha256,
    gitIndexSha256: state.gitIndexSha256,
    changedPaths: manifest.changedPaths,
    changedFileBytes: manifest.changedFileBytes,
    observedAt: observedAt.value,
  };
}

export function bindCodexTestBuilderCompletion({
  workItem, workItemBytes, routePlan, routePlanBytes, dispatchPlan, dispatchPlanBytes,
  runReceipt, runReceiptBytes, candidateObservation, candidateObservationBytes, baseCompletion,
}) {
  object(workItem, "Leased work item");
  object(routePlan, "Worker route plan");
  object(dispatchPlan, "Bound Codex dispatch plan");
  object(runReceipt, "Codex run receipt");
  object(baseCompletion, "Base Test Builder completion");
  const workEvidence = exactBytes(workItemBytes, workItem, "Leased work-item evidence");
  const routeEvidence = exactBytes(routePlanBytes, routePlan, "Route-plan evidence");
  const dispatchEvidence = exactBytes(dispatchPlanBytes, dispatchPlan, "Dispatch-plan evidence");
  const runEvidence = exactBytes(runReceiptBytes, runReceipt, "Run-receipt evidence");
  const observationEvidence = exactBytes(candidateObservationBytes, candidateObservation, "Candidate-observation evidence");

  if (
    workItem.lifecycleState !== "LEASED" || workItem.workerClass !== "test-generation" ||
    workItem.paidFallbackAllowed !== false || typeof workItem.id !== "string" ||
    typeof workItem.repository !== "string" || !SHA1.test(String(workItem.sourceRevision ?? ""))
  ) throw new Error("Leased Test Builder work-item identity/authority is invalid.");
  const allowedPaths = strings(workItem.allowedPaths, "Allowed paths", 1);
  const forbiddenPaths = strings(workItem.forbiddenPaths ?? [], "Forbidden paths");
  if (!Array.isArray(workItem.requiredValidation) || workItem.requiredValidation.length < 1 || workItem.requiredValidation.length > 128) {
    throw new Error("Deterministic-validation request is missing or unbounded.");
  }
  const allowedPathsSha256 = sha256Bytes(Buffer.from(canonicalJson(allowedPaths), "utf8"));
  const forbiddenPathsSha256 = sha256Bytes(Buffer.from(canonicalJson(forbiddenPaths), "utf8"));
  const requiredValidationSha256 = sha256Bytes(Buffer.from(canonicalJson(workItem.requiredValidation), "utf8"));

  if (routePlan.kind !== "evavo-worker-route-plan-v1" || routePlan.schemaVersion !== 1 || routePlan.eligible !== true) {
    throw new Error("Worker route plan is invalid.");
  }
  const routePlanSha256 = selfDigest(routePlan, "routePlanSha256", "Worker route plan");
  if (routePlan.repository !== workItem.repository || routePlan.sourceRevision !== workItem.sourceRevision ||
      routePlan.workerClass !== workItem.workerClass || routePlan.routeId !== "codex-spark-pro") {
    throw new Error("Worker route-plan identity differs from leased work.");
  }

  if (dispatchPlan.kind !== "evavo-codex-worker-dispatch-plan-v1" || dispatchPlan.schemaVersion !== 1 ||
      dispatchPlan.eligible !== true || dispatchPlan.dispatchBindingVersion !== 1) {
    throw new Error("Exact-bound Codex dispatch plan is required.");
  }
  const dispatchPlanSha256 = selfDigest(dispatchPlan, "dispatchPlanSha256", "Bound Codex dispatch plan");
  if (dispatchPlan.workItemId !== workItem.id || dispatchPlan.repository !== workItem.repository ||
      dispatchPlan.sourceRevision !== workItem.sourceRevision || dispatchPlan.workerClass !== workItem.workerClass) {
    throw new Error("Bound Codex dispatch identity differs from leased work.");
  }
  if (dispatchPlan.workItemBytesSha256 !== workEvidence.sha256 || dispatchPlan.routePlanSha256 !== routePlanSha256 ||
      dispatchPlan.routePlanBytesSha256 !== routeEvidence.sha256 || dispatchPlan.allowedPathsSha256 !== allowedPathsSha256 ||
      dispatchPlan.forbiddenPathsSha256 !== forbiddenPathsSha256 || dispatchPlan.requiredValidationSha256 !== requiredValidationSha256) {
    throw new Error("Bound Codex dispatch byte/path/validation identities differ from supplied evidence.");
  }
  if (dispatchPlan.validationAuthority !== false || dispatchPlan.publicationAuthority !== false || dispatchPlan.paidFallbackUsed !== false) {
    throw new Error("Bound Codex dispatch exceeds Test Builder authority.");
  }

  if (runReceipt.kind !== "evavo-codex-worker-run-v1" || runReceipt.schemaVersion !== 1 ||
      runReceipt.dispatchPlanSha256 !== dispatchPlanSha256 || runReceipt.dispatchPlanBytesSha256 !== dispatchEvidence.sha256 ||
      runReceipt.routePlanSha256 !== routePlanSha256 || runReceipt.workItemId !== workItem.id ||
      runReceipt.workerId !== dispatchPlan.workerId || runReceipt.repository !== workItem.repository ||
      runReceipt.sourceRevision !== workItem.sourceRevision || runReceipt.workerClass !== workItem.workerClass) {
    throw new Error("Codex run receipt does not prove execution of the exact bound dispatch plan.");
  }
  if (runReceipt.modelTurnCompleted !== true || runReceipt.structuredTurnCompleted !== true || Number(runReceipt.exitCode) !== 0 ||
      runReceipt.routeAdmissionVerifiedAtStart !== true || runReceipt.supervisedPhysicalAcceptanceVerifiedAtStart !== true ||
      runReceipt.deterministicValidationPerformed !== false || runReceipt.publicationPerformed !== false || runReceipt.paidFallbackUsed !== false) {
    throw new Error("Codex run receipt does not preserve the completed model-turn authority boundary.");
  }
  for (const field of ["routeAdmissionSha256", "supervisedAcceptanceSha256", "capabilityReceiptSha256"]) {
    if (routePlan[field] !== dispatchPlan[field] || dispatchPlan[field] !== runReceipt[field] || !SHA256.test(String(routePlan[field] ?? ""))) {
      throw new Error(`${field} continuity failed across routing, dispatch and execution.`);
    }
  }

  const candidate = verifyCandidateObservation(candidateObservation, workItem, dispatchPlan, runReceipt);
  if (baseCompletion.kind !== "evavo-codex-test-builder-completion-v1" || baseCompletion.schemaVersion !== 1) {
    throw new Error("Base Test Builder completion kind/schema is invalid.");
  }
  const baseCompletionSha256 = selfDigest(baseCompletion, "completionSha256", "Base Test Builder completion");
  if (baseCompletion.workItemId !== workItem.id || baseCompletion.workerId !== dispatchPlan.workerId ||
      baseCompletion.repository !== workItem.repository || baseCompletion.sourceRevision !== workItem.sourceRevision ||
      !equal(baseCompletion.changedPaths ?? [], candidate.changedPaths)) {
    throw new Error("Base Test Builder completion identity/path contract is invalid for exact binding.");
  }
  if (baseCompletion.deterministicValidationPerformed !== false || baseCompletion.publicationPerformed !== false ||
      baseCompletion.workerCommitPerformed !== false || baseCompletion.publicationAuthority !== false) {
    throw new Error("Base Test Builder completion exceeds pre-validation authority.");
  }

  const body = {
    ...without(baseCompletion, "completionSha256"),
    completionBindingVersion: 1,
    baseCompletionSha256,
    candidateContentContinuityProven: true,
    workItemBytesSha256: workEvidence.sha256,
    routePlanSha256,
    routePlanBytesSha256: routeEvidence.sha256,
    dispatchPlanSha256,
    dispatchPlanBytesSha256: dispatchEvidence.sha256,
    runReceiptBytesSha256: runEvidence.sha256,
    candidateObservationSha256: candidate.observationSha256,
    candidateObservationBytesSha256: observationEvidence.sha256,
    candidateObservationObservedAt: candidate.observedAt,
    candidateStateSha256: candidate.candidateStateSha256,
    trackedPatchSha256: candidate.trackedPatchSha256,
    candidateFileManifestSha256: candidate.candidateFileManifestSha256,
    untrackedFileManifestSha256: candidate.untrackedFileManifestSha256,
    candidateGitIndexSha256: candidate.gitIndexSha256,
    changedFileBytes: candidate.changedFileBytes,
    allowedPathsSha256,
    forbiddenPathsSha256,
    requiredValidationSha256,
    truthBoundary: "This exact-bound completion preserves the base Test Builder result while proving exact leased-work, route-plan, dispatch-plan, run-receipt and stable two-pass candidate-content continuity. READY_FOR_DETERMINISTIC_VALIDATION means only that a separate validator may re-observe the same candidateStateSha256 and run the bound requiredValidation envelope. It grants no validation result, commit, push, publication, deployment or paid-fallback authority.",
  };
  return { ...body, completionSha256: sha256Bytes(Buffer.from(canonicalJson(body), "utf8")) };
}
