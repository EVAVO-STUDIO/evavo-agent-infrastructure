#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function read(relative) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) {
    errors.push(`required regular file is missing: ${relative}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}
function json(relative) {
  try { return JSON.parse(read(relative)); }
  catch (error) { errors.push(`${relative} is invalid JSON: ${String(error?.message ?? error)}`); return {}; }
}
function tokens(relative, values) {
  const source = read(relative);
  for (const value of values) if (!source.includes(value)) errors.push(`${relative} is missing ${value}`);
  return source;
}
function falseFields(document, label, fields) {
  for (const field of fields) if (document[field] !== false) errors.push(`${label} ${field} must remain false`);
}

const planning = json("config/autonomous-work-exchange-lease-planning-v1.json");
const leaseRunner = json("config/autonomous-work-exchange-lease-runner-v1.json");
const profile = json("config/worker-profiles-documentation-truth-v1.json");
const dispatch = json("config/codex-documentation-truth-dispatch-v1.json");
const acceptance = json("config/codex-documentation-truth-physical-acceptance-v1.json");
const modelRunner = json("config/codex-documentation-truth-runner-v1.json");
const activation = json("config/documentation-truth-activation-state-v1.json");
const registry = json("config/autonomous-spark-task-registry-v1.json");

if (planning.schemaVersion !== 1 || planning.kind !== "evavo-autonomous-work-exchange-lease-planning-policy-v1" || planning.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure") errors.push("lease planning policy identity/owner is invalid");
if (JSON.stringify(planning.acceptedWorkerClasses) !== JSON.stringify(["test-generation", "documentation-truth"])) errors.push("lease planning worker classes are invalid");
if (planning.maximumItemsLeased !== 1 || planning.oneWriterPerRepository !== true || planning.maximumLeaseTtlSeconds > 600) errors.push("lease planning one-item, one-writer or TTL boundary is invalid");
for (const key of ["modelExecution", "deterministicValidation", "repositoryMutation", "commit", "push", "publication", "deployment", "paidFallback"]) if (planning.nonAuthorities?.[key] !== true) errors.push(`lease planning non-authority is missing: ${key}`);

if (leaseRunner.schemaVersion !== 1 || leaseRunner.kind !== "evavo-autonomous-work-exchange-lease-runner-policy-v1") errors.push("lease runner policy identity is invalid");
falseFields(leaseRunner, "lease runner", ["modelExecutionAuthority", "deterministicValidationAuthority", "repositoryMutationAuthority", "commitAuthority", "pushAuthority", "publicationAuthority", "deploymentAuthority", "paidFallbackAllowed"]);

if (profile.schemaVersion !== 1 || profile.kind !== "evavo-worker-profile-v1" || profile.workerClass !== "documentation-truth") errors.push("documentation-truth worker profile identity is invalid");
if (JSON.stringify(profile.allowedPaths) !== JSON.stringify(["evavo.capabilities.json", ".evavo/capabilities.json"])) errors.push("documentation-truth canonical paths are invalid");
falseFields(profile, "documentation-truth profile", ["productionSourceMutationAllowed", "dependencyChangeAllowed", "schemaChangeAllowed", "publicApiChangeAllowed", "creativeAssetMutationAllowed", "ownerAuthoredCopyMutationAllowed", "workerMayCommit", "workerMayPush", "workerMayPublish", "workerMayDeploy", "deterministicValidationAuthority", "modelDispatchPhysicallyAdmitted", "workerRoutePhysicallyAdmitted", "supervisedPhysicalAcceptanceRecorded", "capacityStatusAdmitsWorkerClass", "automaticSchedulingEnabled", "paidFallbackAllowed"]);
for (const field of ["leasePlannerImplemented", "canonicalLeaseEffectImplemented", "dispatchCompilerImplemented", "physicalAcceptanceVerifierImplemented", "effectfulRunnerImplemented"]) if (profile[field] !== true) errors.push(`documentation-truth source implementation is missing: ${field}`);

if (dispatch.schemaVersion !== 1 || dispatch.kind !== "evavo-codex-documentation-truth-dispatch-policy-v1" || dispatch.workerClass !== "documentation-truth") errors.push("documentation-truth dispatch policy identity is invalid");
if (dispatch.maximumChangedFiles !== 1 || dispatch.maximumChangedLines !== 600 || dispatch.maximumAutomaticAttempts !== 1 || dispatch.requiresExactLeaseEvidence !== true || dispatch.requiresCurrentHeadMatch !== true) errors.push("documentation-truth dispatch bounds are invalid");
falseFields(dispatch, "documentation-truth dispatch", ["networkAccessExpected", "paidFallbackAllowed", "deterministicValidationAuthority", "commitAuthority", "pushAuthority", "publicationAuthority", "deploymentAuthority"]);

if (acceptance.schemaVersion !== 1 || acceptance.kind !== "evavo-codex-documentation-truth-physical-acceptance-policy-v1") errors.push("documentation-truth physical acceptance policy identity is invalid");
if (JSON.stringify(acceptance.workerClasses) !== JSON.stringify(["documentation-truth"]) || acceptance.maximumConcurrency !== 1 || acceptance.paidFallbackAllowed !== false) errors.push("documentation-truth physical acceptance class, concurrency or cost boundary is invalid");
for (const field of ["successPathProven", "noActionPathProven", "pathBoundaryRejectionProven", "currentHeadMismatchRejectionProven", "deterministicValidationPassed", "primaryCheckoutUnchanged", "cleanupComplete"]) if (acceptance.requiredTruth?.[field] !== true) errors.push(`physical acceptance required truth is missing: ${field}`);
for (const field of ["workerCommitPerformed", "publicationPerformed", "deploymentPerformed", "paidFallbackUsed"]) if (acceptance.requiredTruth?.[field] !== false) errors.push(`physical acceptance negative truth is invalid: ${field}`);

if (modelRunner.schemaVersion !== 1 || modelRunner.kind !== "evavo-codex-documentation-truth-runner-policy-v1") errors.push("documentation-truth model runner policy identity is invalid");
if (modelRunner.maximumChangedFiles !== 1 || modelRunner.maximumChangedLines !== 600 || modelRunner.networkAccessExpected !== false) errors.push("documentation-truth model runner resource/network boundary is invalid");
falseFields(modelRunner, "documentation-truth model runner", ["paidFallbackAllowed", "deterministicValidationAuthority", "commitAuthority", "pushAuthority", "publicationAuthority", "deploymentAuthority"]);

if (activation.schemaVersion !== 1 || activation.kind !== "evavo-documentation-truth-activation-state-v1" || activation.decision !== "SOURCE_READY_PHYSICAL_ADMISSION_REQUIRED") errors.push("documentation-truth activation-state identity/decision is invalid");
for (const field of ["sourceContractsImplemented", "leasePlannerImplemented", "canonicalLeaseEffectImplemented", "dispatchCompilerImplemented", "physicalAcceptanceVerifierImplemented", "effectfulRunnerImplemented"]) if (activation[field] !== true) errors.push(`activation source readiness is missing: ${field}`);
falseFields(activation, "documentation-truth activation", ["workerRoutePhysicallyAdmitted", "supervisedPhysicalAcceptanceRecorded", "capacityStatusAdmitsWorkerClass", "normalModelExecutionRegistered", "automaticSchedulingEnabled", "deterministicValidationIntegrated", "publicationIntegrated", "paidFallbackAllowed"]);

if (registry.schemaVersion !== 1 || registry.kind !== "evavo-autonomous-spark-task-registry-v1") errors.push("autonomous Spark task registry identity is invalid");
for (const task of ["autonomous-work-exchange-lease-plan-v2", "autonomous-work-exchange-lease-runner-v2", "documentation-truth-dispatch-compile", "documentation-truth-physical-acceptance-verify", "documentation-truth-run", "documentation-truth-contract-suite"]) if (!registry.tasks?.[task]) errors.push(`autonomous Spark task registry is missing: ${task}`);
for (const field of ["documentationTruthLeaseSourceRegistered", "documentationTruthDispatchCompilerRegistered", "documentationTruthPhysicalAcceptanceVerifierRegistered", "documentationTruthRunnerSourceRegistered"]) if (registry[field] !== true) errors.push(`documentation-truth registry source flag is missing: ${field}`);
falseFields(registry, "documentation-truth registry", ["physicalCodexExecutionRegistered", "documentationTruthWorkerRoutePhysicallyAdmitted", "documentationTruthSupervisedPhysicalAcceptanceRecorded", "documentationTruthCapacityStatusAdmitted", "documentationTruthNormalExecutionRegistered", "documentationTruthAutomaticSchedulingEnabled", "paidFallbackAllowed", "deterministicValidationAuthority", "publicationAuthority", "deploymentAuthority"]);

const sourceChecks = [
  ["scripts/compile-autonomous-work-exchange-lease-plan.mjs", ["expectedSnapshotSha256", "expectedGeneration", "routeAdmissionSha256", "oneWriterPerRepository", "documentation-truth", "maximumItemsLeased", "modelTurnPerformed: false", "publicationPerformed: false", "paidFallbackUsed: false"]],
  ["scripts/run-autonomous-work-exchange-lease.mjs", ["autonomousLeaseActionPhysicallyRegistered", "policy.localStorageEffect", "LEASE_ACQUIRED", "modelTurnPerformed: false", "publicationPerformed: false", "deploymentPerformed: false"]],
  ["scripts/compile-codex-documentation-truth-dispatch.mjs", ["evavo-codex-documentation-truth-dispatch-plan-v1", "workItemSha256: workSource.sha256", "physicalDocumentationTruthAcceptanceRequired", "canonical capability manifest paths", "candidate worktree receipt", "modelTurnPerformed: false", "deterministicValidationPerformed: false", "publicationPerformed: false"]],
  ["scripts/verify-codex-documentation-truth-physical-acceptance.mjs", ["evavo-codex-documentation-truth-physical-acceptance-verification-v1", "acceptanceFingerprintSha256", "fresh-codex-capability-probe", "documentation-truth", "modelTurnPerformed: false", "publicationPerformed: false"]],
  ["scripts/run-codex-documentation-truth-dispatch.mjs", ["runnerPolicy.executionEnableEnvironmentVariable", "runnerPolicy.acceptanceReceiptEnvironmentVariable", "workItemSha256: plan.workItemSha256", "candidate must be clean", "Only SUCCESS may leave", "apiKeyEnvironmentSanitized", "deterministicValidationPerformed: false", "publicationPerformed: false"]]
];
for (const [relative, requiredTokens] of sourceChecks) {
  const source = tokens(relative, requiredTokens);
  for (const forbidden of ["shell: true", "eval(", "Invoke-Expression", "git reset --hard", "git clean", "git push", "git commit", "run-codex-worker-dispatch"]) if (source.includes(forbidden)) errors.push(`${relative} contains forbidden token: ${forbidden}`);
}

const syntaxFiles = [
  "scripts/compile-autonomous-work-exchange-lease-plan.mjs",
  "scripts/run-autonomous-work-exchange-lease.mjs",
  "scripts/compile-codex-documentation-truth-dispatch.mjs",
  "scripts/verify-codex-documentation-truth-physical-acceptance.mjs",
  "scripts/run-codex-documentation-truth-dispatch.mjs",
  "scripts/test-autonomous-work-exchange-lease-plan.mjs",
  "scripts/test-autonomous-work-exchange-lease-runner.mjs",
  "scripts/test-codex-documentation-truth-dispatch.mjs",
  "scripts/test-codex-documentation-truth-physical-acceptance.mjs",
  "scripts/test-codex-documentation-truth-runner.mjs"
];
for (const file of syntaxFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { cwd: ROOT, encoding: "utf8", shell: false, timeout: 60_000 });
  if (result.status !== 0) errors.push(`${file} failed syntax validation: ${String(result.stderr || result.stdout).trim()}`);
}
const testFiles = [
  "scripts/test-autonomous-work-exchange-lease-plan.mjs",
  "scripts/test-autonomous-work-exchange-lease-runner.mjs",
  "scripts/test-codex-documentation-truth-dispatch.mjs",
  "scripts/test-codex-documentation-truth-physical-acceptance.mjs",
  "scripts/test-codex-documentation-truth-runner.mjs"
];
for (const file of testFiles) {
  const result = spawnSync(process.execPath, [file], { cwd: ROOT, encoding: "utf8", shell: false, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) errors.push(`${file} failed: ${String(result.stderr || result.stdout).trim().slice(-4000)}`);
}

if (errors.length) {
  console.error("Autonomous Work Exchange and documentation-truth contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("Autonomous Work Exchange and documentation-truth contract passed.");
console.log("- exact READY item, state bytes, generation and short-lived route admission are bound");
console.log("- Local Storage remains the only canonical lease effect owner");
console.log("- documentation-truth compiler, physical-acceptance verifier and runner are source-ready");
console.log("- no checked-in receipt, live route admission, scheduling or normal model execution is inferred");
console.log("- model runs require exact acceptance bytes and remain manifest-only, candidate-only and non-publishing");
console.log("- deterministic validation, commit, push, publication, deployment and paid fallback remain separate and disabled");
