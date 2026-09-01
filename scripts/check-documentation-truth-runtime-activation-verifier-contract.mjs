#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const files = {
  policy: "config/documentation-truth-runtime-activation-verifier-v1.json",
  core: "scripts/documentation-truth-runtime-activation-verifier-core.mjs",
  cli: "scripts/verify-documentation-truth-runtime-activation-grant.mjs",
  tests: "scripts/test-documentation-truth-runtime-activation-verifier.mjs",
  trustSchema: "schemas/documentation-truth-runtime-activation-trust-anchor-v1.schema.json",
  verificationSchema: "schemas/documentation-truth-runtime-activation-grant-verification-v1.schema.json",
};
const errors = [];
function read(relativePath) {
  if (!fs.existsSync(relativePath)) {
    errors.push(`Required runtime activation verifier file is missing: ${relativePath}`);
    return "";
  }
  const stat = fs.lstatSync(relativePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    errors.push(`Required runtime activation verifier file is unsafe: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(relativePath, "utf8");
}
const source = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, read(value)]));
const json = {};
for (const key of ["policy", "trustSchema", "verificationSchema"]) {
  try { json[key] = JSON.parse(source[key]); }
  catch (error) { errors.push(`${files[key]} is invalid JSON: ${error?.message ?? error}`); }
}

const policy = json.policy ?? {};
if (
  policy.schemaVersion !== 1 ||
  policy.kind !== "evavo-documentation-truth-runtime-activation-verifier-policy-v1" ||
  policy.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure" ||
  policy.grantBodyKind !== "evavo-documentation-truth-runtime-activation-grant-v1" ||
  policy.grantEnvelopeKind !== "evavo-documentation-truth-runtime-activation-grant-envelope-v1" ||
  policy.grantRequestKind !== "evavo-documentation-truth-runtime-grant-request-v1" ||
  policy.trustAnchorKind !== "evavo-documentation-truth-runtime-activation-trust-anchor-v1" ||
  policy.verificationReceiptKind !== "evavo-documentation-truth-runtime-activation-grant-verification-v1" ||
  policy.signatureAlgorithm !== "Ed25519" ||
  policy.signatureVersion !== "evavo_documentation_truth_runtime_activation_ed25519_v1" ||
  policy.workerClass !== "documentation-truth" ||
  policy.workClass !== "capability-manifest-maintenance" ||
  policy.routeId !== "codex-spark-pro" ||
  policy.capacityClass !== "included-consumer" ||
  policy.maximumGrantLifetimeSeconds !== 900 ||
  policy.maximumUses !== 1 ||
  policy.maximumConcurrency !== 1 ||
  policy.privateKeyAccepted !== false ||
  policy.privateKeyStoredInRepository !== false ||
  policy.trustAnchorStoredInRepository !== false
) errors.push("Agent Infrastructure runtime activation verifier policy identity is invalid.");
for (const [name, value] of Object.entries(policy.authority ?? {})) {
  if (value !== false) errors.push(`Runtime activation verifier must keep authority.${name}=false.`);
}

for (const key of ["trustSchema", "verificationSchema"]) {
  const schema = json[key] ?? {};
  if (
    schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
    schema.type !== "object" || schema.additionalProperties !== false
  ) errors.push(`${files[key]} must be a closed Draft 2020-12 object.`);
}
if (
  json.trustSchema?.properties?.privateKeyPresent?.const !== false ||
  json.trustSchema?.properties?.repositoryStored?.const !== false ||
  json.trustSchema?.properties?.modelAccessible?.const !== false
) errors.push("Agent Infrastructure trust anchor schema is unsafe.");
for (const field of [
  "leaseAcquired", "modelTurnPerformed", "queueMutationPerformed", "repositoryMutationPerformed",
  "commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed",
  "financialActionPerformed", "paidFallbackUsed", "privateKeyAccessed",
]) {
  if (json.verificationSchema?.properties?.[field]?.const !== false) {
    errors.push(`Agent Infrastructure verification schema must keep ${field}=false.`);
  }
}
if (
  json.verificationSchema?.properties?.remainingUses?.const !== 1 ||
  json.verificationSchema?.properties?.maximumConcurrency?.const !== 1 ||
  json.verificationSchema?.properties?.workerClass?.const !== "documentation-truth" ||
  json.verificationSchema?.properties?.workClass?.const !== "capability-manifest-maintenance" ||
  json.verificationSchema?.properties?.routeId?.const !== "codex-spark-pro" ||
  json.verificationSchema?.properties?.capacityClass?.const !== "included-consumer"
) errors.push("Agent Infrastructure verification schema class, use or concurrency boundary is invalid.");

function requireTokens(label, text, tokens) {
  for (const token of tokens) if (!text.includes(token)) errors.push(`${label} is missing token: ${token}`);
}
function forbidTokens(label, text, tokens) {
  for (const token of tokens) if (text.includes(token)) errors.push(`${label} contains forbidden token: ${token}`);
}

requireTokens("Runtime activation verifier core", source.core, [
  "evavo_documentation_truth_runtime_activation_ed25519_v1",
  "verifyDocumentationTruthRuntimeActivationGrant",
  "normalizeGrantBody",
  "validateTrustAnchor",
  "validateRequest",
  "maximumUses must equal one",
  "maximumConcurrency must equal one",
  "must require fresh route admission",
  "must require atomic lease consumption",
  "Signed grant body differs from the exact unsigned request",
  "Signed grant key identity differs from the trusted external key",
  "signature is invalid",
  "not currently valid",
  "already been consumed",
  "leaseAcquired: false",
  "modelTurnPerformed: false",
  "queueMutationPerformed: false",
  "repositoryMutationPerformed: false",
  "publicationPerformed: false",
  "paidFallbackUsed: false",
  "privateKeyAccessed: false",
]);
requireTokens("Runtime activation verifier CLI", source.cli, [
  "verifyDocumentationTruthRuntimeActivationGrantFiles",
  "Signed runtime activation grant envelope",
  "Runtime activation trust anchor",
  "Runtime activation grant request",
  "requestBytesSha256",
  "envelopeBytesSha256",
  "trustAnchorBytesSha256",
  "verificationSha256",
]);
requireTokens("Runtime activation verifier tests", source.tests, [
  "exact request, signed envelope and external trust anchor must agree",
  "expiry, prior use, source/request drift, key drift, unsafe trust and signature tampering fail closed",
  "consumedUses: 1",
  "wrong-runtime-key",
  "privateKeyPresent: true",
  "signature is invalid",
]);
for (const [label, text] of [["Runtime activation verifier core", source.core], ["Runtime activation verifier CLI", source.cli]]) {
  forbidTokens(label, text, [
    "privateKeyPkcs8Base64",
    "subtle.sign",
    "generateKey",
    "writeFileSync",
    "spawnSync",
    "execFileSync",
    "git push",
    "git commit",
    "lease-next",
    "run-codex-worker-dispatch",
    "mainline-publish",
    "process.env",
  ]);
}

for (const relativePath of [files.core, files.cli, files.tests, "scripts/check-documentation-truth-runtime-activation-verifier-contract.mjs"]) {
  const syntax = spawnSync(process.execPath, ["--check", relativePath], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
  });
  if (syntax.status !== 0) errors.push(`${relativePath} failed Node syntax validation: ${String(syntax.stderr || syntax.stdout).trim()}`);
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
    },
  });
  if (completed.status !== 0) {
    errors.push(`${files.tests} failed: ${String(completed.stderr || completed.stdout).trim()}`);
  }
}

if (errors.length > 0) {
  console.error("Agent Infrastructure documentation-truth runtime activation verifier contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Agent Infrastructure documentation-truth runtime activation verifier contract passed.");
console.log("- exact request, externally signed envelope and external public key are independently verified");
console.log("- expiry, prior use, request/source drift, key drift, unsafe trust and signature tampering fail closed");
console.log("- no private key, signing, grant consumption, queue, lease, model, repository or publication effect is available");
