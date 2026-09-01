#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readText = (file) => fs.readFileSync(file, "utf8");
const regular = (file) => fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
const errors = [];

const files = [
  "scripts/codex-candidate-change-observer.mjs",
  "scripts/test-codex-candidate-change-observer.mjs",
  "scripts/codex-worker-dispatch-binding-core.mjs",
  "scripts/compile-codex-worker-dispatch-bound.mjs",
  "scripts/test-codex-worker-dispatch-binding.mjs",
  "scripts/codex-test-builder-completion-core.mjs",
  "scripts/compile-codex-test-builder-completion.mjs",
  "scripts/test-codex-test-builder-completion.mjs",
  "scripts/codex-test-builder-boundary-core.mjs",
  "scripts/test-codex-test-builder-boundary.mjs",
  "scripts/compile-codex-spark-route-admission.mjs",
];
for (const file of files) {
  if (!regular(file)) {
    errors.push(`Required Codex exact-bound source is unavailable or linked: ${file}`);
    continue;
  }
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 256 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.stdout || result.error?.message || "syntax validation failed")
      .trim()
      .slice(0, 1000);
    errors.push(`Codex exact-bound source failed Node syntax validation: ${file}: ${detail}`);
  }
}

function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    if (!source.includes(marker)) errors.push(`${label} is missing ${marker}.`);
  }
}

if (files.every(regular)) {
  const observer = readText("scripts/codex-candidate-change-observer.mjs");
  const observerTest = readText("scripts/test-codex-candidate-change-observer.mjs");
  const dispatchBinding = readText("scripts/codex-worker-dispatch-binding-core.mjs");
  const dispatchCompiler = readText("scripts/compile-codex-worker-dispatch-bound.mjs");
  const dispatchTest = readText("scripts/test-codex-worker-dispatch-binding.mjs");
  const completionCompiler = readText("scripts/compile-codex-test-builder-completion.mjs");
  const completionCore = readText("scripts/codex-test-builder-completion-core.mjs");
  const completionTest = readText("scripts/test-codex-test-builder-completion.mjs");
  const boundaryCore = readText("scripts/codex-test-builder-boundary-core.mjs");
  const boundaryTest = readText("scripts/test-codex-test-builder-boundary.mjs");
  const tombstone = readText("scripts/compile-codex-spark-route-admission.mjs");

  requireMarkers(observer, [
    "stableCandidateState",
    "snapshotPasses: 2",
    "--binary",
    "--full-index",
    "--no-textconv",
    "trackedPatchSha256",
    "candidateFileManifestSha256",
    "untrackedFileManifestSha256",
    "gitIndexSha256",
    "candidateStateSha256",
    "GIT_OPTIONAL_LOCKS",
    "candidateBytesMutatedByObserver: false",
    "physicalPathsReturned: false",
  ], "Candidate observer");
  requireMarkers(observerTest, [
    "same path",
    "candidateStateSha256",
    "untrackedFileManifestSha256",
    "gitIndexSha256",
    "symbolic links",
    "worker-authored HEAD movement",
  ], "Candidate observer test");

  requireMarkers(dispatchBinding, [
    "dispatchBindingVersion: 1",
    "legacyDispatchPlanSha256",
    "workItemBytesSha256",
    "routePlanBytesSha256",
    "allowedPathsSha256",
    "forbiddenPathsSha256",
    "requiredValidationSha256",
    "validationAuthority !== false",
    "publicationAuthority !== false",
  ], "Bound dispatch core");
  requireMarkers(dispatchCompiler, [
    "compile-codex-worker-dispatch.mjs",
    "bindCodexWorkerDispatch",
    "Legacy read-only Codex dispatch compiler",
    "modelTurnPerformed: false",
    "publicationPerformed: false",
  ], "Bound dispatch compiler");
  if (dispatchCompiler.includes("run-codex-worker-dispatch.mjs") || dispatchCompiler.includes("spawnSync(plan.executable")) {
    errors.push("Bound dispatch compiler may not start the physical Codex runner or model process.");
  }
  requireMarkers(dispatchTest, [
    "exact leased-work and route-plan bytes",
    "allowed paths, forbidden paths",
    "authority expansion",
  ], "Bound dispatch test");

  requireMarkers(completionCompiler, [
    "observeCodexCandidateChanges",
    "compileCodexTestBuilderCompletion",
    "bindCodexTestBuilderCompletion",
    "candidateObservationBytes",
    "baseCompletion",
  ], "Test Builder completion compiler");
  requireMarkers(completionCore, [
    "READY_FOR_DETERMINISTIC_VALIDATION",
    "modelSessionMayClaimValidation",
    "reported changedPaths differ",
    "workerCommitPerformed",
  ], "Base Test Builder completion core");
  requireMarkers(completionTest, [
    "reported changedPaths differ",
    "staged/index changes",
    "unmerged Git state",
    "dirty state differs",
  ], "Base Test Builder completion test");
  requireMarkers(boundaryCore, [
    "completionBindingVersion: 1",
    "candidateContentContinuityProven: true",
    "workItemBytesSha256",
    "routePlanBytesSha256",
    "dispatchPlanBytesSha256",
    "runReceiptBytesSha256",
    "candidateStateSha256",
    "trackedPatchSha256",
    "candidateFileManifestSha256",
    "candidateGitIndexSha256",
    "requiredValidationSha256",
    "grants no validation result",
  ], "Exact-bound completion core");
  requireMarkers(boundaryTest, [
    "exact-byte and canonical-digest continuous",
    "stable two-pass candidate state",
    "validation-request drift",
    "no commit, push, publication",
  ], "Exact-bound completion test");

  requireMarkers(tombstone, [
    "evavo-codex-spark-route-admission-deprecated-v1",
    "admitted: false",
    "USE_CANONICAL_CAPACITY_STATUS_ASSEMBLER",
    "scripts/assemble-codex-spark-capacity-status.mjs",
    "rawCapacityEvidenceRequired: true",
  ], "Deprecated Spark admission tombstone");
  if (tombstone.includes("admitted: true") || tombstone.includes("verify-codex-spark-safe-physical-acceptance.mjs")) {
    errors.push("Deprecated Spark admission compiler may not mint or verify a replacement admission.");
  }
}

