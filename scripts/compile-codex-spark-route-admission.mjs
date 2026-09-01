#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [acceptanceInput, capabilityInput] = process.argv.slice(2);
if (!acceptanceInput || !capabilityInput) {
  console.error("Usage: node scripts/compile-codex-spark-route-admission.mjs <supervised-acceptance.json> <fresh-capability.json>");
  process.exit(2);
}

const regularFile = (input, label) => {
  const resolved = fs.realpathSync.native(path.resolve(input));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return resolved;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const acceptancePath = regularFile(acceptanceInput, "supervised Spark acceptance");
const capabilityPath = regularFile(capabilityInput, "fresh Codex capability receipt");
const acceptanceBytes = fs.readFileSync(acceptancePath);
const capabilityBytes = fs.readFileSync(capabilityPath);
const acceptance = JSON.parse(acceptanceBytes.toString("utf8"));
const capability = JSON.parse(capabilityBytes.toString("utf8"));

const verifier = regularFile("scripts/verify-codex-spark-safe-physical-acceptance.mjs", "supervised Spark verifier");
const verificationRun = spawnSync(process.execPath, [verifier, acceptancePath, capabilityPath], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: false,
  windowsHide: true,
  timeout: 120_000,
  maxBuffer: 4 * 1024 * 1024,
});
let verification;
try {
  verification = JSON.parse(String(verificationRun.stdout ?? "").trim());
} catch {
  console.error("Supervised Spark verifier did not emit valid JSON.");
  process.exit(1);
}
if (verificationRun.status !== 0 || verification.accepted !== true) {
  console.error(JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-spark-route-admission-v1",
    accepted: false,
    errors: Array.isArray(verification.errors) ? verification.errors : ["supervised physical acceptance verification failed"],
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
  }, null, 2));
  process.exit(1);
}

const policy = readJson("config/codex-spark-physical-acceptance-v1.json");
const acceptedAt = Date.parse(acceptance?.physicalAcceptance?.acceptedAt ?? "");
const capabilityObservedAt = Date.parse(capability?.observedAt ?? "");
const supervisedAt = Date.parse(acceptance?.supervisedAt ?? "");
const now = Date.now();
if (![acceptedAt, capabilityObservedAt, supervisedAt].every(Number.isFinite)) {
  throw new Error("Verified Spark evidence is missing required timestamps.");
}
const acceptanceExpiry = acceptedAt + Number(policy.maximumAcceptanceAgeHours) * 60 * 60 * 1000;
const capabilityExpiry = capabilityObservedAt + 10 * 60 * 1000;
const routeAdmissionMaximumExpiry = now + 10 * 60 * 1000;
const expiresAtMs = Math.min(acceptanceExpiry, capabilityExpiry, routeAdmissionMaximumExpiry);
if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
  throw new Error("Spark route admission would already be expired.");
}

const acceptedWorkerClasses = Array.isArray(verification.workerClasses) ? [...verification.workerClasses] : [];
if (acceptedWorkerClasses.length !== 1 || acceptedWorkerClasses[0] !== "test-generation") {
  throw new Error("Initial Spark route admission may authorize only test-generation.");
}
if (verification.maximumConcurrency !== 1) {
  throw new Error("Initial Spark route admission may authorize concurrency one only.");
}
if (verification.routeId !== "codex-spark-pro" || verification.modelPreference !== "gpt-5.3-codex-spark") {
  throw new Error("Spark route/model verification drifted.");
}
if (verification.paidFallbackAllowed !== false) {
  throw new Error("Spark route admission cannot allow paid fallback.");
}

console.log(JSON.stringify({
  schemaVersion: 1,
  kind: "evavo-codex-spark-route-admission-v1",
  accepted: true,
  routeId: verification.routeId,
  modelPreference: verification.modelPreference,
  acceptedWorkerClasses,
  maximumConcurrency: 1,
  supervisedAcceptanceKind: acceptance.kind,
  supervisedAcceptanceSha256: sha256(acceptanceBytes),
  capabilityReceiptSha256: sha256(capabilityBytes),
  codexVersion: capability.version,
  issuedAt: new Date(now).toISOString(),
  expiresAt: new Date(expiresAtMs).toISOString(),
  providerApiCredentialsInherited: false,
  paidFallbackAllowed: false,
  repositoryMutationAuthority: false,
  commitAuthority: false,
  pushAuthority: false,
  publicationAuthority: false,
  deploymentAuthority: false,
  modelTurnPerformed: false,
  physicalPathsReturned: false,
  truthBoundary: "This short-lived route admission is derived from a supervised physical acceptance plus a fresh Codex capability receipt. It authorizes only test-generation routing at concurrency one and grants no repository mutation or publication authority. Actual Spark execution must independently re-verify its supervised acceptance and fresh capability evidence."
}, null, 2));
