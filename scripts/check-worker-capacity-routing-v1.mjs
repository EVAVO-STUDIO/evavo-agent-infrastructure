#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readText = (file) => fs.readFileSync(file, "utf8");
const exists = (file) => fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
const errors = [];

const routing = readJson("config/worker-capacity-routing-v1.json");
const capacityPolicy = readJson("config/codex-spark-capacity-status-v1.json");
const adapter = readJson("config/codex-worker-adapter-v1.json");
const testBuilder = readJson("config/worker-profile-test-builder-v1.json");
const taskManifest = readJson("evavo.tasks.json");
const registry = readJson("config/autonomous-spark-task-registry-v1.json");
const capabilities = readJson("evavo.capabilities.json");

function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) errors.push(`${label} is missing ${marker}.`);
  }
}

if (routing.schemaVersion !== 1 || routing.kind !== "evavo-worker-capacity-routing") {
  errors.push("Worker capacity routing identity is invalid.");
}
const routes = Array.isArray(routing.workerRoutes) ? routing.workerRoutes : [];
const ids = routes.map((route) => route.id);
if (new Set(ids).size !== ids.length) errors.push("Worker route IDs must be unique.");

const spark = routes.find((route) => route.id === "codex-spark-pro");
if (!spark) errors.push("codex-spark-pro route is required.");
else {
  if (spark.runtime !== "codex") errors.push("Spark route runtime must be codex.");
  if (spark.modelPreference !== "gpt-5.3-codex-spark") errors.push("Spark route model preference changed.");
  if (spark.capacityClass !== "included-consumer") errors.push("Spark route must use included-consumer capacity.");
  if (spark.paidFallbackAllowed !== false) errors.push("Spark route may not allow paid fallback.");
  if (JSON.stringify(spark.workerClasses) !== JSON.stringify(["test-generation"])) {
    errors.push("Spark route must admit exactly the physically certified test-generation worker class.");
  }
  if (spark.maximumAutomaticConcurrency !== 1) errors.push("Spark automatic concurrency must remain exactly one until separately recertified.");
  const requiredStates = ["AVAILABLE", "DEGRADED", "RATE_LIMITED", "EXHAUSTED", "AUTH_REQUIRED", "OFFLINE"];
  if (JSON.stringify(spark.statusStates) !== JSON.stringify(requiredStates)) errors.push("Spark raw capacity states drifted.");
  for (const field of [
    "requireReadyWorkPacket",
    "requireExactSourceRevision",
    "requireCanonicalCapacityStatus",
    "requireFreshCapacityObservation",
    "requireSupervisedPhysicalAdmission",
    "requireDigestBoundRouteAdmission",
    "requireSameCapabilityReceiptAtDispatch",
    "freshWorkerPerJob",
    "freshWorkerPerRetry",
  ]) {
    if (spark.dispatchPolicy?.[field] !== true) errors.push(`Spark dispatch policy must require ${field}.`);
  }
  if (spark.dispatchPolicy?.runDeterministicValidationInsideModelSession !== false) {
    errors.push("Spark route must keep deterministic validation outside the model session.");
  }
  if (spark.dispatchPolicy?.maximumAutomaticAttempts !== 2) errors.push("Spark route must cap automatic attempts at two.");
  if (spark.dispatchPolicy?.onExhausted !== "retain-ready-job") errors.push("Exhausted Spark capacity must retain the ready job.");
  if (spark.dispatchPolicy?.onMissingAdmission !== "retain-ready-job") errors.push("Missing Spark admission must retain the ready job.");
  if (spark.dispatchPolicy?.onAdmissionDrift !== "reject-dispatch-and-reassemble-status") {
    errors.push("Spark admission drift must reject dispatch and require status reassembly.");
  }
}

