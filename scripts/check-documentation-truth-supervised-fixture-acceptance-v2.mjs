#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const files = {
  policy: "config/documentation-truth-supervised-activation-v2.json",
  verifier: "scripts/verify-documentation-truth-supervised-fixture-acceptance-v2.mjs",
  tests: "scripts/test-documentation-truth-supervised-fixture-acceptance-v2.mjs",
};
const errors = [];

function read(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
    errors.push(`Required fixture verification file is missing or unsafe: ${file}.`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

const source = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, read(file)]));

function requireTokens(label, text, tokens) {
  for (const token of tokens) if (!text.includes(token)) errors.push(`${label} is missing ${token}.`);
}

function forbidTokens(label, text, tokens) {
  for (const token of tokens) if (text.includes(token)) errors.push(`${label} contains forbidden ${token}.`);
}

try {
  const policy = JSON.parse(source.policy);
  if (
    policy.schemaVersion !== 2 ||
    policy.kind !== "evavo-documentation-truth-supervised-activation-policy-v2" ||
    policy.workerClass !== "documentation-truth" ||
    policy.workClass !== "capability-manifest-maintenance"
  ) {
    errors.push("Fixture verifier policy identity is invalid.");
  }
  if (
    policy.maximumConcurrency !== 1 ||
    policy.maximumAutomaticAttempts !== 1 ||
    policy.maximumChangedFiles !== 1 ||
    policy.maximumChangedLines !== 600
  ) {
    errors.push("Fixture verifier policy limits drifted.");
  }
  if (!Array.isArray(policy.requiredFixtureScenarios) || policy.requiredFixtureScenarios.length !== 8) {
    errors.push("Fixture verifier must retain exactly eight required scenarios.");
  }
} catch (error) {
  errors.push(`Fixture verifier policy is invalid JSON: ${error?.message ?? error}.`);
}

requireTokens("Verifier", source.verifier, [
  "evavo-documentation-truth-supervised-fixture-acceptance-v2",
  "evavo-documentation-truth-fixture-scenario-receipt-v2",
  "evavo-documentation-truth-supervised-fixture-verification-v2",
  "Fixture acceptance canonical digest is invalid",
  "scenario receipt escaped evidence root",
  "exact receipt digest changed",
  "scenario set is incomplete or contains extras",
  "success-one-manifest-file-only",
  "no-action-already-correct",
  "publication-attempt-rejected",
  "paid-fallback-rejected",
  "changedFiles exceeds the one-file bound",
  "changedLines exceeds the 600-line bound",
  "evidenceRootReturned: false",
  "workerCommitPerformed: false",
  "workerPushPerformed: false",
  "publicationPerformed: false",
  "deploymentPerformed: false",
  "financialActionPerformed: false",
  "paidFallbackUsed: false",
  "modelTurnPerformed: false",
  "repositoryMutationPerformed: false",
]);
forbidTokens("Verifier", source.verifier, [
  "spawnSync(",
  "execSync(",
  "execFileSync(",
  "git push",
  "git commit",
  "Invoke-Expression",
  "shell: true",
  "fetch(",
]);

requireTokens("Tests", source.tests, [
  "allRequiredScenariosVerified, true",
  "exact receipt digest changed",
  "publicationPerformed = true",
  "scenario set is incomplete",
  "canonical digest is invalid",
  "2026-09-10T08:00:01.000Z",
  "path count|one-file bound",
]);

for (const file of [files.verifier, files.tests, "scripts/check-documentation-truth-supervised-fixture-acceptance-v2.mjs"]) {
  const syntax = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
  });
  if (syntax.status !== 0) {
    errors.push(`${file} failed JavaScript syntax validation: ${String(syntax.stderr || syntax.stdout).trim()}.`);
  }
}

if (errors.length === 0) {
  const tests = spawnSync(process.execPath, [files.tests], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 240_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (tests.status !== 0) {
    errors.push(`${files.tests} failed: ${String(tests.stderr || tests.stdout).trim()}.`);
  }
}

if (errors.length > 0) {
  console.error("Documentation-truth supervised fixture acceptance v2 contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Documentation-truth supervised fixture acceptance v2 contract passed.");
console.log("- campaign and scenario receipts are exact-byte and canonical-digest bound");
console.log("- evidence paths must remain within a real non-symlink evidence root");
console.log("- all success, NO_ACTION and negative scenarios are mandatory");
console.log("- one-file, 600-line and zero-authority boundaries are enforced");
console.log("- the verifier performs no model, repository, Git, publication, deployment or financial effect");
