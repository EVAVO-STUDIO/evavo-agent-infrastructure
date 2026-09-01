#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function read(relative) {
  const resolved = fs.realpathSync.native(path.resolve(relative));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${relative} must be a regular tracked file.`);
  return fs.readFileSync(resolved, "utf8");
}

const errors = [];
const contract = JSON.parse(read("config/codex-spark-capacity-status-contract-v1.json"));
const routePolicy = JSON.parse(read("config/worker-capacity-routing-v1.json"));
const physicalPolicy = JSON.parse(read("config/codex-spark-physical-acceptance-v1.json"));
const core = read("scripts/codex-spark-capacity-status-core.mjs");
const observation = read("scripts/codex-spark-capacity-observation-core.mjs");
const compiler = read("scripts/compile-codex-spark-capacity-status.mjs");
const admittedPlanner = read("scripts/plan-codex-spark-admitted-route.mjs");
const dispatchCompiler = read("scripts/compile-codex-worker-dispatch.mjs");
const dispatchRuntime = read("scripts/run-codex-worker-dispatch.mjs");

if (contract.schemaVersion !== 1 || contract.kind !== "evavo-codex-spark-capacity-status-contract-v1") {
  errors.push("Capacity-status contract identity is invalid.");
}
if (contract.rawObservation?.installationAloneIsCapacity !== false || contract.rawObservation?.authenticationAloneIsCapacity !== false) {
  errors.push("Capacity contract must reject installation/authentication-only inference.");
}
if (contract.compiledStatus?.capacityAloneGrantsDispatch !== false) {
  errors.push("Capacity alone must never grant dispatch.");
}
if (contract.routeAdmission?.initialMaximumConcurrency !== 1 || JSON.stringify(contract.routeAdmission?.initialWorkerClasses) !== JSON.stringify(["test-generation"])) {
  errors.push("Initial route admission must remain Test Builder only at concurrency one.");
}

const spark = (routePolicy.workerRoutes ?? []).find((route) => route.id === "codex-spark-pro");
if (!spark || spark.capacityClass !== "included-consumer" || spark.paidFallbackAllowed !== false) {
  errors.push("Canonical Spark route must remain included-consumer with paid fallback disabled.");
}
if (physicalPolicy.routeId !== "codex-spark-pro" || physicalPolicy.paidFallbackAllowed !== false) {
  errors.push("Physical acceptance policy must remain bound to the zero-paid-fallback Spark route.");
}
if (physicalPolicy.initialMaximumConcurrency !== 1 || JSON.stringify(physicalPolicy.initialWorkerClasses) !== JSON.stringify(["test-generation"])) {
  errors.push("Physical acceptance must initially admit only Test Builder at concurrency one.");
}

for (const [source, tokens, label] of [
  [observation, ["STRUCTURED_TURN_COMPLETED", "RATE_LIMITED", "EXHAUSTED", "AUTH_REQUIRED", "capacityInferredFromInstallationOnly"], "capacity observation classifier"],
  [core, ["capacityAloneGrantsDispatch", "physicalAdmissionReady", "admissionSha256", "supervisedAcceptanceSha256", "paidFallbackAllowed"], "capacity status core"],
  [compiler, ["verify-codex-spark-safe-physical-acceptance.mjs", "supervisedAcceptanceSha256", "capabilityReceiptSha256"], "capacity status CLI"],
  [admittedPlanner, ["ROUTE_ADMISSION_DIGEST_MISMATCH", "routeAdmissionSha256", "supervisedAcceptanceSha256", "maximumConcurrency"], "admitted route planner"],
  [dispatchCompiler, ["routeAdmissionSha256", "supervisedAcceptanceSha256", "workerClass", "maximumConcurrency"], "Codex dispatch compiler"],
  [dispatchRuntime, ["routeAdmissionSha256", "supervisedAcceptanceSha256", "workerClass", "maximumConcurrency", "verify-codex-spark-safe-physical-acceptance.mjs"], "Codex dispatch runtime"],
]) {
  for (const token of tokens) {
    if (!source.includes(token)) errors.push(`${label} is missing required evidence binding: ${token}`);
  }
}

for (const forbidden of ["OPENAI_API_KEY fallback", "paidFallbackAllowed: true", "maximumConcurrency: 4"]) {
  if (admittedPlanner.includes(forbidden) || dispatchCompiler.includes(forbidden) || dispatchRuntime.includes(forbidden)) {
    errors.push(`Spark capacity-to-dispatch chain contains forbidden authority text: ${forbidden}`);
  }
}

if (errors.length) {
  console.error("Codex Spark capacity-to-dispatch contract check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Codex Spark capacity-to-dispatch contract check passed.");
console.log("- raw capacity, transport, authentication and physical admission remain separate");
console.log("- route admission is short-lived and digest-bound");
console.log("- dispatch preserves admission, acceptance, capability, worker-class and concurrency identity");
console.log("- Test Builder remains the only initially admitted class at concurrency one");
console.log("- paid fallback and publication authority remain disabled");
