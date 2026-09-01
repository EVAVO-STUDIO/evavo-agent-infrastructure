#!/usr/bin/env node

import fs from "node:fs";

const routing = JSON.parse(fs.readFileSync("config/worker-capacity-routing-v1.json", "utf8"));
const testBuilder = JSON.parse(fs.readFileSync("config/worker-profile-test-builder-v1.json", "utf8"));
const errors = [];

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
  if (spark.capacityClass !== "included-consumer") errors.push("Spark route must use included-consumer capacity.");
  if (spark.paidFallbackAllowed !== false) errors.push("Spark route may not allow paid fallback.");
  if (JSON.stringify(spark.workerClasses) !== JSON.stringify(["test-generation"])) errors.push("Spark route may initially admit only test-generation.");
  if (spark.physicalAdmissionRequired !== true) errors.push("Spark route must require supervised physical admission.");
  if (spark.physicalAdmissionKind !== "evavo-codex-spark-route-admission-v1") errors.push("Spark route physical admission kind drifted.");
  if (spark.dispatchPolicy?.requireFreshPhysicalAdmission !== true) errors.push("Spark route must require a fresh physical admission.");
  if (spark.dispatchPolicy?.requireWorkerClassInPhysicalAdmission !== true) errors.push("Spark route must bind worker class to physical admission.");
  if (spark.dispatchPolicy?.capConcurrencyByPhysicalAdmission !== true) errors.push("Spark route must cap concurrency by physical admission.");
  if (spark.dispatchPolicy?.runDeterministicValidationInsideModelSession !== false) errors.push("Spark route must keep deterministic validation outside the model session.");
  if (spark.dispatchPolicy?.maximumAutomaticAttempts !== 2) errors.push("Normal Spark jobs must cap automatic attempts at two fresh workers.");
  if (spark.maximumAutomaticConcurrency !== 1) errors.push("Spark automatic concurrency must remain one until separately re-certified.");
  const future = new Set(spark.futureCandidateWorkerClasses ?? []);
  for (const candidate of ["fast-coding", "documentation-truth", "migration", "robustness", "cross-platform", "contract-hardening"]) {
    if (!future.has(candidate)) errors.push(`Expected future Spark candidate worker class is missing: ${candidate}`);
  }
}

if (routing.selection?.rule?.includes("paid") !== true || routing.selection?.requiredInputs?.includes("paidFallbackAllowed") !== true) {
  errors.push("Selection policy must explicitly account for paid fallback.");
}
if (!routing.selection?.factors?.includes("physicalAdmission")) errors.push("Selection policy must explicitly account for physical admission.");

if (testBuilder.workerClass !== "test-generation") errors.push("Test Builder must remain a test-generation worker.");
if (testBuilder.preferredRoute !== "codex-spark-pro") errors.push("Test Builder preferred route must be codex-spark-pro.");
if (testBuilder.capacityClass !== "included-consumer" || testBuilder.paidFallbackAllowed !== false) errors.push("Test Builder must use included consumer capacity with no paid fallback.");
if (testBuilder.mutation?.productionSourceMutationDefault !== false) errors.push("Test Builder production-source mutation must default false.");
if (testBuilder.mutation?.creativeAssetMutation !== false || testBuilder.mutation?.ownerAuthoredCopyMutation !== false) errors.push("Test Builder may not mutate creative assets or owner-authored copy.");
if (testBuilder.result?.workerMayPublish !== false || testBuilder.result?.workerMayClaimTestsPassed !== false) errors.push("Test Builder may neither publish nor claim independent validation.");

if (errors.length) {
  console.error("Worker capacity routing v1 check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Worker capacity routing v1 check passed.");
console.log("- Spark remains included-consumer capacity with no paid fallback");
console.log("- Spark dispatch requires fresh supervised physical worker-class admission");
console.log("- initial admitted class/concurrency are test-generation / one");
console.log("- deterministic validation remains external to the model session");
console.log("- Test Builder cannot mutate production source by default or publish");
