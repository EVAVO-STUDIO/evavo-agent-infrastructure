#!/usr/bin/env node

import fs from "node:fs";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const readText = (file) => fs.readFileSync(file, "utf8");
const exists = (file) => fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
const errors = [];

const routing = readJson("config/worker-capacity-routing-v1.json");
const capacityPolicy = readJson("config/codex-spark-capacity-status-v1.json");
const testBuilder = readJson("config/worker-profile-test-builder-v1.json");
const taskManifest = readJson("evavo.tasks.json");

if (routing.schemaVersion !== 1 || routing.kind !== "evavo-worker-capacity-routing") {
  errors.push("Worker capacity routing identity is invalid.");
}
const routes = Array.isArray(routing.workerRoutes) ? routing.workerRoutes : [];
const ids = routes.map((route) => route.id);
if (new Set(ids).size !== ids.length) errors.push("Worker route IDs must be unique.");

const spark = routes.find((route) => route.id === "codex-spark-pro");
if (!spark) errors.push("codex-spark-pro route is required.");
else {
  if (spark.runtime !== "codex") errors.push("Spark route runtime must be codex.");
  if (spark.modelPreference !== "gpt-5.3-codex-spark") errors.push("Spark route model preference changed.");
  if (spark.capacityClass !== "included-consumer") errors.push("Spark route must use included-consumer capacity.");
  if (spark.paidFallbackAllowed !== false) errors.push("Spark route may not allow paid fallback.");
  if (JSON.stringify(spark.workerClasses) !== JSON.stringify(["test-generation"])) {
    errors.push("Spark route must admit exactly the physically certified test-generation worker class.");
  }
  if (spark.maximumAutomaticConcurrency !== 1) errors.push("Spark automatic concurrency must remain exactly one until separately recertified.");
  const requiredStates = ["AVAILABLE", "DEGRADED", "RATE_LIMITED", "EXHAUSTED", "AUTH_REQUIRED", "OFFLINE"];
  if (JSON.stringify(spark.statusStates) !== JSON.stringify(requiredStates)) errors.push("Spark raw capacity states drifted.");
  const requiredPolicyTruth = [
    "requireReadyWorkPacket",
    "requireExactSourceRevision",
    "requireCanonicalCapacityStatus",
    "requireFreshCapacityObservation",
    "requireSupervisedPhysicalAdmission",
    "requireDigestBoundRouteAdmission",
    "requireSameCapabilityReceiptAtDispatch",
    "freshWorkerPerJob",
    "freshWorkerPerRetry",
  ];
  for (const field of requiredPolicyTruth) {
    if (spark.dispatchPolicy?.[field] !== true) errors.push(`Spark dispatch policy must require ${field}.`);
  }
  if (spark.dispatchPolicy?.runDeterministicValidationInsideModelSession !== false) {
    errors.push("Spark route must keep deterministic validation outside the model session.");
  }
  if (spark.dispatchPolicy?.maximumAutomaticAttempts !== 2) errors.push("Spark route must cap automatic attempts at two.");
  if (spark.dispatchPolicy?.onExhausted !== "retain-ready-job") errors.push("Exhausted Spark capacity must retain the ready job.");
  if (spark.dispatchPolicy?.onMissingAdmission !== "retain-ready-job") errors.push("Missing Spark admission must retain the ready job.");
  if (spark.dispatchPolicy?.onAdmissionDrift !== "reject-dispatch-and-reassemble-status") {
    errors.push("Spark admission drift must reject dispatch and require status reassembly.");
  }
}

if (capacityPolicy.schemaVersion !== 1 || capacityPolicy.kind !== "evavo-codex-spark-capacity-status-policy-v1") {
  errors.push("Spark capacity status policy identity is invalid.");
}
if (capacityPolicy.routeId !== "codex-spark-pro" || capacityPolicy.modelPreference !== "gpt-5.3-codex-spark") {
  errors.push("Spark capacity status route/model differs from routing policy.");
}
if (capacityPolicy.capacityClass !== "included-consumer" || capacityPolicy.paidFallbackAllowed !== false) {
  errors.push("Spark capacity status must remain included-consumer with no paid fallback.");
}
if (JSON.stringify(capacityPolicy.dispatchableRawCapacityStates) !== JSON.stringify(["AVAILABLE", "DEGRADED"])) {
  errors.push("Spark dispatchable raw capacity states drifted.");
}
if (JSON.stringify(capacityPolicy.admittedWorkerClasses) !== JSON.stringify(["test-generation"])) {
  errors.push("Spark capacity status must admit exactly test-generation.");
}
if (capacityPolicy.maximumConcurrency !== 1) errors.push("Spark capacity status maximum concurrency must remain one.");
for (const field of ["maximumCapacityObservationAgeSeconds", "maximumCapabilityReceiptAgeSeconds", "maximumRouteAdmissionAgeSeconds"]) {
  if (capacityPolicy[field] !== 600) errors.push(`Spark capacity status ${field} must remain 600 seconds.`);
}
if (capacityPolicy.maximumPhysicalAcceptanceAgeSeconds !== 604800) errors.push("Spark physical acceptance lifetime must remain seven days unless deliberately recertified.");
if (capacityPolicy.requireSupervisedPhysicalAcceptance !== true || capacityPolicy.requireSameCapabilityReceiptForVerificationAndDispatch !== true) {
  errors.push("Spark capacity status must require supervised acceptance verified against the same capability receipt.");
}
if (capacityPolicy.preserveRawCapacityStateSeparately !== true) errors.push("Spark capacity status must preserve raw capacity separately from admission.");