const tasks = readJson("evavo.tasks.json");
const packageDocument = readJson("package.json");
const registry = readJson("config/autonomous-spark-task-registry-v1.json");
const profile = readJson("config/worker-profile-test-builder-v1.json");
const capabilities = readJson("evavo.capabilities.json");

if (tasks.schemaVersion !== 1 || tasks.kind !== "evavo-repository-task-manifest") {
  errors.push("Agent Infrastructure task manifest identity is invalid.");
}
const requiredOfflineTasks = {
  "codex-candidate-change-observer-certify": "scripts/test-codex-candidate-change-observer.mjs",
  "codex-worker-dispatch-binding-certify": "scripts/test-codex-worker-dispatch-binding.mjs",
  "codex-test-builder-completion-certify": "scripts/test-codex-test-builder-completion.mjs",
  "codex-test-builder-boundary-certify": "scripts/test-codex-test-builder-boundary.mjs",
};
for (const [name, entry] of Object.entries(requiredOfflineTasks)) {
  const task = tasks.tasks?.[name];
  if (!task || task.entry !== entry || task.network !== "disabled") {
    errors.push(`Required offline exact-bound task is missing or redirected: ${name}.`);
  }
}
const routineEntries = Object.values(tasks.tasks ?? {}).map((task) => task?.entry).filter(Boolean);
for (const forbidden of [
  "scripts/run-codex-worker-dispatch.mjs",
  "scripts/certify-codex-spark-physical-acceptance.mjs",
  "scripts/certify-codex-spark-physical-acceptance-safe.mjs",
]) {
  if (routineEntries.includes(forbidden)) errors.push(`Effectful Spark source must not be a routine named task: ${forbidden}.`);
}

const scripts = packageDocument.scripts ?? {};
const expectedScripts = {
  "check:spark-candidate-observation": "node scripts/check-codex-candidate-observation-contract.mjs",
  "compile:spark-bound-dispatch": "node scripts/compile-codex-worker-dispatch-bound.mjs",
  "compile:spark-test-builder-completion": "node scripts/compile-codex-test-builder-completion.mjs",
  "test:spark-candidate-observer": "node scripts/test-codex-candidate-change-observer.mjs",
  "test:spark-dispatch-binding": "node scripts/test-codex-worker-dispatch-binding.mjs",
  "test:spark-test-builder-completion": "node scripts/test-codex-test-builder-completion.mjs",
  "test:spark-test-builder-boundary": "node scripts/test-codex-test-builder-boundary.mjs",
};
for (const [name, command] of Object.entries(expectedScripts)) {
  if (scripts[name] !== command) errors.push(`Package script is missing or redirected: ${name}.`);
}
for (const required of [
  "check:spark-candidate-observation",
  "test:spark-candidate-observer",
  "test:spark-dispatch-binding",
  "test:spark-test-builder-completion",
  "test:spark-test-builder-boundary",
]) {
  if (typeof scripts["test:spark-governance"] !== "string" || !scripts["test:spark-governance"].includes(required)) {
    errors.push(`Canonical Spark governance suite is missing ${required}.`);
  }
}
if (typeof scripts.check !== "string" || !scripts.check.includes("test:spark-governance")) {
  errors.push("Canonical package check does not include the Spark governance suite.");
}
for (const command of Object.values(scripts)) {
  if (command === "node scripts/compile-codex-worker-dispatch.mjs") {
    errors.push("Package scripts may not expose the unbound legacy dispatch compiler.");
  }
}

