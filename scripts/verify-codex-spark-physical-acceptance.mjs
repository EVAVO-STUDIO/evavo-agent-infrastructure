#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [receiptPath, capabilityPath] = process.argv.slice(2);
if (!receiptPath || !capabilityPath) {
  console.error("Usage: node scripts/verify-codex-spark-physical-acceptance.mjs <acceptance-receipt.json> <fresh-capability-receipt.json>");
  process.exit(2);
}

const read = (file) => JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const policy = read("config/codex-spark-physical-acceptance-v1.json");
const adapter = read("config/codex-worker-adapter-v1.json");
const routeConfig = read("config/worker-capacity-routing-v1.json");
const receipt = read(receiptPath);
const capability = read(capabilityPath);
const errors = [];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value, Object.keys(value).sort());

if (receipt.schemaVersion !== 1 || receipt.kind !== "evavo-codex-spark-physical-acceptance-v1") errors.push("Acceptance receipt kind/schema is invalid.");
if (receipt.routeId !== policy.routeId || receipt.modelPreference !== policy.modelPreference) errors.push("Acceptance route/model differs from policy.");
if (receipt.capacityClass !== policy.capacityClass || receipt.authenticationClass !== policy.requiredAuthenticationClass) errors.push("Acceptance capacity/authentication class differs from policy.");
if (receipt.sandboxMode !== policy.sandboxMode || receipt.approvalPolicy !== policy.approvalPolicy) errors.push("Acceptance sandbox/approval policy differs from policy.");
if (receipt.paidFallbackUsed !== false || receipt.apiKeyEnvironmentAbsent !== true) errors.push("Acceptance does not prove zero-paid-fallback environment.");
for (const [field, expected] of Object.entries(policy.requiredTruth ?? {})) {
  if (receipt[field] !== expected) errors.push(`Acceptance truth ${field} must equal ${JSON.stringify(expected)}.`);
}
const acceptedAt = Date.parse(receipt.acceptedAt ?? "");
if (!Number.isFinite(acceptedAt)) errors.push("Acceptance timestamp is invalid.");
const maximumAgeMs = Number(policy.maximumAcceptanceAgeHours) * 60 * 60 * 1000;
if (Number.isFinite(acceptedAt) && (Date.now() - acceptedAt > maximumAgeMs || acceptedAt - Date.now() > 120000)) errors.push("Acceptance receipt is expired or future-dated.");

if (capability.kind !== "evavo-codex-worker-capability-probe-v1" || capability.eligibleForWorkerDispatch !== true) errors.push("Fresh eligible Codex capability receipt is required.");
const capabilityTime = Date.parse(capability.observedAt ?? "");
if (!Number.isFinite(capabilityTime) || Date.now() - capabilityTime > 10 * 60 * 1000 || capabilityTime - Date.now() > 120000) errors.push("Codex capability receipt is stale or future-dated.");
if (receipt.codexVersion !== capability.version) errors.push("Codex version changed since physical acceptance.");
for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
  if (!capability.capabilities?.[key]) errors.push(`Fresh capability lacks ${key}.`);
}

const route = (routeConfig.workerRoutes ?? []).find((entry) => entry.id === policy.routeId);
if (!route || route.modelPreference !== policy.modelPreference || route.capacityClass !== policy.capacityClass || route.paidFallbackAllowed !== false) {
  errors.push("Current Spark worker route differs from physical acceptance policy.");
}
if (adapter.spark?.routeId !== policy.routeId || adapter.spark?.preferredModel !== policy.modelPreference) errors.push("Current Codex adapter route/model differs from acceptance policy.");
if (adapter.dispatch?.sandboxMode !== policy.sandboxMode || adapter.dispatch?.approvalPolicy !== policy.approvalPolicy || adapter.dispatch?.paidFallbackAllowed !== false) {
  errors.push("Current Codex adapter sandbox/approval/billing boundary differs from acceptance policy.");
}

const requiredEvidence = new Set(policy.requiredEvidence ?? []);
const evidence = receipt.evidence;
if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) errors.push("Acceptance receipt evidence map is missing.");
else {
  for (const key of requiredEvidence) {
    const value = evidence[key];
    if (!value || typeof value !== "object" || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)) {
      errors.push(`Acceptance evidence ${key} lacks a SHA-256 identity.`);
    }
  }
}

const expectedFingerprint = sha256(JSON.stringify({
  routeId: policy.routeId,
  modelPreference: policy.modelPreference,
  capacityClass: policy.capacityClass,
  sandboxMode: policy.sandboxMode,
  approvalPolicy: policy.approvalPolicy,
  codexVersion: receipt.codexVersion,
  adapterKind: adapter.kind,
  adapterRuntime: adapter.runtime,
  routeWorkerClasses: route?.workerClasses ?? [],
}));
if (receipt.acceptanceFingerprintSha256 !== expectedFingerprint) errors.push("Acceptance fingerprint does not match current route/adapter/Codex version.");

const accepted = errors.length === 0;
console.log(JSON.stringify({
  schemaVersion: 1,
  kind: "evavo-codex-spark-physical-acceptance-verification-v1",
  accepted,
  routeId: policy.routeId,
  modelPreference: policy.modelPreference,
  workerClasses: accepted ? policy.initialWorkerClasses : [],
  maximumConcurrency: accepted ? policy.initialMaximumConcurrency : 0,
  paidFallbackAllowed: false,
  errors,
  modelTurnPerformed: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
  truthBoundary: "This verifier can enable only the worker classes and concurrency proven by a fresh physical acceptance receipt. It performs no model turn and grants no publication authority."
}, null, 2));
process.exit(accepted ? 0 : 1);
