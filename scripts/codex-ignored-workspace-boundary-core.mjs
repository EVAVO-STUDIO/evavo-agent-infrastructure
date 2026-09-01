#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_IGNORED_PATHS = 4096;
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

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

function object(value, label) {
  if (!OBJECT(value)) throw new Error(`${label} must be a JSON object.`);
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
  return { bytes, sha256: sha256Bytes(bytes), byteLength: bytes.length };
}

function without(value, field) {
  const result = { ...value };
  delete result[field];
  return result;
}

function requireSha(value, label, expression = SHA256) {
  if (typeof value !== "string" || !expression.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function selfDigest(value, field, label) {
  const expected = requireSha(value[field], `${label} ${field}`);
  const observed = sha256Bytes(Buffer.from(canonicalJson(without(value, field)), "utf8"));
  if (observed !== expected) throw new Error(`${label} ${field} does not match its canonical body.`);
  return expected;
}

function normalizeRoot(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) throw new Error("Candidate working directory is invalid.");
  const requested = path.resolve(value);
  const requestedStat = fs.lstatSync(requested);
  if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) {
    throw new Error("Candidate working directory must be a real non-symlink directory.");
  }
  const resolved = fs.realpathSync.native(requested);
  const resolvedStat = fs.lstatSync(resolved);
  if (!resolvedStat.isDirectory() || resolvedStat.isSymbolicLink()) {
    throw new Error("Candidate working directory must resolve to a real non-symlink directory.");
  }
  return resolved;
}