if (capacityPolicy.schemaVersion !== 1 || capacityPolicy.kind !== "evavo-codex-spark-capacity-status-policy-v1") {
  errors.push("Spark capacity status policy identity is invalid.");
}
if (capacityPolicy.routeId !== "codex-spark-pro" || capacityPolicy.modelPreference !== "gpt-5.3-codex-spark") {
  errors.push("Spark capacity status route/model differs from routing policy.");
}
if (capacityPolicy.capacityClass !== "included-consumer" || capacityPolicy.paidFallbackAllowed !== false) {
  errors.push("Spark capacity status must remain included-consumer with no paid fallback.");
}
if (JSON.stringify(capacityPolicy.dispatchableRawCapacityStates) !== JSON.stringify(["AVAILABLE", "DEGRADED"])) {
  errors.push("Spark dispatchable raw capacity states drifted.");
}
if (JSON.stringify(capacityPolicy.admittedWorkerClasses) !== JSON.stringify(["test-generation"])) {
  errors.push("Spark capacity status must admit exactly test-generation.");
}
if (capacityPolicy.maximumConcurrency !== 1) errors.push("Spark capacity status maximum concurrency must remain one.");
for (const field of ["maximumCapacityObservationAgeSeconds", "maximumCapabilityReceiptAgeSeconds", "maximumRouteAdmissionAgeSeconds"]) {
  if (capacityPolicy[field] !== 600) errors.push(`Spark capacity status ${field} must remain 600 seconds.`);
}
if (capacityPolicy.maximumPhysicalAcceptanceAgeSeconds !== 604800) errors.push("Spark physical acceptance lifetime must remain seven days unless deliberately recertified.");
if (capacityPolicy.requireSupervisedPhysicalAcceptance !== true || capacityPolicy.requireSameCapabilityReceiptForVerificationAndDispatch !== true) {
  errors.push("Spark capacity status must require supervised acceptance verified against the same capability receipt.");
}
if (capacityPolicy.preserveRawCapacityStateSeparately !== true) errors.push("Spark capacity status must preserve raw capacity separately from admission.");

if (!routing.selection?.requiredInputs?.includes("canonicalCapacityStatus") || !routing.selection?.requiredInputs?.includes("routeAdmissionSha256")) {
  errors.push("Route selection must require canonical capacity status and route admission identity.");
}
for (const factor of ["rawCapacityState", "physicalAdmissionState", "workerClassAdmission", "admittedConcurrency"]) {
  if (!routing.selection?.factors?.includes(factor)) errors.push(`Route selection factors must include ${factor}.`);
}
for (const field of ["capacityObservationSha256", "supervisedAcceptanceSha256", "capabilityReceiptSha256", "routeAdmissionSha256"]) {
  if (!routing.telemetry?.record?.includes(field)) errors.push(`Spark routing telemetry must preserve ${field}.`);
}

if (adapter.schemaVersion !== 1 || adapter.kind !== "evavo-codex-worker-adapter-v1") {
  errors.push("Codex worker adapter identity is invalid.");
}
const ignoredPolicy = adapter.dispatch?.ignoredWorkspacePolicy;
for (const field of [
  "requireZeroIgnoredFilesBeforeDispatch",
  "requireZeroIgnoredFilesImmediatelyBeforeModelTurn",
  "requireZeroIgnoredFilesImmediatelyAfterModelTurn",
  "requireZeroIgnoredFilesAtCompletion",
]) {
  if (ignoredPolicy?.[field] !== true) errors.push(`Codex adapter ignored-workspace policy must require ${field}.`);
}
if (
  ignoredPolicy?.stableObservationPasses !== 2 ||
  ignoredPolicy?.returnIgnoredPathNames !== false ||
  ignoredPolicy?.returnIgnoredFileContents !== false ||
  ignoredPolicy?.ignoredFilesAccepted !== false
) errors.push("Codex adapter ignored-workspace policy is incomplete or permissive.");

if (testBuilder.workerClass !== "test-generation") errors.push("Test Builder must remain a test-generation worker.");
if (testBuilder.preferredRoute !== "codex-spark-pro") errors.push("Test Builder preferred route must be codex-spark-pro.");
if (testBuilder.capacityClass !== "included-consumer" || testBuilder.paidFallbackAllowed !== false) {
  errors.push("Test Builder must use included consumer capacity with no paid fallback.");
}
if (testBuilder.admission?.requiresZeroIgnoredWorkspaceFiles !== true) errors.push("Test Builder must require zero ignored workspace files.");
if (testBuilder.mutation?.productionSourceMutationDefault !== false || testBuilder.mutation?.ignoredFileMutation !== false) {
  errors.push("Test Builder must forbid production-source and ignored-file mutation by default.");
}
if (testBuilder.mutation?.creativeAssetMutation !== false || testBuilder.mutation?.ownerAuthoredCopyMutation !== false) {
  errors.push("Test Builder may not mutate creative assets or owner-authored copy.");
}
if (
  testBuilder.result?.workerMayPublish !== false ||
  testBuilder.result?.workerMayClaimTestsPassed !== false ||
  testBuilder.result?.workerMayCreateIgnoredFiles !== false
) errors.push("Test Builder may neither publish, claim independent validation nor create ignored files.");
if (
  testBuilder.validationHandoff?.requireExactCandidateStateSha256 !== true ||
  testBuilder.validationHandoff?.requireZeroIgnoredWorkspaceFiles !== true ||
  testBuilder.validationHandoff?.requireIndependentDeterministicValidation !== true
) errors.push("Test Builder validation handoff must bind candidate state, zero ignored files and independent validation.");