if (registry.schemaVersion !== 1 || registry.kind !== "evavo-autonomous-spark-task-registry-v1") {
  errors.push("Autonomous Spark task registry identity is invalid.");
}
const boundRegistry = registry.tasks?.["test-builder-bound-dispatch-compile"];
if (!boundRegistry || boundRegistry.entry !== "scripts/compile-codex-worker-dispatch-bound.mjs" || boundRegistry.network !== "disabled" || boundRegistry.effect !== "read-only-compiler") {
  errors.push("Autonomous Spark registry does not expose the read-only bound Test Builder dispatch compiler.");
}
const completionRegistry = registry.tasks?.["test-builder-exact-completion-compile"];
if (!completionRegistry || completionRegistry.entry !== "scripts/compile-codex-test-builder-completion.mjs" || completionRegistry.network !== "disabled" || completionRegistry.effect !== "read-only-candidate-observer-compiler") {
  errors.push("Autonomous Spark registry does not expose the exact Test Builder completion compiler.");
}
if (
  registry.physicalCodexExecutionRegistered !== false ||
  registry.testBuilderBoundDispatchCompilerRegistered !== true ||
  registry.testBuilderExactCandidateObserverRegistered !== true ||
  registry.testBuilderExactCompletionCompilerRegistered !== true ||
  registry.testBuilderDeterministicValidationRegistered !== false ||
  registry.testBuilderCommitOrPublicationRegistered !== false ||
  registry.deterministicValidationAuthority !== false ||
  registry.publicationAuthority !== false ||
  registry.deploymentAuthority !== false ||
  registry.paidFallbackAllowed !== false
) {
  errors.push("Autonomous Spark registry overstates Test Builder execution, validation, publication or paid-fallback authority.");
}

const expectedResultFields = ["resultState", "changedPaths", "assertionsAdded", "assumptions", "followUp"];
if (JSON.stringify(profile.result?.requiredFields) !== JSON.stringify(expectedResultFields) || profile.result?.exactFieldSetRequired !== true) {
  errors.push("Test Builder profile result fields differ from the exact worker prompt/parser contract.");
}
for (const value of [
  profile.mutation?.workerMayStage,
  profile.mutation?.workerMayCommit,
  profile.mutation?.workerMayPush,
  profile.result?.workerMayClaimTestsPassed,
  profile.result?.workerMayStage,
  profile.result?.workerMayCommit,
  profile.result?.workerMayPush,
  profile.result?.workerMayPublish,
]) {
  if (value !== false) errors.push("Test Builder profile must explicitly forbid staging, commits, pushes, publication and validation claims.");
}
if (profile.validationHandoff?.requireExactCandidateStateSha256 !== true || profile.validationHandoff?.requireIndependentDeterministicValidation !== true) {
  errors.push("Test Builder validation handoff must require exact candidate-state identity and independent deterministic validation.");
}

const testBuilderCapability = capabilities.capabilities?.find((entry) => entry.id === "agent.codex.test-builder");
if (!testBuilderCapability?.entrypoints?.includes("scripts/compile-codex-worker-dispatch-bound.mjs")) {
  errors.push("Brain-facing Test Builder capability does not expose the bound dispatch compiler.");
}
if (testBuilderCapability?.entrypoints?.includes("scripts/compile-codex-worker-dispatch.mjs")) {
  errors.push("Brain-facing Test Builder capability still exposes the unbound legacy dispatch compiler.");
}
if (!testBuilderCapability?.requires?.some((value) => value.includes("candidateStateSha256"))) {
  errors.push("Brain-facing Test Builder capability omits exact candidate-state continuity.");
}

if (errors.length) {
  console.error("Codex candidate observation contract check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Codex candidate observation contract check passed.");
console.log("- final dispatch binds exact leased-work, route, path and validation-request evidence");
console.log("- two stable candidate observations bind exact patch, changed-file and Git-index identities");
console.log("- completion preserves exact dispatch/run/candidate continuity before independent validation");
console.log("- staging, commits, publication, paid fallback and validation claims remain outside worker authority");
