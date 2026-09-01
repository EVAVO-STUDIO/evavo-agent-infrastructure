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
  if (!spark.workerClasses?.includes("test-generation")) errors.push("Spark route must admit test-generation.");
  if (spark.dispatchPolicy?.runDeterministicValidationInsideModelSession !== false) {
    errors.push("Spark route must keep deterministic validation outside the model session.");
  }
  if (spark.dispatchPolicy?.maximumAutomaticAttempts !== 2) errors.push("Spark route must cap automatic attempts at two.");
  if (!Number.isInteger(spark.maximumAutomaticConcurrency) || spark.maximumAutomaticConcurrency < 1 || spark.maximumAutomaticConcurrency > 4) {
    errors.push("Initial Spark automatic concurrency must remain between one and four.");
  }
}

if (routing.selection?.rule?.includes("paid") !== true || routing.selection?.requiredInputs?.includes("paidFallbackAllowed") !== true) {
  errors.push("Selection policy must explicitly account for paid fallback.");
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

if (errors.length) {
  console.error("Worker capacity routing v1 check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Worker capacity routing v1 check passed.");
console.log("- Spark remains an included-capacity Codex route with no paid fallback");
console.log("- deterministic validation remains external to the model session");
console.log("- Test Builder cannot mutate production source by default or publish");