function samePath(left, right) {
  const a = path.normalize(left);
  const b = path.normalize(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function gitEnvironment() {
  return {
    PATH: process.env.PATH ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    WINDIR: process.env.WINDIR ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    TMP: process.env.TMP ?? "",
    TEMP: process.env.TEMP ?? "",
    LC_ALL: "C",
    LANG: "C",
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

function runGit(root, args) {
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", [
    "--no-pager",
    "-c", "color.ui=false",
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    ...args,
  ], {
    cwd: root,
    env: gitEnvironment(),
    encoding: null,
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = Buffer.concat([
      Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
      Buffer.from("\n"),
      Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    ]).toString("utf8").trim().slice(0, 1500);
    throw new Error(`Ignored-workspace Git observation failed for ${args[0]}: ${detail}`);
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
}

function requiredText(buffer, label) {
  const value = buffer.toString("utf8").trim();
  if (!value) throw new Error(`${label} returned no value.`);
  return value;
}

function countNulPaths(buffer) {
  if (buffer.length === 0) return 0;
  const text = buffer.toString("utf8");
  const values = text.split("\0");
  if (values.at(-1) !== "") throw new Error("Ignored path observation is not a complete NUL-delimited envelope.");
  values.pop();
  if (values.length > MAX_IGNORED_PATHS) throw new Error("Ignored path observation exceeds the bounded path-count limit.");
  for (const value of values) {
    if (!value || value.includes("\0") || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error("Ignored path observation contains an invalid repository path.");
    }
  }
  return values.length;
}

function captureIgnoredState(root, sourceRevision) {
  const candidateRoot = normalizeRoot(root);
  const topLevel = fs.realpathSync.native(path.resolve(requiredText(runGit(candidateRoot, ["rev-parse", "--show-toplevel"]), "Candidate Git root")));
  if (!samePath(candidateRoot, topLevel)) throw new Error("Candidate working directory is not the exact Git root.");
  const headBefore = requiredText(runGit(candidateRoot, ["rev-parse", "HEAD^{commit}"]), "Candidate HEAD").toLowerCase();
  if (!SHA1.test(headBefore) || headBefore !== sourceRevision) throw new Error("Candidate HEAD differs from the admitted source revision.");
  const ignoredList = runGit(candidateRoot, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]);
  const ignoredPathCount = countNulPaths(ignoredList);
  const headAfter = requiredText(runGit(candidateRoot, ["rev-parse", "HEAD^{commit}"]), "Candidate HEAD").toLowerCase();
  if (headAfter !== headBefore) throw new Error("Candidate HEAD changed during ignored-workspace observation.");
  const state = {
    schemaVersion: 1,
    kind: "evavo-codex-ignored-workspace-state-v1",
    sourceRevision,
    candidateHead: headAfter,
    ignoredPathCount,
    ignoredPathListSha256: sha256Bytes(ignoredList),
    ignoredPathListByteLength: ignoredList.length,
    ignoredFilesPresent: ignoredPathCount > 0,
    ignoredFilesAccepted: false,
  };
  return {
    state,
    stateSha256: sha256Bytes(Buffer.from(canonicalJson(state), "utf8")),
  };
}

export function observeIgnoredWorkspace({ workingDirectory, sourceRevision, observedAt = new Date() }) {
  if (typeof sourceRevision !== "string" || !SHA1.test(sourceRevision)) throw new Error("Ignored-workspace observation requires an exact lowercase source revision.");
  const first = captureIgnoredState(workingDirectory, sourceRevision);
  const second = captureIgnoredState(workingDirectory, sourceRevision);
  if (first.stateSha256 !== second.stateSha256) throw new Error("Ignored workspace changed between the two observation passes.");
  const timestamp = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("Ignored-workspace observation timestamp is invalid.");
  const body = {
    schemaVersion: 1,
    kind: "evavo-codex-ignored-workspace-observation-v1",
    observedAt: timestamp.toISOString(),
    ignoredWorkspaceState: second.state,
    ignoredWorkspaceStateSha256: second.stateSha256,
    snapshotStable: true,
    snapshotPasses: 2,
    gitObservationPerformed: true,
    ignoredPathsReturned: false,
    physicalPathsReturned: false,
    fileContentsReturned: false,
    candidateBytesMutatedByObserver: false,
    repositoryMutationPerformed: false,
    deterministicValidationPerformed: false,
    publicationPerformed: false,
    truthBoundary: "This observation uses a two-pass NUL-safe Git ignored-file query at the exact candidate root and source revision. It returns only path count, byte length and digests; ignored path names and file contents are never returned. Any ignored file is outside the admitted autonomous Test Builder workspace boundary.",
  };
  return {
    ...body,
    observationSha256: sha256Bytes(Buffer.from(canonicalJson(body), "utf8")),
  };
}

export function requireZeroIgnoredWorkspace(input) {
  const observation = observeIgnoredWorkspace(input);
  const state = observation.ignoredWorkspaceState;
  if (state.ignoredPathCount !== 0 || state.ignoredFilesPresent !== false || state.ignoredPathListByteLength !== 0) {
    throw new Error(`Candidate contains ${state.ignoredPathCount} ignored path(s); ignored workspace content is not admitted.`);
  }
  return observation;
}

export function verifyZeroIgnoredObservation(observation, { sourceRevision } = {}) {
  object(observation, "Ignored-workspace observation");
  if (observation.schemaVersion !== 1 || observation.kind !== "evavo-codex-ignored-workspace-observation-v1") {
    throw new Error("Ignored-workspace observation kind/schema is invalid.");
  }
  if (observation.snapshotStable !== true || observation.snapshotPasses !== 2 || observation.gitObservationPerformed !== true) {
    throw new Error("Ignored-workspace observation stability boundary is invalid.");
  }
  if (
    observation.ignoredPathsReturned !== false || observation.physicalPathsReturned !== false ||
    observation.fileContentsReturned !== false || observation.candidateBytesMutatedByObserver !== false ||
    observation.repositoryMutationPerformed !== false || observation.deterministicValidationPerformed !== false ||
    observation.publicationPerformed !== false
  ) throw new Error("Ignored-workspace observation exceeds its read-only pathless authority.");
  const state = object(observation.ignoredWorkspaceState, "Ignored-workspace state");
  if (state.schemaVersion !== 1 || state.kind !== "evavo-codex-ignored-workspace-state-v1") {
    throw new Error("Ignored-workspace state kind/schema is invalid.");
  }
  if (sourceRevision !== undefined && (state.sourceRevision !== sourceRevision || state.candidateHead !== sourceRevision)) {
    throw new Error("Ignored-workspace state source/HEAD identity differs from the admitted source revision.");
  }
  if (!Number.isInteger(state.ignoredPathCount) || state.ignoredPathCount !== 0 || state.ignoredFilesPresent !== false || state.ignoredFilesAccepted !== false) {
    throw new Error("Ignored-workspace state is not the required zero-ignored-file state.");
  }
  if (state.ignoredPathListByteLength !== 0 || state.ignoredPathListSha256 !== sha256Bytes(Buffer.alloc(0))) {
    throw new Error("Ignored-workspace empty-list evidence is invalid.");
  }
  const stateSha256 = requireSha(observation.ignoredWorkspaceStateSha256, "Ignored-workspace state SHA-256");
  if (stateSha256 !== sha256Bytes(Buffer.from(canonicalJson(state), "utf8"))) {
    throw new Error("Ignored-workspace state digest does not match its canonical body.");
  }
  const observationSha256 = selfDigest(observation, "observationSha256", "Ignored-workspace observation");
  return { state, stateSha256, observationSha256 };
}

export function bindContainedDispatch({
  baseDispatchPlan,
  baseDispatchPlanBytes,
  ignoredObservation,
  ignoredObservationBytes,
}) {
  object(baseDispatchPlan, "Exact-bound Codex dispatch plan");
  if (
    baseDispatchPlan.schemaVersion !== 1 || baseDispatchPlan.kind !== "evavo-codex-worker-dispatch-plan-v1" ||
    baseDispatchPlan.eligible !== true || baseDispatchPlan.dispatchBindingVersion !== 1
  ) throw new Error("Contained dispatch requires one eligible exact-bound v1 Codex dispatch plan.");
  const baseDispatchPlanSha256 = selfDigest(baseDispatchPlan, "dispatchPlanSha256", "Exact-bound Codex dispatch plan");
  const baseEvidence = exactBytes(baseDispatchPlanBytes, baseDispatchPlan, "Exact-bound dispatch-plan evidence");
  const ignoredEvidence = exactBytes(ignoredObservationBytes, ignoredObservation, "Ignored-workspace observation evidence");
  const ignored = verifyZeroIgnoredObservation(ignoredObservation, { sourceRevision: baseDispatchPlan.sourceRevision });
  const body = {
    ...without(baseDispatchPlan, "dispatchPlanSha256"),
    containedDispatchBindingVersion: 1,
    baseDispatchPlanSha256,
    baseDispatchPlanBytesSha256: baseEvidence.sha256,
    ignoredWorkspaceBaselineObservationSha256: ignored.observationSha256,
    ignoredWorkspaceBaselineObservationBytesSha256: ignoredEvidence.sha256,
    ignoredWorkspaceBaselineStateSha256: ignored.stateSha256,
    ignoredWorkspaceBaselinePathListSha256: ignored.state.ignoredPathListSha256,
    ignoredWorkspaceBaselinePathCount: 0,
    ignoredWorkspaceFilesAccepted: false,
    truthBoundary: "This contained dispatch preserves the exact-bound Test Builder plan while additionally proving that the isolated candidate contains zero ignored files. The physical contained runner must re-observe the same zero-ignored state immediately before Codex and again after the model turn. It grants no validation, commit, push, publication, deployment or paid-fallback authority.",
  };
  return {
    ...body,
    dispatchPlanSha256: sha256Bytes(Buffer.from(canonicalJson(body), "utf8")),
  };
}

export function bindContainedRunReceipt({
  dispatchPlan,
  dispatchPlanBytes,
  baseRunReceipt,
  baseRunReceiptBytes,
  ignoredBefore,
  ignoredBeforeBytes,
  ignoredAfter,
  ignoredAfterBytes,
}) {
  object(dispatchPlan, "Contained Codex dispatch plan");
  object(baseRunReceipt, "Base Codex run receipt");
  if (dispatchPlan.containedDispatchBindingVersion !== 1) throw new Error("Contained run requires a contained dispatch plan.");
  const dispatchPlanSha256 = selfDigest(dispatchPlan, "dispatchPlanSha256", "Contained Codex dispatch plan");
  const dispatchEvidence = exactBytes(dispatchPlanBytes, dispatchPlan, "Contained dispatch-plan evidence");
  const baseEvidence = exactBytes(baseRunReceiptBytes, baseRunReceipt, "Base run-receipt evidence");
  const beforeEvidence = exactBytes(ignoredBeforeBytes, ignoredBefore, "Pre-turn ignored-workspace evidence");
  const afterEvidence = exactBytes(ignoredAfterBytes, ignoredAfter, "Post-turn ignored-workspace evidence");
  const before = verifyZeroIgnoredObservation(ignoredBefore, { sourceRevision: dispatchPlan.sourceRevision });
  const after = verifyZeroIgnoredObservation(ignoredAfter, { sourceRevision: dispatchPlan.sourceRevision });
  if (before.stateSha256 !== dispatchPlan.ignoredWorkspaceBaselineStateSha256) {
    throw new Error("Pre-turn ignored-workspace state differs from the dispatch-bound baseline.");
  }
  if (baseRunReceipt.kind !== "evavo-codex-worker-run-v1" || baseRunReceipt.schemaVersion !== 1) {
    throw new Error("Base Codex run receipt kind/schema is invalid.");
  }
  if (baseRunReceipt.dispatchPlanSha256 !== dispatchPlanSha256 || baseRunReceipt.dispatchPlanBytesSha256 !== dispatchEvidence.sha256) {
    throw new Error("Base Codex run receipt does not prove execution of the exact contained dispatch plan.");
  }
  const boundaryAccepted = before.stateSha256 === after.stateSha256;
  const protocolModelTurnCompleted = baseRunReceipt.modelTurnCompleted === true;
  const protocolStructuredTurnCompleted = baseRunReceipt.structuredTurnCompleted === true;
  const body = {
    ...baseRunReceipt,
    containedRunBindingVersion: 1,
    baseRunReceiptBytesSha256: baseEvidence.sha256,
    containedDispatchPlanSha256: dispatchPlanSha256,
    containedDispatchPlanBytesSha256: dispatchEvidence.sha256,
    ignoredWorkspaceBeforeObservationSha256: before.observationSha256,
    ignoredWorkspaceBeforeObservationBytesSha256: beforeEvidence.sha256,
    ignoredWorkspaceBeforeStateSha256: before.stateSha256,
    ignoredWorkspaceAfterObservationSha256: after.observationSha256,
    ignoredWorkspaceAfterObservationBytesSha256: afterEvidence.sha256,
    ignoredWorkspaceAfterStateSha256: after.stateSha256,
    ignoredWorkspacePathCountBefore: 0,
    ignoredWorkspacePathCountAfter: 0,
    ignoredWorkspaceBoundaryAccepted: boundaryAccepted,
    ignoredWorkspaceFilesAccepted: false,
    codexProtocolModelTurnCompleted: protocolModelTurnCompleted,
    codexProtocolStructuredTurnCompleted: protocolStructuredTurnCompleted,
    modelTurnCompleted: protocolModelTurnCompleted && boundaryAccepted,
    structuredTurnCompleted: protocolStructuredTurnCompleted && boundaryAccepted,
    truthBoundary: "This contained run receipt preserves the base Codex process truth while proving zero ignored files immediately before and after the model turn. modelTurnCompleted and structuredTurnCompleted are accepted only when both the Codex protocol and ignored-workspace boundary succeed. It is not deterministic validation, approval, commit, push or publication.",
  };
  return {
    ...body,
    runReceiptSha256: sha256Bytes(Buffer.from(canonicalJson(body), "utf8")),
  };
}

export function bindContainedCompletion({
  dispatchPlan,
  dispatchPlanBytes,
  runReceipt,
  runReceiptBytes,
  baseCompletion,
  baseCompletionBytes,
  ignoredBefore,
  ignoredBeforeBytes,
  ignoredAfter,
  ignoredAfterBytes,
}) {
  object(dispatchPlan, "Contained Codex dispatch plan");
  object(runReceipt, "Contained Codex run receipt");
  object(baseCompletion, "Exact-bound Test Builder completion");
  if (dispatchPlan.containedDispatchBindingVersion !== 1 || runReceipt.containedRunBindingVersion !== 1) {
    throw new Error("Contained completion requires contained dispatch and run receipts.");
  }
  const dispatchPlanSha256 = selfDigest(dispatchPlan, "dispatchPlanSha256", "Contained Codex dispatch plan");
  const runReceiptSha256 = selfDigest(runReceipt, "runReceiptSha256", "Contained Codex run receipt");
  const baseCompletionSha256 = selfDigest(baseCompletion, "completionSha256", "Exact-bound Test Builder completion");
  const dispatchEvidence = exactBytes(dispatchPlanBytes, dispatchPlan, "Contained dispatch-plan evidence");
  const runEvidence = exactBytes(runReceiptBytes, runReceipt, "Contained run-receipt evidence");
  const completionEvidence = exactBytes(baseCompletionBytes, baseCompletion, "Exact-bound completion evidence");
  const beforeEvidence = exactBytes(ignoredBeforeBytes, ignoredBefore, "Pre-completion ignored-workspace evidence");
  const afterEvidence = exactBytes(ignoredAfterBytes, ignoredAfter, "Post-completion ignored-workspace evidence");
  const before = verifyZeroIgnoredObservation(ignoredBefore, { sourceRevision: dispatchPlan.sourceRevision });
  const after = verifyZeroIgnoredObservation(ignoredAfter, { sourceRevision: dispatchPlan.sourceRevision });
  if (
    dispatchPlanSha256 !== runReceipt.dispatchPlanSha256 ||
    dispatchEvidence.sha256 !== runReceipt.dispatchPlanBytesSha256 ||
    runReceipt.ignoredWorkspaceBoundaryAccepted !== true ||
    runReceipt.modelTurnCompleted !== true || runReceipt.structuredTurnCompleted !== true
  ) throw new Error("Contained run receipt does not preserve the accepted dispatch and model-turn boundary.");
  for (const stateSha of [
    dispatchPlan.ignoredWorkspaceBaselineStateSha256,
    runReceipt.ignoredWorkspaceBeforeStateSha256,
    runReceipt.ignoredWorkspaceAfterStateSha256,
    before.stateSha256,
    after.stateSha256,
  ]) {
    if (stateSha !== dispatchPlan.ignoredWorkspaceBaselineStateSha256) {
      throw new Error("Ignored-workspace state continuity failed across dispatch, run and completion.");
    }
  }
  if (
    baseCompletion.kind !== "evavo-codex-test-builder-completion-v1" || baseCompletion.schemaVersion !== 1 ||
    baseCompletion.dispatchPlanSha256 !== dispatchPlanSha256 ||
    baseCompletion.runReceiptBytesSha256 !== runEvidence.sha256 ||
    baseCompletion.deterministicValidationPerformed !== false || baseCompletion.publicationPerformed !== false
  ) throw new Error("Exact-bound Test Builder completion is not compatible with the contained evidence chain.");
  const body = {
    ...without(baseCompletion, "completionSha256"),
    containedCompletionBindingVersion: 1,
    baseContainedCompletionSha256: baseCompletionSha256,
    baseContainedCompletionBytesSha256: completionEvidence.sha256,
    containedDispatchPlanSha256: dispatchPlanSha256,
    containedDispatchPlanBytesSha256: dispatchEvidence.sha256,
    containedRunReceiptSha256: runReceiptSha256,
    containedRunReceiptBytesSha256: runEvidence.sha256,
    ignoredWorkspaceBaselineStateSha256: dispatchPlan.ignoredWorkspaceBaselineStateSha256,
    ignoredWorkspacePreCompletionObservationSha256: before.observationSha256,
    ignoredWorkspacePreCompletionObservationBytesSha256: beforeEvidence.sha256,
    ignoredWorkspacePostCompletionObservationSha256: after.observationSha256,
    ignoredWorkspacePostCompletionObservationBytesSha256: afterEvidence.sha256,
    ignoredWorkspaceCompletionStateSha256: after.stateSha256,
    ignoredWorkspacePathCount: 0,
    ignoredWorkspaceBoundaryAccepted: true,
    ignoredWorkspaceFilesAccepted: false,
    truthBoundary: "This final contained Test Builder completion proves exact dispatch, process, candidate-content and zero-ignored-workspace continuity through completion. READY_FOR_DETERMINISTIC_VALIDATION still means only that a separate validator may re-observe the same candidate and run the bound validation envelope. No validation result, commit, push, publication, deployment or paid fallback is granted.",
  };
  return {
    ...body,
    completionSha256: sha256Bytes(Buffer.from(canonicalJson(body), "utf8")),
  };
}
