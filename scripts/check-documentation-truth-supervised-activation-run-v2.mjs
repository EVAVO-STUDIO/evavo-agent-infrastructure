#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const files = {
  registry: "config/documentation-truth-supervised-activation-task-v2.json",
  policy: "config/documentation-truth-supervised-activation-v2.json",
  verifier: "scripts/verify-documentation-truth-supervised-fixture-acceptance-v2.mjs",
  compiler: "scripts/compile-documentation-truth-supervised-activation-v2.mjs",
  runner: "scripts/run-documentation-truth-supervised-activation-v2.mjs",
  fixtureChecker: "scripts/check-documentation-truth-supervised-fixture-acceptance-v2.mjs",
  activationChecker: "scripts/check-documentation-truth-supervised-activation-v2.mjs",
};
const errors = [];

function read(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
    errors.push(`Required activation-run file is missing or unsafe: ${file}.`);
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
  const registry = JSON.parse(source.registry);
  if (
    registry.schemaVersion !== 2 ||
    registry.kind !== "evavo-documentation-truth-supervised-activation-task-registry-v2" ||
    registry.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure"
  ) {
    errors.push("Activation task registry identity is invalid.");
  }
  if (
    registry.exactScenarioReceiptVerificationRequired !== true ||
    registry.fixtureVerifier !== files.verifier ||
    registry.activationCompiler !== files.compiler ||
    registry.activationRunner !== files.runner
  ) {
    errors.push("Activation task registry does not bind the exact fixture verifier, compiler and runner.");
  }
  const runTask = registry.tasks?.["documentation-truth-supervised-activation-run"];
  if (
    runTask?.entry !== files.runner ||
    runTask?.network !== "disabled" ||
    runTask?.effect !== "read-only-verifier-and-compiler"
  ) {
    errors.push("Activation runner task registration is invalid.");
  }
  for (const field of [
    "physicalActivationRegistered",
    "documentationTruthLeasePhysicallyRegistered",
    "documentationTruthModelExecutionPhysicallyRegistered",
    "configurationMutationAuthority",
    "queueMutationAuthority",
    "leaseAuthority",
    "modelAuthority",
    "repositoryMutationAuthority",
    "commitAuthority",
    "pushAuthority",
    "publicationAuthority",
    "deploymentAuthority",
    "financialAuthority",
    "paidFallbackAllowed",
  ]) {
    if (registry[field] !== false) errors.push(`Activation task registry must keep ${field}=false.`);
  }
} catch (error) {
  errors.push(`Activation task registry is invalid JSON: ${error?.message ?? error}.`);
}

requireTokens("Runner", source.runner, [
  "verify-documentation-truth-supervised-fixture-acceptance-v2.mjs",
  "compile-documentation-truth-supervised-activation-v2.mjs",
  "--fixture-evidence-root",
  "allRequiredScenariosVerified",
  "acceptanceBytesSha256",
  "verificationSha256",
  "Fixture verification canonical digest does not match",
  "Fixture verification and activation source identity differ",
  "ACTIVATE_ELIGIBLE",
  "RETAIN_READY",
  "REJECTED",
  "shell: false",
  "EVAVO_CODEX_SPARK_EXECUTION_ENABLED: \"0\"",
  "configurationMutationPerformed: false",
  "queueMutationPerformed: false",
  "leaseAcquired: false",
  "modelTurnPerformed: false",
  "repositoryMutationPerformed: false",
  "commitPerformed: false",
  "pushPerformed: false",
  "publicationPerformed: false",
  "deploymentPerformed: false",
  "financialActionPerformed: false",
  "paidFallbackUsed: false",
]);
forbidTokens("Runner", source.runner, [
  "git push",
  "git commit",
  "git reset",
  "git clean",
  "Invoke-Expression",
  "shell: true",
  "run-codex-worker-dispatch",
  "lease-next",
  "enqueue-autonomous",
  "transition",
]);

for (const file of [files.verifier, files.compiler, files.runner, files.fixtureChecker, files.activationChecker, "scripts/check-documentation-truth-supervised-activation-run-v2.mjs"]) {
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

for (const checker of [files.fixtureChecker, files.activationChecker]) {
  if (errors.length > 0) break;
  const result = spawnSync(process.execPath, [checker], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    errors.push(`${checker} failed: ${String(result.stderr || result.stdout).trim()}.`);
  }
}

if (errors.length > 0) {
  console.error("Documentation-truth supervised activation-run v2 contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Documentation-truth supervised activation-run v2 contract passed.");
console.log("- raw fixture acceptance cannot reach activation without exact scenario verification")
console.log("- verifier and compiler source identities are fixed by the task registry")
console.log("- the child environment disables Codex execution and paid fallback")
console.log("- activation remains a read-only decision with no queue, lease, model, Git or publication effect")
