#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const files = {
  policy: "config/documentation-truth-runtime-route-planner-v1.json",
  core: "scripts/documentation-truth-runtime-route-planner-core.mjs",
  cli: "scripts/plan-documentation-truth-runtime-route.mjs",
  tests: "scripts/test-documentation-truth-runtime-route-planner.mjs",
  admissionSchema: "schemas/documentation-truth-runtime-capacity-admission-v1.schema.json",
  routeSchema: "schemas/documentation-truth-runtime-route-plan-v1.schema.json",
  taskRegistry: "config/documentation-truth-activation-task-registry-v1.json",
};

const errors = [];
function read(relativePath) {
  if (!fs.existsSync(relativePath)) {
    errors.push(`Required runtime route planner file is missing: ${relativePath}`);
    return "";
  }
  const metadata = fs.lstatSync(relativePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    errors.push(`Required runtime route planner file is unsafe: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(relativePath, "utf8");
}
const source = Object.fromEntries(
  Object.entries(files).map(([key, value]) => [key, read(value)]),
);
const documents = {};
for (const key of ["policy", "admissionSchema", "routeSchema", "taskRegistry"]) {
  try {
    documents[key] = JSON.parse(source[key]);
  } catch (error) {
    errors.push(`${files[key]} is invalid JSON: ${error?.message ?? error}`);
  }
}

const policy = documents.policy ?? {};
if (
  policy.schemaVersion !== 1 ||
  policy.kind !== "evavo-documentation-truth-runtime-route-planner-policy-v1" ||
  policy.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure" ||
  policy.workerClass !== "documentation-truth" ||
  policy.workClass !== "capability-manifest-maintenance" ||
  policy.routeId !== "codex-spark-pro" ||
  policy.modelPreference !== "gpt-5.3-codex-spark" ||
  policy.capacityClass !== "included-consumer" ||
  JSON.stringify(policy.dispatchableRawCapacityStates) !== JSON.stringify(["AVAILABLE", "DEGRADED"]) ||
  policy.maximumVerificationAgeSeconds !== 120 ||
  policy.maximumCapacityAdmissionAgeSeconds !== 120 ||
  policy.maximumRoutePlanLifetimeSeconds !== 120 ||
  policy.maximumFutureClockSkewSeconds !== 30 ||
  policy.maximumConcurrency !== 1 ||
  policy.paidFallbackAllowed !== false
) {
  errors.push("Documentation-truth runtime route planner policy identity is invalid.");
}
if (
  policy.requiredGrantVerification?.clientPolicyVersion !== 3 ||
  policy.requiredGrantVerification?.pathSafetyVerified !== true ||
  policy.requiredGrantVerification?.parentComponentSymlinkSafetyVerified !== true ||
  policy.requiredGrantVerification?.exactRequestIdentityVerified !== true ||
  policy.requiredGrantVerification?.grantConsumed !== false ||
  policy.requiredGrantVerification?.leaseAcquired !== false ||
  policy.requiredGrantVerification?.modelTurnPerformed !== false
) {
  errors.push("Documentation-truth route planner grant-verification boundary is invalid.");
}
if (
  policy.requiredCapacityAdmission?.kind !== "evavo-documentation-truth-runtime-capacity-admission-v1" ||
  policy.requiredCapacityAdmission?.decision !== "ADMITTED" ||
  policy.requiredCapacityAdmission?.physicalAcceptanceAccepted !== true ||
  policy.requiredCapacityAdmission?.candidateCampaignAccepted !== true ||
  policy.requiredCapacityAdmission?.signedRuntimeGrantRequired !== true ||
  JSON.stringify(policy.requiredCapacityAdmission?.admittedWorkerClasses) !== JSON.stringify(["documentation-truth"]) ||
  policy.requiredCapacityAdmission?.maximumConcurrency !== 1 ||
  policy.requiredCapacityAdmission?.paidFallbackAllowed !== false
) {
  errors.push("Documentation-truth capacity-admission boundary is invalid.");
}
for (const [name, value] of Object.entries(policy.physicalRegistration ?? {})) {
  if (value !== false) errors.push(`Route planner must keep physicalRegistration.${name}=false.`);
}
for (const [name, value] of Object.entries(policy.authority ?? {})) {
  if (value !== false) errors.push(`Route planner must keep authority.${name}=false.`);
}

for (const key of ["admissionSchema", "routeSchema"]) {
  const schema = documents[key] ?? {};
  if (
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    schema.type !== "object" ||
    schema.additionalProperties !== false
  ) {
    errors.push(`${files[key]} must be a closed Draft 2020-12 object schema.`);
  }
}
const admissionProperties = documents.admissionSchema?.properties ?? {};
for (const [field, expected] of Object.entries({
  maximumConcurrency: 1,
  physicalAcceptanceAccepted: true,
  candidateCampaignAccepted: true,
  signedRuntimeGrantRequired: true,
  paidFallbackAllowed: false,
  executionPerformed: false,
  queueMutationPerformed: false,
  leaseAcquired: false,
  modelTurnPerformed: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
})) {
  if (admissionProperties[field]?.const !== expected) {
    errors.push(`Capacity-admission schema must require ${field}=${JSON.stringify(expected)}.`);
  }
}
const routeProperties = documents.routeSchema?.properties ?? {};
for (const [field, expected] of Object.entries({
  workerClass: "documentation-truth",
  workClass: "capability-manifest-maintenance",
  routeId: "codex-spark-pro",
  capacityClass: "included-consumer",
  maximumConcurrency: 1,
  paidFallbackUsed: false,
  executionPerformed: false,
  queueMutationPerformed: false,
  leaseAcquired: false,
  modelTurnPerformed: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
})) {
  if (routeProperties[field]?.const !== expected) {
    errors.push(`Route-plan schema must require ${field}=${JSON.stringify(expected)}.`);
  }
}
for (const required of ["grantBodySha256", "requestSha256", "routeAdmissionSha256", "routePlanSha256"]) {
  if (!documents.routeSchema?.required?.includes(required)) {
    errors.push(`Route-plan schema must require ${required}.`);
  }
}

function requireTokens(label, text, tokens) {
  for (const token of tokens) {
    if (!text.includes(token)) errors.push(`${label} is missing token: ${token}`);
  }
}
function forbidTokens(label, text, tokens) {
  for (const token of tokens) {
    if (text.includes(token)) errors.push(`${label} contains forbidden token: ${token}`);
  }
}

requireTokens("Runtime route planner core", source.core, [
  "compileDocumentationTruthRuntimeRoutePlan",
  "canonicalDocumentationTruthRuntimeRouteJson",
  "validateWorkItem",
  "validateGrantVerification",
  "validateCapacityAdmission",
  "Local Storage grant verification receipt digest is invalid",
  "Documentation-truth capacity admission digest is invalid",
  "Local Storage grant verification is stale",
  "Documentation-truth capacity admission is stale",
  "Documentation-truth capacity admission lifetime exceeds policy",
  "Grant work-item id",
  "Grant target repository",
  "Grant target source revision",
  "Capacity admission grantId",
  "maximumConcurrency: 1",
  "paidFallbackUsed: false",
  "executionPerformed: false",
  "queueMutationPerformed: false",
  "leaseAcquired: false",
  "modelTurnPerformed: false",
  "repositoryMutationPerformed: false",
  "publicationPerformed: false",
  "routePlanSha256",
  "normalRouteRegistered: false",
  "capacityAdmissionProducerRegistered: false",
  "grantConsumptionAuthority: false",
  "leaseAuthority: false",
  "modelExecutionAuthority: false",
]);
requireTokens("Runtime route planner CLI", source.cli, [
  "safeRegularFile",
  "path component must not be a symbolic link",
  "path may not contain parent traversal",
  "compileDocumentationTruthRuntimeRoutePlan",
  "--work-item",
  "--grant-verification",
  "--capacity-admission",
  "--now",
  "RETAIN_READY_JOB",
  "capacityObservationPerformed: false",
  "physicalAcceptancePerformed: false",
  "grantConsumed: false",
  "queueMutationPerformed: false",
  "leaseAcquired: false",
  "modelTurnPerformed: false",
  "repositoryMutationPerformed: false",
  "publicationPerformed: false",
  "paidFallbackUsed: false",
]);
requireTokens("Runtime route planner tests", source.tests, [
  "exact READY work, Local v3 grant verification and sealed capacity admission produce one short-lived route plan",
  "stale or expired evidence, digest drift, class/source/grant drift and concurrency or authority widening fail closed",
  "Local Storage grant verification receipt digest is invalid",
  "Documentation-truth capacity admission digest is invalid",
  "verification is stale",
  "capacity admission is stale",
  "capacity admission is expired",
  "maximumConcurrency: 2",
  "admittedWorkerClasses: [\"test-generation\"]",
  "sourceRevision: \"9\".repeat(40)",
  "grantId: `doc-truth:${\"2\".repeat(40)}`",
  "productionSourceMutationAllowed: true",
]);

forbidTokens("Runtime route planner core", source.core, [
  'from "node:fs"',
  'from "node:child_process"',
  'from "node:net"',
  "process.env",
  "spawnSync",
  "execFileSync",
  "writeFileSync",
  "git push",
  "git commit",
  "run-codex-worker-dispatch",
  "lease-next",
  "mainline-publish",
]);
forbidTokens("Runtime route planner CLI", source.cli, [
  'from "node:child_process"',
  "spawnSync",
  "execFileSync",
  "writeFileSync",
  "appendFileSync",
  "process.env",
  "EVAVO_CODEX_SPARK_EXECUTION_ENABLED",
  "run-codex-worker-dispatch",
  "lease-next",
  "git push",
  "git commit",
  "mainline-publish",
]);

const registry = documents.taskRegistry ?? {};
for (const field of ["normalRouteRegistered", "normalLeaseRegistered", "normalModelExecutionRegistered"]) {
  if (registry[field] !== false) errors.push(`Activation registry must keep ${field}=false.`);
}
if (registry.runtimeCapacityAdmissionProducerRegistered !== false) {
  errors.push("Activation registry must keep runtimeCapacityAdmissionProducerRegistered=false.");
}

for (const relativePath of [files.core, files.cli, files.tests, "scripts/check-documentation-truth-runtime-route-planner-contract.mjs"]) {
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
  const completed = spawnSync(process.execPath, [files.tests], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      WINDIR: process.env.WINDIR ?? "",
      HOME: process.env.HOME ?? "",
      USERPROFILE: process.env.USERPROFILE ?? "",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never",
      EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "0",
      EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED: "0",
    },
  });
  if (completed.status !== 0) {
    errors.push(`${files.tests} failed: ${String(completed.stderr || completed.stdout).trim()}`);
  }
}

if (errors.length > 0) {
  console.error("Documentation-truth runtime route planner contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Documentation-truth runtime route planner contract passed.");
console.log("- exact READY work, Local v3 grant verification and sealed capacity admission produce one bounded route plan");
console.log("- stale evidence, digest drift, class/source/grant drift, authority widening and unsafe paths fail closed");
console.log("- capacity admission production, grant consumption, queue, lease, model, Git and publication remain disabled");
