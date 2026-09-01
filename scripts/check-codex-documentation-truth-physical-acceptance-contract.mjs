#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const files = {
  profile: "config/worker-profiles/documentation-truth-v1.json",
  policy: "config/codex-documentation-truth-physical-acceptance-v1.json",
  compiler: "scripts/compile-codex-documentation-truth-physical-acceptance.mjs",
  readiness: "scripts/compile-codex-documentation-truth-acceptance-readiness.mjs",
  tests: "scripts/test-codex-documentation-truth-physical-acceptance.mjs",
  routing: "config/worker-capacity-routing-v1.json",
  capacity: "config/codex-spark-capacity-status-v1.json",
  physical: "config/codex-spark-physical-acceptance-v1.json",
  adapter: "config/codex-worker-adapter-v1.json",
};
const errors = [];

function read(relativePath) {
  if (!fs.existsSync(relativePath)) {
    errors.push(`Required source file is missing: ${relativePath}`);
    return "";
  }
  const stat = fs.lstatSync(relativePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    errors.push(`Required source file is unsafe: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(relativePath, "utf8");
}

const source = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, read(value)]));
const json = {};
for (const key of ["profile", "policy", "routing", "capacity", "physical", "adapter"]) {
  try { json[key] = JSON.parse(source[key]); }
  catch (error) { errors.push(`${files[key]} is invalid JSON: ${error?.message ?? error}`); }
}

function requireToken(label, text, tokens) {
  for (const token of tokens) if (!text.includes(token)) errors.push(`${label} is missing token: ${token}`);
}
function forbidToken(label, text, tokens) {
  for (const token of tokens) if (text.includes(token)) errors.push(`${label} contains forbidden token: ${token}`);
}
function sameSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const profile = json.profile ?? {};
if (
  profile.schemaVersion !== 1 ||
  profile.kind !== "evavo-worker-profile-v1" ||
  profile.id !== "documentation-truth-v1" ||
  profile.workerClass !== "documentation-truth" ||
  profile.workClass !== "capability-manifest-maintenance" ||
  profile.activationState !== "staged-only"
) errors.push("Staged documentation-truth worker profile identity is invalid.");
if (!sameSet(profile.allowedPaths, ["evavo.capabilities.json", ".evavo/capabilities.json"])) {
  errors.push("Staged documentation-truth allowed paths are invalid.");
}
if (
  profile.limits?.maximumChangedFiles !== 1 ||
  profile.limits?.maximumChangedLines !== 600 ||
  profile.limits?.maximumAutomaticAttempts !== 1 ||
  profile.limits?.maximumConcurrency !== 1
) errors.push("Staged documentation-truth limits are invalid.");
for (const field of [
  "productionSourceAllowed", "dependencyChangesAllowed", "schemaChangesAllowed",
  "publicApiChangesAllowed", "gitMetadataAllowed", "commitAllowed", "pushAllowed",
  "publicationAllowed", "deploymentAllowed",
]) {
  if (profile.mutation?.[field] !== false) errors.push(`Staged profile must keep mutation.${field}=false.`);
}
if (
  profile.capacity?.class !== "included-consumer" ||
  profile.capacity?.paidFallbackAllowed !== false ||
  profile.physicalActivation?.normalRouteEnabled !== false ||
  profile.physicalActivation?.leaseEnabled !== false ||
  profile.physicalActivation?.modelExecutionEnabled !== false ||
  profile.physicalActivation?.requiresSupervisedFixtureAcceptance !== true
) errors.push("Staged documentation-truth capacity or activation boundary is invalid.");

const policy = json.policy ?? {};
if (
  policy.schemaVersion !== 1 ||
  policy.kind !== "evavo-codex-documentation-truth-physical-acceptance-policy-v1" ||
  policy.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure" ||
  policy.routeId !== "codex-spark-pro" ||
  policy.stagedWorkerClass !== "documentation-truth" ||
  policy.stagedWorkClass !== "capability-manifest-maintenance"
) errors.push("Documentation-truth physical acceptance policy identity is invalid.");
if (!sameSet(policy.currentNormalWorkerClasses, ["test-generation"])) {
  errors.push("Acceptance policy must preserve the current Test Builder-only normal route.");
}
if (!sameSet(policy.requiredScenarios, [
  "validated-success", "validated-no-action", "forbidden-path-rejection", "stale-head-rejection",
])) errors.push("Acceptance policy scenario set is invalid.");
if (
  policy.activation?.automaticActivationAllowed !== false ||
  policy.activation?.sourceReviewRequired !== true ||
  policy.activation?.normalRouteMutationPerformedByCompiler !== false ||
  policy.activation?.leaseMutationPerformedByCompiler !== false ||
  policy.activation?.modelTurnPerformedByCompiler !== false ||
  policy.activation?.publicationPerformedByCompiler !== false
) errors.push("Acceptance policy widens compiler authority.");

const route = (json.routing?.workerRoutes ?? []).find((entry) => entry?.id === "codex-spark-pro");
if (!route || !sameSet(route.workerClasses, ["test-generation"])) {
  errors.push("Normal codex-spark-pro route must remain test-generation only before physical activation.");
}
if (!sameSet(json.capacity?.admittedWorkerClasses, ["test-generation"])) {
  errors.push("Current Spark capacity policy must remain test-generation only.");
}
if (!sameSet(json.physical?.initialWorkerClasses, ["test-generation"])) {
  errors.push("Current Spark physical acceptance policy must remain test-generation only.");
}
if (
  json.adapter?.dispatch?.paidFallbackAllowed !== false ||
  json.adapter?.dispatch?.publicationAuthority !== false ||
  json.adapter?.dispatch?.validationAuthority !== false
) errors.push("Current Codex adapter widened paid, publication or validation authority.");

requireToken("Acceptance compiler", source.compiler, [
  "evavo-codex-documentation-truth-physical-acceptance-v1",
  "validated-success",
  "validated-no-action",
  "forbidden-path-rejection",
  "stale-head-rejection",
  "currentBindings",
  "normalRouteWasUnchanged",
  "modelTurnPerformedByCompiler: false",
  "normalRouteMutationPerformed: false",
  "publicationPerformed: false",
  "paidFallbackUsed: false",
]);
requireToken("Readiness compiler", source.readiness, [
  "READY_FOR_SOURCE_ACTIVATION_REVIEW",
  "RETAIN_STAGED_ONLY",
  "sourceActivationReviewRequired: true",
  "automaticActivationAllowed: false",
  "normalRouteMutationPerformed: false",
  "repositoryMutationPerformedByCompiler: false",
  "publicationPerformed: false",
  "financialActionPerformed: false",
]);
requireToken("Acceptance tests", source.tests, [
  "four supervised fixture scenarios",
  "Forbidden-path scenario did not fail closed",
  "stale or future-dated",
  "binding drifted",
  "publicationPerformed=false",
]);
forbidToken("Acceptance compiler", source.compiler, [
  "git push", "git commit", "git reset --hard", "git clean", "shell: true",
  "EVAVO_CODEX_SPARK_EXECUTION_ENABLED=1", "lease-next", "run-codex-worker-dispatch",
]);
forbidToken("Readiness compiler", source.readiness, [
  "git push", "git commit", "git reset --hard", "git clean", "shell: true",
  "EVAVO_CODEX_SPARK_EXECUTION_ENABLED=1", "lease-next", "run-codex-worker-dispatch",
]);

for (const relativePath of [files.compiler, files.readiness, files.tests, "scripts/check-codex-documentation-truth-physical-acceptance-contract.mjs"]) {
  const syntax = spawnSync(process.execPath, ["--check", relativePath], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
  });
  if (syntax.status !== 0) {
    errors.push(`${relativePath} failed Node syntax validation: ${String(syntax.stderr || syntax.stdout).trim()}`);
  }
}

if (errors.length === 0) {
  const tests = spawnSync(process.execPath, [files.tests], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 240_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (tests.status !== 0) {
    errors.push(`${files.tests} failed: ${String(tests.stderr || tests.stdout).trim()}`);
  }
}

if (errors.length > 0) {
  console.error("Documentation-truth physical acceptance contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Documentation-truth physical acceptance contract passed.");
console.log("- the worker profile remains staged-only and manifest-only");
console.log("- four fixture scenarios and cleanup evidence are exact-byte bound");
console.log("- stale evidence, drift and authority widening fail closed");
console.log("- successful readiness still requires a separate source activation review");
console.log("- lease, model, Git, publication, deployment, financial and paid-fallback authority remain disabled");
