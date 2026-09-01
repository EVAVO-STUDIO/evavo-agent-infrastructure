#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readText = (file) => fs.readFileSync(file, "utf8");
const regular = (file) => fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
const errors = [];

const requiredFiles = [
  "scripts/codex-ignored-workspace-boundary-core.mjs",
  "scripts/compile-codex-worker-dispatch-contained.mjs",
  "scripts/run-codex-worker-dispatch-contained.mjs",
  "scripts/compile-codex-test-builder-completion-contained.mjs",
  "scripts/test-codex-ignored-workspace-boundary.mjs",
];
for (const file of requiredFiles) {
  if (!regular(file)) {
    errors.push(`Required ignored-workspace source is unavailable or linked: ${file}`);
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
    errors.push(`Ignored-workspace source failed Node syntax validation: ${file}: ${detail}`);
  }
}

if (requiredFiles.every(regular)) {
  const core = readText("scripts/codex-ignored-workspace-boundary-core.mjs");
  const compiler = readText("scripts/compile-codex-worker-dispatch-contained.mjs");
  const runner = readText("scripts/run-codex-worker-dispatch-contained.mjs");
  const completion = readText("scripts/compile-codex-test-builder-completion-contained.mjs");
  const test = readText("scripts/test-codex-ignored-workspace-boundary.mjs");
  for (const marker of [
    "ls-files\", \"--others\", \"--ignored\", \"--exclude-standard\", \"-z",
    "ignoredPathsReturned: false",
    "ignoredFilesAccepted: false",
    "snapshotPasses: 2",
    "bindContainedDispatch",
    "bindContainedRunReceipt",
    "bindContainedCompletion",
  ]) if (!core.includes(marker)) errors.push(`Ignored-workspace core is missing ${marker}.`);
  for (const marker of ["compile-codex-worker-dispatch-bound.mjs", "requireZeroIgnoredWorkspace", "bindContainedDispatch"]) {
    if (!compiler.includes(marker)) errors.push(`Contained dispatch compiler is missing ${marker}.`);
  }
  for (const marker of ["run-codex-worker-dispatch.mjs", "ignoredWorkspacePathCountAfter", "modelTurnCompleted: false", "bindContainedRunReceipt"]) {
    if (!runner.includes(marker)) errors.push(`Contained runner is missing ${marker}.`);
  }
  for (const marker of ["compile-codex-test-builder-completion.mjs", "requireZeroIgnoredWorkspace", "bindContainedCompletion"]) {
    if (!completion.includes(marker)) errors.push(`Contained completion compiler is missing ${marker}.`);
  }
  for (const marker of ["ignored path names and file contents remain undisclosed", "dispatch requires a stable zero-ignored baseline", "fail closed on hidden workspace residue"]) {
    if (!test.includes(marker)) errors.push(`Ignored-workspace test is missing ${marker}.`);
  }
}

const adapter = readJson("config/codex-worker-adapter-v1.json");
const ignoredPolicy = adapter.dispatch?.ignoredWorkspacePolicy;
if (
  ignoredPolicy?.requireZeroIgnoredFilesBeforeDispatch !== true ||
  ignoredPolicy?.requireZeroIgnoredFilesImmediatelyBeforeModelTurn !== true ||
  ignoredPolicy?.requireZeroIgnoredFilesImmediatelyAfterModelTurn !== true ||
  ignoredPolicy?.requireZeroIgnoredFilesAtCompletion !== true ||
  ignoredPolicy?.stableObservationPasses !== 2 ||
  ignoredPolicy?.returnIgnoredPathNames !== false ||
  ignoredPolicy?.returnIgnoredFileContents !== false ||
  ignoredPolicy?.ignoredFilesAccepted !== false
) errors.push("Codex adapter ignored-workspace policy is incomplete or permissive.");

const profile = readJson("config/worker-profile-test-builder-v1.json");
if (profile.admission?.requiresZeroIgnoredWorkspaceFiles !== true || profile.mutation?.ignoredFileMutation !== false) {
  errors.push("Test Builder profile does not require zero ignored files or explicitly forbid ignored-file mutation.");
}
if (profile.result?.workerMayCreateIgnoredFiles !== false || profile.validationHandoff?.requireZeroIgnoredWorkspaceFiles !== true) {
  errors.push("Test Builder result/validation handoff does not preserve zero-ignored workspace truth.");
}

