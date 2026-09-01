#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const files = {
  policy: "config/documentation-truth-supervised-activation-v2.json",
  compiler: "scripts/compile-documentation-truth-supervised-activation-v2.mjs",
  tests: "scripts/test-documentation-truth-supervised-activation-v2.mjs",
};
const errors = [];

function read(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
    errors.push(`Required documentation-truth activation file is missing or unsafe: ${file}.`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

const source = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, read(file)]));

function requireTokens(label, text, tokens) {
  for (const token of tokens) {
    if (!text.includes(token)) errors.push(`${label} is missing ${token}.`);
  }
}

function forbidTokens(label, text, tokens) {
  for (const token of tokens) {
    if (text.includes(token)) errors.push(`${label} contains forbidden ${token}.`);
  }
}

try {
  const policy = JSON.parse(source.policy);
  if (
    policy.schemaVersion !== 2 ||
    policy.kind !== "evavo-documentation-truth-supervised-activation-policy-v2" ||
    policy.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure"
  ) {
    errors.push("Activation policy identity is invalid.");
  }
  if (
    policy.routeId !== "codex-spark-pro" ||
    policy.workerClass !== "documentation-truth" ||
    policy.workClass !== "capability-manifest-maintenance" ||
    policy.capacityClass !== "included-consumer"
  ) {
    errors.push("Activation route or worker identity drifted.");
  }
  if (
    policy.maximumConcurrency !== 1 ||
    policy.maximumAutomaticAttempts !== 1 ||
    policy.maximumChangedFiles !== 1 ||
    policy.maximumChangedLines !== 600
  ) {
    errors.push("Activation limits drifted.");
  }
  if (
    JSON.stringify(policy.allowedPaths) !==
    JSON.stringify(["evavo.capabilities.json", ".evavo/capabilities.json"])
  ) {
    errors.push("Activation allowed paths drifted.");
  }
  for (const field of [
    "automaticallyChangesConfiguration",
    "automaticallyAcquiresLease",
    "automaticallyStartsModel",
    "automaticallyCommits",
    "automaticallyPushes",
    "automaticallyPublishes",
  ]) {
    if (policy.activation?.[field] !== false) errors.push(`Activation policy must keep ${field}=false.`);
  }
  for (const prohibited of [
    "arbitrary-shell",
    "credential-access",
    "financial-actions",
    "repository-history-rewrite",
    "force-push",
    "github-actions-dispatch",
    "paid-api-fallback",
  ]) {
    if (!policy.prohibitedAuthority?.includes(prohibited)) {
      errors.push(`Activation policy is missing prohibited authority ${prohibited}.`);
    }
  }
  for (const scenario of [
    "success-one-manifest-file-only",
    "no-action-already-correct",
    "forbidden-path-rejected",
    "stale-head-rejected",
    "second-file-rejected",
    "line-limit-rejected",
    "publication-attempt-rejected",
    "paid-fallback-rejected",
  ]) {
    if (!policy.requiredFixtureScenarios?.includes(scenario)) {
      errors.push(`Activation policy is missing fixture scenario ${scenario}.`);
    }
  }
} catch (error) {
  errors.push(`Activation policy is not valid JSON: ${error?.message ?? error}.`);
}

requireTokens("Compiler", source.compiler, [
  "ACTIVATE_ELIGIBLE",
  "RETAIN_READY",
  "REJECTED",
  "exactCurrentHeadMatched",
  "documentation-truth",
  "capability-manifest-maintenance",
  "maximumConcurrency: 1",
  "maximumAutomaticAttempts: 1",
  "Required supervised fixture scenario did not pass",
  "Repository identity is missing or differs",
  "Exact source revision is missing or differs",
  "configurationMutationPerformed: false",
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
forbidTokens("Compiler", source.compiler, [
  "spawnSync(",
  "execSync(",
  "execFileSync(",
  "git push",
  "git commit",
  "git reset",
  "git clean",
  "Invoke-Expression",
  "shell: true",
  "fetch(",
]);

requireTokens("Tests", source.tests, [
  'document.decision, "ACTIVATE_ELIGIBLE"',
  'document.decision, "RETAIN_READY"',
  'document.decision, "REJECTED"',
  "forbidden-path-rejected",
  "publicationPerformed = true",
  "sourceRevision = \"c\".repeat(40)",
  "configurationMutationPerformed, false",
  "leaseAcquired, false",
  "modelTurnPerformed, false",
  "publicationPerformed, false",
]);

for (const file of [files.compiler, files.tests, "scripts/check-documentation-truth-supervised-activation-v2.mjs"]) {
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
  console.error("Documentation-truth supervised activation v2 contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Documentation-truth supervised activation v2 contract passed.");
console.log("- exact source and evidence identities are required");
console.log("- stale or incomplete evidence retains READY work without consuming a model turn");
console.log("- widened authority and source drift are rejected");
console.log("- all success and negative fixture scenarios are mandatory");
console.log("- activation compilation performs no configuration, lease, model, Git, publication, deployment or financial effect");