const requiredFiles = [
  "scripts/codex-spark-capacity-status-core.mjs",
  "scripts/assemble-codex-spark-capacity-status.mjs",
  "scripts/test-codex-spark-capacity-status.mjs",
  "scripts/plan-worker-route.mjs",
  "scripts/compile-codex-worker-dispatch.mjs",
  "scripts/codex-worker-dispatch-binding-core.mjs",
  "scripts/compile-codex-worker-dispatch-bound.mjs",
  "scripts/codex-ignored-workspace-boundary-core.mjs",
  "scripts/compile-codex-worker-dispatch-contained.mjs",
  "scripts/run-codex-worker-dispatch.mjs",
  "scripts/run-codex-worker-dispatch-contained.mjs",
  "scripts/codex-test-builder-completion-core.mjs",
  "scripts/codex-test-builder-boundary-core.mjs",
  "scripts/compile-codex-test-builder-completion.mjs",
  "scripts/compile-codex-test-builder-completion-contained.mjs",
  "scripts/test-codex-test-builder-completion.mjs",
  "scripts/test-codex-test-builder-boundary.mjs",
  "scripts/test-codex-ignored-workspace-boundary.mjs",
  "scripts/check-codex-ignored-workspace-boundary-contract.mjs",
];
for (const file of requiredFiles) {
  if (!exists(file)) {
    errors.push(`Required Spark governance source is unavailable or linked: ${file}`);
    continue;
  }
  const syntax = spawnSync(process.execPath, ["--check", file], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 256 * 1024,
  });
  if (syntax.error || syntax.status !== 0) {
    const detail = String(syntax.stderr || syntax.stdout || syntax.error?.message || "syntax validation failed").trim().slice(0, 1000);
    errors.push(`Required Spark governance source failed Node syntax validation: ${file}: ${detail}`);
  }
}

if (requiredFiles.every(exists)) {
  const capacityCore = readText("scripts/codex-spark-capacity-status-core.mjs");
  const assembler = readText("scripts/assemble-codex-spark-capacity-status.mjs");
  const planner = readText("scripts/plan-worker-route.mjs");
  const ignoredCore = readText("scripts/codex-ignored-workspace-boundary-core.mjs");
  const containedCompiler = readText("scripts/compile-codex-worker-dispatch-contained.mjs");
  const containedRunner = readText("scripts/run-codex-worker-dispatch-contained.mjs");
  const containedCompletion = readText("scripts/compile-codex-test-builder-completion-contained.mjs");
  const completion = readText("scripts/codex-test-builder-boundary-core.mjs");

  requireMarkers(assembler, [
    "verify-codex-spark-safe-physical-acceptance.mjs",
    "compileCodexSparkCapacityStatus",
    "verification.accepted",
    "contradicts its accepted decision",
  ], "Spark capacity assembler");
  requireMarkers(capacityCore, [
    "providerCapacityQueryPerformed",
    "capacityAloneIsExecutionAuthority",
    "sameCapabilityReceiptRequiredAtDispatch",
    "routeAdmissionSha256",
  ], "Spark capacity status core");
  requireMarkers(planner, [
    "evavo-worker-capacity-status-v1",
    "routeAdmissionSha256",
    "NO_CURRENT_PHYSICAL_ROUTE_ADMISSION",
    "WORKER_CLASS_NOT_PHYSICALLY_ADMITTED",
  ], "Spark route planner");
  requireMarkers(ignoredCore, [
    "--ignored",
    "--exclude-standard",
    "snapshotPasses: 2",
    "ignoredPathsReturned: false",
    "ignoredFilesAccepted: false",
    "bindContainedDispatch",
    "bindContainedRunReceipt",
    "bindContainedCompletion",
  ], "Ignored-workspace core");
  requireMarkers(containedCompiler, [
    "compile-codex-worker-dispatch-bound.mjs",
    "requireZeroIgnoredWorkspace",
    "bindContainedDispatch",
  ], "Contained dispatch compiler");
  requireMarkers(containedRunner, [
    "run-codex-worker-dispatch.mjs",
    "requireZeroIgnoredWorkspace",
    "ignoredWorkspacePathCountAfter",
    "modelTurnCompleted: false",
    "bindContainedRunReceipt",
  ], "Contained Codex runner");
  requireMarkers(containedCompletion, [
    "compile-codex-test-builder-completion.mjs",
    "requireZeroIgnoredWorkspace",
    "bindContainedCompletion",
  ], "Contained completion compiler");
  requireMarkers(completion, [
    "READY_FOR_DETERMINISTIC_VALIDATION",
    "candidateStateSha256",
    "trackedPatchSha256",
    "candidateGitIndexSha256",
    "grants no validation result",
  ], "Exact-bound completion core");
}

