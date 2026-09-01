#!/usr/bin/env node

import { createHash } from "node:crypto";

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA256 = /^[0-9a-f]{64}$/;
const RESULT_STATES = new Set(["SUCCESS", "NO_ACTION", "BLOCKED", "NEEDS_DEEP_WORKER", "NEEDS_HUMAN"]);
const SUMMARY_KEYS = ["resultState", "changedPaths", "assertionsAdded", "assumptions", "followUp"];
const VALIDATION_CLAIM = /\b(?:tests?|validation|checks?|build|lint|typecheck)\s+(?:all\s+)?(?:passed|succeeded|green|successful)\b/i;

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
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

function exactBytes(value, fallback) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(canonicalJson(fallback), "utf8");
}

function evidence(value, fallback) {
  const bytes = exactBytes(value, fallback);
  if (bytes.length < 2 || bytes.length > 8 * 1024 * 1024) throw new Error("Completion evidence is outside the bounded 8 MiB limit.");
  return { sha256: sha256Bytes(bytes), byteLength: bytes.length };
}

function requireObject(value, label) {
  if (!OBJECT(value)) throw new Error(`${label} must be a JSON object.`);
  return value;
}

function requireSha(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} must be an exact lowercase SHA-256 digest.`);
  return value;
}

function requireIso(value, label) {
  if (typeof value !== "string" || !value) throw new Error(`${label} is missing.`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return { value: new Date(milliseconds).toISOString(), milliseconds };
}

function safePath(value, label = "Worker changedPaths") {
  if (typeof value !== "string" || !value || value.length > 1024) throw new Error(`${label} contains an invalid path.`);
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "" || part === "." || part === ".." || part === ".git")
  ) {
    throw new Error(`${label} contains an unsafe repository path: ${value}`);
  }
  return normalized;
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globRegex(pattern) {
  const normalized = safePath(pattern, "Work-item path pattern");
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else {
      source += escapeRegex(character);
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(pathValue, patterns) {
  return patterns.some((pattern) => globRegex(pattern).test(pathValue));
}

function stringArray(value, label, maximumItems = 256) {
  if (!Array.isArray(value) || value.length > maximumItems || value.some((item) => typeof item !== "string" || item.length > 2048)) {
    throw new Error(`${label} must be a bounded string array.`);
  }
  return value;
}

function normalizedPathArray(value, label, maximumItems = 1024) {
  const raw = stringArray(value, label, maximumItems);
  const normalized = raw.map((item) => safePath(item, label));
  const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== normalized.length) throw new Error(`${label} contains duplicate normalized paths.`);
  return unique;
}

function exactArrayEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function routeEvidence(routePlan, field) {
  return routePlan[field] ?? routePlan.routeAdmission?.[field] ?? null;
}

function assertSummary(summary) {
  requireObject(summary, "Codex worker summary");
  const keys = Object.keys(summary).sort();
  const expected = [...SUMMARY_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("Codex worker summary fields differ from the exact Test Builder contract.");
  }
  if (!RESULT_STATES.has(summary.resultState)) throw new Error("Codex worker summary resultState is invalid.");
  for (const field of ["changedPaths", "assertionsAdded", "assumptions", "followUp"]) stringArray(summary[field], `Codex worker summary ${field}`);
  const claims = [...summary.assertionsAdded, ...summary.assumptions, ...summary.followUp];
  if (claims.some((value) => VALIDATION_CLAIM.test(value))) {
    throw new Error("Codex worker summary claimed deterministic validation that the model session did not own.");
  }
}

function assertCandidateObservation(candidateObservation, workItem, dispatchPlan, runReceipt) {
  requireObject(candidateObservation, "Independent candidate observation");
  if (candidateObservation.kind !== "evavo-codex-candidate-change-observation-v1" || candidateObservation.schemaVersion !== 1) {
    throw new Error("Independent candidate observation kind/schema is invalid.");
  }
  for (const field of ["workItemId", "workerId", "repository", "sourceRevision"]) {
    const expected = field === "workItemId"
      ? workItem.id
      : field === "workerId"
        ? runReceipt.workerId
        : workItem[field];
    if (candidateObservation[field] !== expected || candidateObservation[field] !== dispatchPlan[field] || candidateObservation[field] !== runReceipt[field]) {
      throw new Error(`Independent candidate observation identity differs from routing/execution: ${field}.`);
    }
  }
  if (candidateObservation.candidateHead !== workItem.sourceRevision || candidateObservation.candidateHeadChanged !== false) {
    throw new Error("Independent candidate observation does not prove unchanged candidate HEAD.");
  }
  if (candidateObservation.gitObservationPerformed !== true || candidateObservation.candidateBytesMutatedByObserver !== false) {
    throw new Error("Independent candidate observation did not preserve its read-only Git boundary.");
  }
  if (candidateObservation.gitIndexMutationAccepted !== false || candidateObservation.workerCommitAccepted !== false) {
    throw new Error("Independent candidate observation exceeds the Test Builder Git boundary.");
  }
  if (candidateObservation.deterministicValidationPerformed !== false || candidateObservation.publicationPerformed !== false) {
    throw new Error("Independent candidate observation exceeds the pre-validation authority boundary.");
  }
  if (typeof candidateObservation.candidateDirty !== "boolean") throw new Error("Independent candidate observation omitted candidateDirty truth.");

  const changedPaths = normalizedPathArray(candidateObservation.changedPaths, "Observed candidate changedPaths");
  const trackedPaths = normalizedPathArray(candidateObservation.trackedPaths, "Observed trackedPaths");
  const untrackedPaths = normalizedPathArray(candidateObservation.untrackedPaths, "Observed untrackedPaths");
  const stagedPaths = normalizedPathArray(candidateObservation.stagedPaths, "Observed stagedPaths");
  const unmergedPaths = normalizedPathArray(candidateObservation.unmergedPaths, "Observed unmergedPaths");
  if (candidateObservation.changedPathCount !== changedPaths.length) throw new Error("Observed changedPathCount differs from the exact observed path set.");
  if (candidateObservation.stagedPathCount !== stagedPaths.length) throw new Error("Observed stagedPathCount differs from the exact staged path set.");
  if (candidateObservation.unmergedPathCount !== unmergedPaths.length) throw new Error("Observed unmergedPathCount differs from the exact unmerged path set.");
  if (candidateObservation.indexChanged !== (stagedPaths.length > 0)) throw new Error("Observed indexChanged truth differs from staged paths.");
  if (stagedPaths.length > 0 || candidateObservation.indexChanged !== false) {
    throw new Error("Test Builder candidate contains worker-authored staged/index changes.");
  }
  if (unmergedPaths.length > 0) throw new Error("Test Builder candidate contains unmerged Git state.");
  const expectedChanged = [...new Set([...trackedPaths, ...untrackedPaths])].sort((left, right) => left.localeCompare(right));
  if (!exactArrayEqual(changedPaths, expectedChanged)) {
    throw new Error("Observed changedPaths differ from the exact tracked and untracked candidate path union.");
  }
  if (candidateObservation.candidateDirty !== (changedPaths.length > 0)) {
    throw new Error("Observed candidateDirty truth differs from the exact changed path set.");
  }
  for (const digestField of ["statusSha256", "trackedDiffSha256", "stagedDiffSha256", "untrackedListSha256", "unmergedListSha256"]) {
    requireSha(candidateObservation[digestField], `Independent candidate observation ${digestField}`);
  }
  const observationSha256 = requireSha(candidateObservation.observationSha256, "Independent candidate observation SHA-256");
  const { observationSha256: _digest, ...observationBody } = candidateObservation;
  if (observationSha256 !== sha256Bytes(Buffer.from(canonicalJson(observationBody), "utf8"))) {
    throw new Error("Independent candidate observation digest does not match its canonical body.");
  }
  return {
    changedPaths,
    trackedPaths,
    untrackedPaths,
    stagedPaths,
    unmergedPaths,
    candidateDirty: candidateObservation.candidateDirty,
    observedAt: requireIso(candidateObservation.observedAt, "Independent candidate observation timestamp"),
    observationSha256,
  };
}

export function compileCodexTestBuilderCompletion({
  workItem,
  workItemBytes,
  routePlan,
  routePlanBytes,
  dispatchPlan,
  dispatchPlanBytes,
  runReceipt,
  runReceiptBytes,
  candidateObservation,
  candidateObservationBytes,
}) {
  requireObject(workItem, "Leased work item");
  requireObject(routePlan, "Worker route plan");
  requireObject(dispatchPlan, "Codex dispatch plan");
  requireObject(runReceipt, "Codex run receipt");
  requireObject(candidateObservation, "Independent candidate observation");

  if (workItem.lifecycleState !== "LEASED") throw new Error("Test Builder completion requires a leased work item.");
  if (workItem.workerClass !== "test-generation") throw new Error("Test Builder completion only admits the test-generation worker class.");
  if (workItem.paidFallbackAllowed !== false) throw new Error("Test Builder work must explicitly forbid paid fallback.");
  if (typeof workItem.id !== "string" || !workItem.id) throw new Error("Leased work item id is invalid.");
  if (typeof workItem.repository !== "string" || !workItem.repository) throw new Error("Leased work item repository is invalid.");
  if (typeof workItem.sourceRevision !== "string" || !/^[0-9a-f]{40}$/.test(workItem.sourceRevision)) {
    throw new Error("Leased work item sourceRevision is invalid.");
  }
  const allowedPatterns = stringArray(workItem.allowedPaths, "Leased work item allowedPaths");
  if (allowedPatterns.length === 0) throw new Error("Leased Test Builder work requires at least one allowed path.");
  const forbiddenPatterns = stringArray(workItem.forbiddenPaths ?? [], "Leased work item forbiddenPaths");
  const requiredValidation = workItem.requiredValidation;
  if (!Array.isArray(requiredValidation) || requiredValidation.length === 0 || requiredValidation.length > 128) {
    throw new Error("Leased Test Builder work requires bounded external deterministic validation.");
  }

  if (routePlan.kind !== "evavo-worker-route-plan-v1" || routePlan.eligible !== true || routePlan.decision !== "DISPATCH_ELIGIBLE") {
    throw new Error("Worker route plan is not dispatch eligible.");
  }
  if (routePlan.routeId !== "codex-spark-pro") throw new Error("Worker route plan is not the admitted Spark route.");
  if (routePlan.workerClass !== undefined && routePlan.workerClass !== workItem.workerClass) {
    throw new Error("Worker route plan class differs from the leased work item.");
  }
  if (routePlan.paidFallbackUsed !== false) throw new Error("Worker route plan did not preserve zero-paid-fallback truth.");

  if (dispatchPlan.kind !== "evavo-codex-worker-dispatch-plan-v1" || dispatchPlan.eligible !== true) {
    throw new Error("Codex dispatch plan is not eligible.");
  }
  if (dispatchPlan.workItemId !== workItem.id || dispatchPlan.repository !== workItem.repository || dispatchPlan.sourceRevision !== workItem.sourceRevision) {
    throw new Error("Codex dispatch identity differs from the leased work item.");
  }
  if (dispatchPlan.workerClass !== undefined && dispatchPlan.workerClass !== workItem.workerClass) {
    throw new Error("Codex dispatch worker class differs from the leased work item.");
  }
  if (dispatchPlan.publicationAuthority !== false || dispatchPlan.validationAuthority !== false || dispatchPlan.paidFallbackUsed !== false) {
    throw new Error("Codex dispatch plan exceeds Test Builder authority.");
  }
  if (dispatchPlan.maximumConcurrency !== undefined && dispatchPlan.maximumConcurrency !== 1) {
    throw new Error("Codex dispatch plan exceeds the admitted Spark concurrency.");
  }

  if (runReceipt.kind !== "evavo-codex-worker-run-v1") throw new Error("Codex run receipt kind is invalid.");
  if (runReceipt.workItemId !== workItem.id || runReceipt.repository !== workItem.repository || runReceipt.sourceRevision !== workItem.sourceRevision) {
    throw new Error("Codex run receipt identity differs from the leased work item.");
  }
  if (runReceipt.certificationMode === true) throw new Error("Fixture certification receipts cannot complete normal Test Builder work.");
  if (runReceipt.supervisedPhysicalAcceptanceVerifiedAtStart !== true) {
    throw new Error("Codex run did not prove supervised physical acceptance at start.");
  }
  if (runReceipt.routeAdmissionVerifiedAtStart !== true) throw new Error("Codex run did not prove its short-lived route admission at start.");
  if (runReceipt.paidFallbackUsed !== false || runReceipt.publicationPerformed !== false || runReceipt.deterministicValidationPerformed !== false) {
    throw new Error("Codex run receipt exceeds the model-session authority boundary.");
  }
  if (runReceipt.modelTurnCompleted !== true || runReceipt.structuredTurnCompleted !== true || Number(runReceipt.exitCode) !== 0) {
    throw new Error("Codex model turn did not complete with valid structured output.");
  }
  if (runReceipt.candidateHeadChanged !== false) throw new Error("Codex worker changed candidate HEAD or committed during its turn.");
  if (typeof runReceipt.candidateDirtyAfter !== "boolean") throw new Error("Codex run receipt omitted candidateDirtyAfter truth.");

  const routeAdmissionSha256 = requireSha(routeEvidence(routePlan, "routeAdmissionSha256"), "Route admission SHA-256");
  const dispatchRouteAdmissionSha256 = requireSha(dispatchPlan.routeAdmissionSha256, "Dispatch route admission SHA-256");
  const runRouteAdmissionSha256 = requireSha(runReceipt.routeAdmissionSha256, "Run route admission SHA-256");
  if (new Set([routeAdmissionSha256, dispatchRouteAdmissionSha256, runRouteAdmissionSha256]).size !== 1) {
    throw new Error("Route admission identity changed between routing, dispatch and execution.");
  }

  const supervisedAcceptanceSha256 = requireSha(routeEvidence(routePlan, "supervisedAcceptanceSha256"), "Supervised acceptance SHA-256");
  const dispatchAcceptanceSha256 = requireSha(dispatchPlan.supervisedAcceptanceSha256, "Dispatch supervised acceptance SHA-256");
  const runAcceptanceSha256 = requireSha(runReceipt.supervisedAcceptanceSha256, "Run supervised acceptance SHA-256");
  if (new Set([supervisedAcceptanceSha256, dispatchAcceptanceSha256, runAcceptanceSha256]).size !== 1) {
    throw new Error("Supervised acceptance identity changed between routing, dispatch and execution.");
  }

  const capabilityReceiptSha256 = requireSha(routeEvidence(routePlan, "capabilityReceiptSha256"), "Capability receipt SHA-256");
  const dispatchCapabilitySha256 = requireSha(dispatchPlan.capabilityReceiptSha256, "Dispatch capability receipt SHA-256");
  const runCapabilitySha256 = requireSha(runReceipt.capabilityReceiptSha256, "Run capability receipt SHA-256");
  if (new Set([capabilityReceiptSha256, dispatchCapabilitySha256, runCapabilitySha256]).size !== 1) {
    throw new Error("Codex capability identity changed between routing, dispatch and execution.");
  }

  const admissionExpiry = requireIso(
    routePlan.routeAdmissionExpiresAt ?? routePlan.routeAdmission?.expiresAt ?? dispatchPlan.routeAdmissionExpiresAt,
    "Route admission expiry",
  );
  const startedAt = requireIso(runReceipt.startedAt, "Codex run start timestamp");
  const finishedAt = requireIso(runReceipt.finishedAt, "Codex run finish timestamp");
  if (startedAt.milliseconds > admissionExpiry.milliseconds) throw new Error("Codex run began after route admission expired.");
  if (finishedAt.milliseconds < startedAt.milliseconds) throw new Error("Codex run completion precedes its start.");

  const observed = assertCandidateObservation(candidateObservation, workItem, dispatchPlan, runReceipt);
  if (observed.observedAt.milliseconds + 120_000 < finishedAt.milliseconds) {
    throw new Error("Independent candidate observation predates the completed Codex model turn.");
  }
  if (observed.candidateDirty !== runReceipt.candidateDirtyAfter) {
    throw new Error("Independent candidate dirty state differs from the Codex run receipt.");
  }

  const summary = runReceipt.jsonl?.parsedWorkerSummary;
  assertSummary(summary);
  const workerReportedChangedPaths = normalizedPathArray(summary.changedPaths, "Codex worker summary changedPaths");
  if (!exactArrayEqual(workerReportedChangedPaths, observed.changedPaths)) {
    throw new Error("Codex worker reported changedPaths differ from the independently observed candidate diff.");
  }
  for (const changedPath of observed.changedPaths) {
    if (!matchesAny(changedPath, allowedPatterns)) throw new Error(`Observed candidate path is outside the admitted allowlist: ${changedPath}`);
    if (matchesAny(changedPath, forbiddenPatterns)) throw new Error(`Observed candidate path matches a forbidden path: ${changedPath}`);
  }

  if (summary.resultState === "SUCCESS") {
    if (observed.changedPaths.length === 0) throw new Error("SUCCESS requires at least one independently observed admitted changed path.");
    if (observed.candidateDirty !== true) throw new Error("SUCCESS requires observable uncommitted candidate changes.");
  } else {
    if (observed.changedPaths.length !== 0) throw new Error(`${summary.resultState} may not retain independently observed worker-authored changes.`);
    if (observed.candidateDirty !== false) throw new Error(`${summary.resultState} requires a clean candidate after the turn.`);
  }

  const state = summary.resultState === "SUCCESS"
    ? "READY_FOR_DETERMINISTIC_VALIDATION"
    : summary.resultState === "NO_ACTION"
      ? "NO_ACTION_REVIEW"
      : summary.resultState;
  const workerSummarySha256 = sha256Bytes(Buffer.from(canonicalJson(summary), "utf8"));
  const completionBody = {
    schemaVersion: 1,
    kind: "evavo-codex-test-builder-completion-v1",
    workItemId: workItem.id,
    workerId: runReceipt.workerId,
    repository: workItem.repository,
    sourceRevision: workItem.sourceRevision,
    workerClass: workItem.workerClass,
    routeId: "codex-spark-pro",
    resultState: summary.resultState,
    lifecycleState: state,
    changedPaths: observed.changedPaths,
    workerReportedChangedPaths,
    independentlyObservedChangedPaths: observed.changedPaths,
    changedPathContinuityProven: true,
    assertionsAdded: [...summary.assertionsAdded],
    assumptions: [...summary.assumptions],
    followUp: [...summary.followUp],
    workerSummarySha256,
    candidateObservationSha256: observed.observationSha256,
    candidateObservationObservedAt: observed.observedAt.value,
    routeAdmissionSha256,
    supervisedAcceptanceSha256,
    capabilityReceiptSha256,
    routeAdmissionExpiresAt: admissionExpiry.value,
    modelTurnStartedAt: startedAt.value,
    modelTurnFinishedAt: finishedAt.value,
    validationRequired: summary.resultState === "SUCCESS",
    requiredValidationCount: requiredValidation.length,
    deterministicValidationPerformed: false,
    deterministicValidationPassed: false,
    modelSessionMayClaimValidation: false,
    candidateHeadChanged: false,
    candidateIndexChanged: false,
    candidateUnmergedState: false,
    workerCommitPerformed: false,
    paidFallbackUsed: false,
    publicationPerformed: false,
    evidence: {
      workItem: evidence(workItemBytes, workItem),
      routePlan: evidence(routePlanBytes, routePlan),
      dispatchPlan: evidence(dispatchPlanBytes, dispatchPlan),
      runReceipt: evidence(runReceiptBytes, runReceipt),
      candidateObservation: evidence(candidateObservationBytes, candidateObservation),
    },
    physicalPathsReturned: false,
    credentialValuesReturned: false,
    repositoryMutationAuthorityGrantedByCompletion: false,
    validationAuthorityGrantedByCompletion: false,
    publicationAuthority: false,
    truthBoundary: "This receipt proves continuity from one leased Test Builder work item through a short-lived Spark route admission, dispatch plan, completed structured model turn and independent post-turn Git observation. SUCCESS means only that the model-reported path set exactly matches bounded, unstaged, unmerged, uncommitted candidate changes ready for external deterministic validation; it never means tests passed, approval was granted, Git was published or production behavior was accepted.",
  };
  return {
    ...completionBody,
    completionSha256: sha256Bytes(Buffer.from(canonicalJson(completionBody), "utf8")),
  };
}
