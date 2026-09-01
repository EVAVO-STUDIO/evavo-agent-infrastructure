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
  "scripts/compile-codex-test-builder-completion.mjs",
  "scripts/codex-test-builder-completion-core.mjs",
  "scripts/test-codex-test-builder-completion.mjs",
  "scripts/compile-codex-spark-route-admission.mjs",
];
for (const file of files) {
  if (!regular(file)) {
    errors.push(`Required Codex candidate-observation source is unavailable or linked: ${file}`);
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
    errors.push(`Codex candidate-observation source failed Node syntax validation: ${file}: ${detail}`);
  }
}

if (files.every(regular)) {
  const observer = readText("scripts/codex-candidate-change-observer.mjs");
  const completionCompiler = readText("scripts/compile-codex-test-builder-completion.mjs");
  const completionCore = readText("scripts/codex-test-builder-completion-core.mjs");
  const observerTest = readText("scripts/test-codex-candidate-change-observer.mjs");
  const completionTest = readText("scripts/test-codex-test-builder-completion.mjs");
  const tombstone = readText("scripts/compile-codex-spark-route-admission.mjs");

  for (const marker of [
    "runGit(candidateRoot, [\"diff\"",
    "--name-only",
    "--no-renames",
    "--cached",
    "--others",
    "--exclude-standard",
    "--unmerged",
    "candidateDirtyAfter",
    "candidateHeadChanged",
    "candidateBytesMutatedByObserver: false",
    "physicalPathsReturned: false",
  ]) {
    if (!observer.includes(marker)) errors.push(`Candidate observer is missing ${marker}.`);
  }
  for (const marker of ["observeCodexCandidateChanges", "candidateObservationBytes", "compileCodexTestBuilderCompletion"]) {
    if (!completionCompiler.includes(marker)) errors.push(`Test Builder completion compiler is missing ${marker}.`);
  }
  for (const marker of [
    "Independent candidate observation",
    "reported changedPaths differ",
    "staged/index changes",
    "unmerged Git state",
    "changedPathContinuityProven: true",
    "candidateIndexChanged: false",
    "candidateObservationSha256",
  ]) {
    if (!completionCore.includes(marker)) errors.push(`Test Builder completion core is missing ${marker}.`);
  }
  for (const marker of ["tracked, untracked and staged paths", "dirty-state", "worker-authored HEAD movement"]) {
    if (!observerTest.includes(marker)) errors.push(`Candidate observer test is missing ${marker}.`);
  }
  for (const marker of ["reported changedPaths differ", "staged/index changes", "unmerged Git state", "dirty state differs"]) {
    if (!completionTest.includes(marker)) errors.push(`Test Builder completion test is missing ${marker}.`);
  }
  for (const marker of [
    "evavo-codex-spark-route-admission-deprecated-v1",
    "admitted: false",
    "USE_CANONICAL_CAPACITY_STATUS_ASSEMBLER",
    "scripts/assemble-codex-spark-capacity-status.mjs",
    "rawCapacityEvidenceRequired: true",
  ]) {
    if (!tombstone.includes(marker)) errors.push(`Deprecated Spark admission tombstone is missing ${marker}.`);
  }
  if (tombstone.includes("admitted: true") || tombstone.includes("verify-codex-spark-safe-physical-acceptance.mjs")) {
    errors.push("Deprecated Spark admission compiler may not mint or verify a replacement admission.");
  }
}

const tasks = readJson("evavo.tasks.json");
const packageDocument = readJson("package.json");
const observerTask = tasks.tasks?.["codex-candidate-change-observer-certify"];
if (!observerTask || observerTask.entry !== "scripts/test-codex-candidate-change-observer.mjs" || observerTask.network !== "disabled") {
  errors.push("Offline candidate-observer certification task is missing or incorrectly classified.");
}
const completionTask = tasks.tasks?.["codex-test-builder-completion-certify"];
if (!completionTask || completionTask.entry !== "scripts/test-codex-test-builder-completion.mjs" || completionTask.network !== "disabled") {
  errors.push("Offline Test Builder completion certification task is missing or incorrectly classified.");
}
const scripts = packageDocument.scripts ?? {};
if (scripts["check:spark-candidate-observation"] !== "node scripts/check-codex-candidate-observation-contract.mjs") {
  errors.push("Package scripts do not expose the candidate-observation contract checker.");
}
for (const name of ["test:spark-candidate-observer", "test:spark-test-builder-completion"]) {
  if (typeof scripts[name] !== "string" || !scripts[name].startsWith("node scripts/test-codex-")) {
    errors.push(`Package script is missing or redirected: ${name}`);
  }
}
if (typeof scripts["test:spark-governance"] !== "string" || !scripts["test:spark-governance"].includes("check:spark-candidate-observation")) {
  errors.push("Canonical Spark governance suite does not include candidate-observation contract checking.");
}
if (typeof scripts.check !== "string" || !scripts.check.includes("test:spark-governance")) {
  errors.push("Canonical package check does not include the Spark governance suite.");
}

if (errors.length) {
  console.error("Codex candidate observation contract check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Codex candidate observation contract check passed.");
console.log("- model-reported paths must equal independent NUL-safe Git observations");
console.log("- staged/index changes, unmerged state and worker-authored HEAD movement fail closed");
console.log("- the obsolete admission compiler is a non-authoritative fail-closed tombstone");
console.log("- observer and completion tests are offline canonical package checks");
