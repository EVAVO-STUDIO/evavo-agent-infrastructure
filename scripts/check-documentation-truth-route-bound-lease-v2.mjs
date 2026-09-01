#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const files = {
  policy: "config/documentation-truth-route-bound-lease-v2.json",
  registry: "config/documentation-truth-route-bound-lease-task-v2.json",
  compiler: "scripts/compile-documentation-truth-route-bound-lease-v2.mjs",
  tests: "scripts/test-documentation-truth-route-bound-lease-v2.mjs",
  docs: "docs/DOCUMENTATION_TRUTH_ROUTE_BOUND_LEASE_V2.md",
};
const errors = [];

function read(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
    errors.push(`Required route-bound lease file is missing or unsafe: ${file}.`);
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
    policy.kind !== "evavo-documentation-truth-route-bound-lease-policy-v2" ||
    policy.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure"
  ) {
    errors.push("Route-bound lease policy identity is invalid.");
  }
  if (
    policy.action !== "storage.documentation_truth_work_exchange_lease" ||
    policy.readinessKind !== "evavo-documentation-truth-lease-readiness-v2" ||
    policy.activationKind !== "evavo-documentation-truth-supervised-activation-run-v2" ||
    policy.routePlanKind !== "evavo-worker-route-plan-v1" ||
    policy.leasePlanKind !== "evavo-documentation-truth-route-bound-lease-plan-v2"
  ) {
    errors.push("Route-bound lease protocol identity drifted.");
  }
  if (
    policy.routeId !== "codex-spark-pro" ||
    policy.runtime !== "codex" ||
    policy.modelPreference !== "gpt-5.3-codex-spark" ||
    policy.workerClass !== "documentation-truth" ||
    policy.workClass !== "capability-manifest-maintenance" ||
    policy.capacityClass !== "included-consumer"
  ) {
    errors.push("Route-bound lease worker or route identity drifted.");
  }
  if (
    policy.maximumConcurrency !== 1 ||
    policy.maximumAutomaticAttempts !== 1 ||
    policy.minimumLeaseSeconds !== 60 ||
    policy.defaultLeaseSeconds !== 180 ||
    policy.maximumLeaseSeconds !== 300 ||
    policy.maximumReadinessAgeSeconds !== 60 ||
    policy.maximumHeadAgeSeconds !== 120 ||
    policy.maximumRoutePlanAgeSeconds !== 120
  ) {
    errors.push("Route-bound lease limits drifted.");
  }
  for (const field of [
    "paidFallbackAllowed",
    "queueMutationAuthority",
    "leaseAuthority",
    "modelAuthority",
    "repositoryMutationAuthority",
    "commitAuthority",
    "pushAuthority",
    "publicationAuthority",
    "deploymentAuthority",
    "financialAuthority",
  ]) {
    if (policy[field] !== false) errors.push(`Route-bound lease policy must keep ${field}=false.`);
  }
} catch (error) {
  errors.push(`Route-bound lease policy is invalid JSON: ${error?.message ?? error}.`);
}

try {
  const registry = JSON.parse(source.registry);
  if (
    registry.schemaVersion !== 2 ||
    registry.kind !== "evavo-documentation-truth-route-bound-lease-task-registry-v2" ||
    registry.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure"
  ) {
    errors.push("Route-bound lease task registry identity is invalid.");
  }
  if (
    registry.policy !== files.policy ||
    registry.compiler !== files.compiler ||
    registry.tasks?.["documentation-truth-route-bound-lease-compile"]?.entry !== files.compiler ||
    registry.tasks?.["documentation-truth-route-bound-lease-compile"]?.network !== "disabled" ||
    registry.tasks?.["documentation-truth-route-bound-lease-compile"]?.effect !== "read-only-compiler"
  ) {
    errors.push("Route-bound lease task registry paths or compiler effect are invalid.");
  }
  for (const field of [
    "physicalLeaseRegistered",
    "physicalModelExecutionRegistered",
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
    if (registry[field] !== false) errors.push(`Route-bound lease task registry must keep ${field}=false.`);
  }
} catch (error) {
  errors.push(`Route-bound lease task registry is invalid JSON: ${error?.message ?? error}.`);
}

requireTokens("Compiler", source.compiler, [
  "LEASE_REQUIRED",
  "RETAIN_READY",
  "REJECTED",
  "storage.documentation_truth_work_exchange_lease",
  "lease readiness canonical digest does not match",
  "Lease readiness is not bound to the exact activation run",
  "Current-main observation differs from lease readiness",
  "Lease readiness is not bound to the exact repository-head bytes",
  "Worker route plan source identity differs from lease readiness",
  "Worker route plan must keep ${field}=false",
  "INSUFFICIENT_ACTIVATION_OR_ROUTE_LIFETIME",
  "expectedSnapshotSha256",
  "expectedGeneration",
  "readinessBytesSha256",
  "activationRunBytesSha256",
  "routePlanBytesSha256",
  "repositoryHeadBytesSha256",
  "maximumConcurrency: 1",
  "maximumAutomaticAttempts: 1",
  "oneWriterPerRepository: true",
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
  "lease-next",
  "run-codex-worker-dispatch",
]);

requireTokens("Tests", source.tests, [
  'document.decision, "LEASE_REQUIRED"',
  'document.decision, "RETAIN_READY"',
  'document.decision, "REJECTED"',
  "NO_ZERO_COST_CAPACITY_ROUTE_AVAILABLE",
  "INSUFFICIENT_ACTIVATION_OR_ROUTE_LIFETIME",
  "publicationPerformed: true",
  "readiness canonical digest does not match",
  "not bound to the exact activation run",
  "source identity differs",
  "paidFallbackUsed = true",
  "leaseSeconds: 301",
  "not bound to the exact repository-head bytes",
]);

requireTokens("Documentation", source.docs, [
  "`LEASE_REQUIRED` is not a lease",
  "exact Local Storage readiness",
  "current `main`",
  "one automatic attempt",
  "zero paid fallback",
  "malformed unavailable route",
  "Local Storage",
  "exclusive lock",
]);

for (const file of [files.compiler, files.tests, "scripts/check-documentation-truth-route-bound-lease-v2.mjs"]) {
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
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (tests.status !== 0) {
    errors.push(`${files.tests} failed: ${String(tests.stderr || tests.stdout).trim()}.`);
  }
}

if (errors.length > 0) {
  console.error("Documentation-truth route-bound lease v2 contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Documentation-truth route-bound lease v2 contract passed.");
console.log("- exact readiness, activation, route and current-main bytes are required")
console.log("- unavailable zero-cost capacity retains READY work only through a typed zero-effect envelope")
console.log("- lease duration cannot outlive supervised activation or route admission")
console.log("- source, digest, freshness, billing and authority drift fail closed")
console.log("- planning performs no queue, lease, model, Git, publication, deployment or financial effect")