if (taskManifest.schemaVersion !== 1 || taskManifest.kind !== "evavo-repository-task-manifest") {
  errors.push("Agent Infrastructure task manifest identity is invalid.");
}
for (const taskName of [
  "autonomous-worker-routing-certify",
  "codex-spark-capacity-status-certify",
  "codex-candidate-change-observer-certify",
  "codex-ignored-workspace-boundary-certify",
  "codex-test-builder-completion-certify",
  "codex-test-builder-boundary-certify",
  "codex-worker-runner-safety-certify",
]) {
  const task = taskManifest.tasks?.[taskName];
  if (!task || task.network !== "disabled") errors.push(`Required offline Spark contract task is missing or network-enabled: ${taskName}`);
}
const routineEntries = Object.values(taskManifest.tasks ?? {}).map((task) => task?.entry).filter(Boolean);
for (const forbidden of [
  "scripts/certify-codex-spark-physical-acceptance.mjs",
  "scripts/certify-codex-spark-physical-acceptance-safe.mjs",
  "scripts/run-codex-worker-dispatch.mjs",
  "scripts/run-codex-worker-dispatch-contained.mjs",
]) {
  if (routineEntries.includes(forbidden)) errors.push(`Effectful Spark source must not be a routine named task: ${forbidden}`);
}

if (registry.schemaVersion !== 1 || registry.kind !== "evavo-autonomous-spark-task-registry-v1") {
  errors.push("Autonomous Spark task registry identity is invalid.");
}
for (const [name, entry] of [
  ["test-builder-contained-dispatch-compile", "scripts/compile-codex-worker-dispatch-contained.mjs"],
  ["test-builder-contained-run", "scripts/run-codex-worker-dispatch-contained.mjs"],
  ["test-builder-contained-completion-compile", "scripts/compile-codex-test-builder-completion-contained.mjs"],
  ["test-builder-contained-contract-suite", "scripts/check-codex-ignored-workspace-boundary-contract.mjs"],
]) {
  if (registry.tasks?.[name]?.entry !== entry) errors.push(`Autonomous Spark registry is missing or redirected: ${name}.`);
}
if (
  registry.testBuilderZeroIgnoredWorkspaceRequired !== true ||
  registry.testBuilderContainedDispatchCompilerRegistered !== true ||
  registry.testBuilderContainedRunnerSourceRegistered !== true ||
  registry.testBuilderContainedCompletionCompilerRegistered !== true ||
  registry.physicalCodexExecutionRegistered !== false ||
  registry.testBuilderPhysicalExecutionRegistered !== false ||
  registry.testBuilderAutomaticSchedulingEnabled !== false ||
  registry.testBuilderDeterministicValidationRegistered !== false ||
  registry.testBuilderCommitOrPublicationRegistered !== false ||
  registry.deterministicValidationAuthority !== false ||
  registry.publicationAuthority !== false ||
  registry.deploymentAuthority !== false ||
  registry.paidFallbackAllowed !== false
) errors.push("Autonomous Spark registry overstates contained Test Builder activation or authority.");

const testBuilderCapability = capabilities.capabilities?.find((entry) => entry.id === "agent.codex.test-builder");
const containedEntrypoints = [
  "scripts/compile-codex-worker-dispatch-contained.mjs",
  "scripts/run-codex-worker-dispatch-contained.mjs",
  "scripts/compile-codex-test-builder-completion-contained.mjs",
];
if (JSON.stringify(testBuilderCapability?.entrypoints) !== JSON.stringify(containedEntrypoints)) {
  errors.push("Brain-facing Test Builder capability must expose exactly the contained lifecycle.");
}
if (!testBuilderCapability?.requires?.some((value) => value.includes("Zero ignored files"))) {
  errors.push("Brain-facing Test Builder capability omits zero-ignored workspace containment.");
}
if (!testBuilderCapability?.requires?.some((value) => value.includes("External deterministic validation"))) {
  errors.push("Brain-facing Test Builder capability omits independent deterministic validation.");
}

if (errors.length) {
  console.error("Worker capacity routing v1 check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Worker capacity routing v1 check passed.");
console.log("- Spark raw capacity, physical admission and dispatch eligibility remain separate evidence classes");
console.log("- Test Builder is the sole admitted Spark worker class and concurrency remains one");
console.log("- Brain-facing execution uses only the contained zero-ignored dispatch, run and completion lifecycle");
console.log("- ignored workspace content, staging, commit, validation claims, paid fallback and publication fail closed");
console.log("- physical execution and automatic scheduling remain separately gated and unregistered");