if (!routing.selection?.requiredInputs?.includes("canonicalCapacityStatus") || !routing.selection?.requiredInputs?.includes("routeAdmissionSha256")) {
  errors.push("Route selection must require canonical capacity status and route admission identity.");
}
for (const factor of ["rawCapacityState", "physicalAdmissionState", "workerClassAdmission", "admittedConcurrency"]) {
  if (!routing.selection?.factors?.includes(factor)) errors.push(`Route selection factors must include ${factor}.`);
}
for (const field of ["capacityObservationSha256", "supervisedAcceptanceSha256", "capabilityReceiptSha256", "routeAdmissionSha256"]) {
  if (!routing.telemetry?.record?.includes(field)) errors.push(`Spark routing telemetry must preserve ${field}.`);
}

if (testBuilder.workerClass !== "test-generation") errors.push("Test Builder must remain a test-generation worker.");
if (testBuilder.preferredRoute !== "codex-spark-pro") errors.push("Test Builder preferred route must be codex-spark-pro.");
if (testBuilder.capacityClass !== "included-consumer" || testBuilder.paidFallbackAllowed !== false) {
  errors.push("Test Builder must use included consumer capacity with no paid fallback.");
}
if (testBuilder.mutation?.productionSourceMutationDefault !== false) errors.push("Test Builder production-source mutation must default false.");
if (testBuilder.mutation?.creativeAssetMutation !== false || testBuilder.mutation?.ownerAuthoredCopyMutation !== false) {
  errors.push("Test Builder may not mutate creative assets or owner-authored copy.");
}
if (testBuilder.result?.workerMayPublish !== false || testBuilder.result?.workerMayClaimTestsPassed !== false) {
  errors.push("Test Builder may neither publish nor claim independent validation.");
}

const requiredFiles = [
  "scripts/codex-spark-capacity-status-core.mjs",
  "scripts/assemble-codex-spark-capacity-status.mjs",
  "scripts/test-codex-spark-capacity-status.mjs",
  "scripts/plan-worker-route.mjs",
  "scripts/compile-codex-worker-dispatch.mjs",
  "scripts/run-codex-worker-dispatch.mjs",
  "scripts/codex-test-builder-completion-core.mjs",
  "scripts/compile-codex-test-builder-completion.mjs",
  "scripts/test-codex-test-builder-completion.mjs",
];
for (const file of requiredFiles) if (!exists(file)) errors.push(`Required Spark governance source is unavailable or linked: ${file}`);

if (requiredFiles.every(exists)) {
  const assembler = readText("scripts/assemble-codex-spark-capacity-status.mjs");
  const planner = readText("scripts/plan-worker-route.mjs");
  const compiler = readText("scripts/compile-codex-worker-dispatch.mjs");
  const runner = readText("scripts/run-codex-worker-dispatch.mjs");
  const completion = readText("scripts/codex-test-builder-completion-core.mjs");

  for (const marker of ["verify-codex-spark-safe-physical-acceptance.mjs", "compileCodexSparkCapacityStatus", "providerCapacityQueryPerformed"]) {
    if (!assembler.includes(marker)) errors.push(`Spark capacity assembler is missing ${marker}.`);
  }
  for (const marker of ["evavo-worker-capacity-status-v1", "routeAdmissionSha256", "NO_CURRENT_PHYSICAL_ROUTE_ADMISSION", "WORKER_CLASS_NOT_PHYSICALLY_ADMITTED"]) {
    if (!planner.includes(marker)) errors.push(`Spark route planner is missing ${marker}.`);
  }
  for (const marker of ["routePlanSha256", "capabilityReceiptSha256", "supervisedAcceptanceSha256", "routeAdmissionExpiresAt", "dispatchPlanSha256"]) {
    if (!compiler.includes(marker)) errors.push(`Codex dispatch compiler is missing ${marker}.`);
  }
  for (const marker of ["dispatchPlanSha256", "routeAdmissionVerifiedAtStart", "supervisedPhysicalAcceptanceVerifiedAtStart", "acceptanceVerificationSha256", "candidateHeadChanged"]) {
    if (!runner.includes(marker)) errors.push(`Codex runner is missing ${marker}.`);
  }
  for (const marker of ["READY_FOR_DETERMINISTIC_VALIDATION", "modelSessionMayClaimValidation", "routeAdmissionSha256", "workerCommitPerformed"]) {
    if (!completion.includes(marker)) errors.push(`Test Builder completion compiler is missing ${marker}.`);
  }
}

if (taskManifest.schemaVersion !== 1 || taskManifest.kind !== "evavo-repository-task-manifest") {
  errors.push("Agent Infrastructure task manifest identity is invalid.");
}
for (const taskName of ["autonomous-worker-routing-certify", "codex-spark-capacity-status-certify", "codex-test-builder-completion-certify", "codex-worker-runner-safety-certify"]) {
  const task = taskManifest.tasks?.[taskName];
  if (!task || task.network !== "disabled") errors.push(`Required offline Spark contract task is missing or network-enabled: ${taskName}`);
}
const routineEntries = Object.values(taskManifest.tasks ?? {}).map((task) => task?.entry).filter(Boolean);
for (const forbidden of ["scripts/certify-codex-spark-physical-acceptance.mjs", "scripts/certify-codex-spark-physical-acceptance-safe.mjs", "scripts/run-codex-worker-dispatch.mjs"]) {
  if (routineEntries.includes(forbidden)) errors.push(`Effectful Spark source must not be a routine named task: ${forbidden}`);
}

if (errors.length) {
  console.error("Worker capacity routing v1 check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Worker capacity routing v1 check passed.");
console.log("- Spark raw capacity, physical admission and dispatch eligibility remain separate evidence classes");
console.log("- Test Builder is the sole admitted Spark worker class and concurrency remains one");
console.log("- routing, dispatch, process start and completion preserve exact admission identities");
console.log("- deterministic validation, commit, push and publication remain outside the model session");