const capabilities = readJson("evavo.capabilities.json");
const testBuilder = capabilities.capabilities?.find((entry) => entry.id === "agent.codex.test-builder");
const expectedEntrypoints = [
  "scripts/compile-codex-worker-dispatch-contained.mjs",
  "scripts/run-codex-worker-dispatch-contained.mjs",
  "scripts/compile-codex-test-builder-completion-contained.mjs",
];
if (!testBuilder || JSON.stringify(testBuilder.entrypoints) !== JSON.stringify(expectedEntrypoints)) {
  errors.push("Brain-facing Test Builder capability does not expose exactly the contained lifecycle.");
}
if (!testBuilder?.requires?.some((value) => value.includes("Zero ignored files"))) {
  errors.push("Brain-facing Test Builder capability omits the zero-ignored workspace requirement.");
}

const registry = readJson("config/autonomous-spark-task-registry-v1.json");
for (const [taskName, entry] of [
  ["test-builder-contained-dispatch-compile", "scripts/compile-codex-worker-dispatch-contained.mjs"],
  ["test-builder-contained-run", "scripts/run-codex-worker-dispatch-contained.mjs"],
  ["test-builder-contained-completion-compile", "scripts/compile-codex-test-builder-completion-contained.mjs"],
  ["test-builder-contained-contract-suite", "scripts/check-codex-ignored-workspace-boundary-contract.mjs"],
]) {
  if (registry.tasks?.[taskName]?.entry !== entry) errors.push(`Autonomous Spark registry is missing or redirected: ${taskName}`);
}
if (
  registry.testBuilderZeroIgnoredWorkspaceRequired !== true ||
  registry.testBuilderPhysicalExecutionRegistered !== false ||
  registry.testBuilderAutomaticSchedulingEnabled !== false ||
  registry.physicalCodexExecutionRegistered !== false
) errors.push("Autonomous Spark registry overstates Test Builder physical activation or omits ignored-workspace containment.");

const tasks = readJson("evavo.tasks.json");
const certification = tasks.tasks?.["codex-ignored-workspace-boundary-certify"];
if (!certification || certification.entry !== "scripts/test-codex-ignored-workspace-boundary.mjs" || certification.network !== "disabled") {
  errors.push("Offline ignored-workspace certification task is missing or incorrectly classified.");
}
const routineEntries = Object.values(tasks.tasks ?? {}).map((task) => task?.entry).filter(Boolean);
for (const forbidden of [
  "scripts/run-codex-worker-dispatch-contained.mjs",
  "scripts/run-codex-worker-dispatch.mjs",
]) if (routineEntries.includes(forbidden)) errors.push(`Effectful Codex runner must not be a routine named task: ${forbidden}`);

const packageDocument = readJson("package.json");
const scripts = packageDocument.scripts ?? {};
if (scripts["check:spark-ignored-workspace"] !== "node scripts/check-codex-ignored-workspace-boundary-contract.mjs") {
  errors.push("Package scripts do not expose the ignored-workspace contract checker.");
}
if (scripts["test:spark-ignored-workspace"] !== "node scripts/test-codex-ignored-workspace-boundary.mjs") {
  errors.push("Package scripts do not expose the ignored-workspace tests.");
}
if (typeof scripts["test:spark-governance"] !== "string" || !scripts["test:spark-governance"].includes("check:spark-ignored-workspace") || !scripts["test:spark-governance"].includes("test:spark-ignored-workspace")) {
  errors.push("Canonical Spark governance suite does not include ignored-workspace checks and tests.");
}

if (errors.length) {
  console.error("Codex ignored-workspace boundary contract check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Codex ignored-workspace boundary contract check passed.");
console.log("- contained dispatch, run and completion are the Brain-facing Test Builder lifecycle");
console.log("- zero ignored files are required before dispatch, around the model turn and at completion");
console.log("- ignored path names and file contents are never returned or accepted");
console.log("- physical execution and automatic scheduling remain separately gated and unregistered");
