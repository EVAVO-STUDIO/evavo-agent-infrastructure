#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { compileCodexSparkRouteAdmission } from "./codex-spark-route-admission-core.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const nowMs = Date.now();
const now = new Date(nowMs).toISOString();
const acceptance = {
  schemaVersion: 1,
  kind: "evavo-codex-spark-safe-physical-acceptance-v1",
  supervisedAt: now,
  supervision: {
    cleanupComplete: true,
    stagedAcceptancePromotedOnlyAfterCleanup: true,
    fixtureRepositoryMainUnchanged: true,
    fixtureRepositoryClean: true,
    fixtureRepositoryRemoteCount: 0,
    registeredWorktreesAfterCleanup: 1,
    publicationPerformed: false,
    productRepositoryTouched: false,
  },
};
const capability = {
  schemaVersion: 1,
  kind: "evavo-codex-worker-capability-probe-v1",
  eligibleForWorkerDispatch: true,
  observedAt: now,
  version: "fixture-codex",
  capabilities: {
    jsonFlag: "--json",
    modelFlag: "--model",
    sandboxFlag: "--sandbox",
    approvalFlag: "--ask-for-approval",
  },
};
const authentication = {
  schemaVersion: 1,
  kind: "evavo-codex-chatgpt-auth-observation-v1",
  observedAt: now,
  accepted: true,
  authPolicyAccepted: true,
  authenticationClass: "chatgpt-consumer",
  chatgptOnly: true,
  apiKeyAllowed: false,
  apiLoginAllowed: false,
  mixedLoginAllowed: false,
  providerApiCredentialsRequired: false,
  credentialValuesRead: false,
};
const acceptanceBytes = jsonBytes(acceptance);
const capabilityBytes = jsonBytes(capability);
const authenticationBytes = jsonBytes(authentication);
const physicalVerification = {
  schemaVersion: 1,
  kind: "evavo-codex-spark-safe-physical-acceptance-verification-v1",
  accepted: true,
  observedAt: now,
  routeId: "codex-spark-pro",
  modelPreference: "gpt-5.3-codex-spark",
  capacityClass: "included-consumer",
  workerClasses: ["test-generation"],
  maximumConcurrency: 1,
  paidFallbackAllowed: false,
  supervisedCleanupProven: true,
  supervisedAcceptanceSha256: sha256(acceptanceBytes),
  codexCapabilityReceiptSha256: sha256(capabilityBytes),
  baseVerificationSha256: "d".repeat(64),
};
const baseVerification = {
  schemaVersion: 1,
  kind: "evavo-codex-spark-safe-physical-acceptance-verification-v1",
  accepted: true,
  supervisedCleanupProven: true,
  routeId: "codex-spark-pro",
  modelPreference: "gpt-5.3-codex-spark",
  workerClasses: ["test-generation"],
  maximumConcurrency: 1,
  paidFallbackAllowed: false,
  errors: [],
};

function compile(patch = {}) {
  const effectiveAcceptance = patch.acceptance ?? acceptance;
  const effectiveCapability = patch.capability ?? capability;
  const effectiveAuthentication = patch.authentication ?? authentication;
  const effectivePhysical = patch.physicalVerification ?? physicalVerification;
  return compileCodexSparkRouteAdmission({
    acceptanceBytes: patch.acceptanceBytes ?? acceptanceBytes,
    capabilityBytes: patch.capabilityBytes ?? capabilityBytes,
    authenticationBytes: patch.authenticationBytes ?? authenticationBytes,
    physicalVerificationBytes: patch.physicalVerificationBytes ?? jsonBytes(effectivePhysical),
    acceptance: effectiveAcceptance,
    capability: effectiveCapability,
    authentication: effectiveAuthentication,
    physicalVerification: effectivePhysical,
    baseVerification: patch.baseVerification ?? baseVerification,
    nowMs: patch.nowMs ?? nowMs,
    ttlSeconds: patch.ttlSeconds ?? 600,
  });
}

const admission = compile();
assert.equal(admission.schemaVersion, 1);
assert.equal(admission.kind, "evavo-codex-spark-route-admission-v1");
assert.equal(admission.accepted, true);
assert.equal(admission.admitted, true);
assert.equal(admission.eligible, true);
assert.equal(admission.routeId, "codex-spark-pro");
assert.equal(admission.modelPreference, "gpt-5.3-codex-spark");
assert.equal(admission.capacityClass, "included-consumer");
assert.equal(admission.authenticationClass, "chatgpt-consumer");
assert.deepEqual(admission.workerClasses, ["test-generation"]);
assert.deepEqual(admission.admittedWorkerClasses, ["test-generation"]);
assert.equal(admission.maximumConcurrency, 1);
assert.equal(admission.admittedMaximumConcurrency, 1);
assert.equal(admission.paidFallbackAllowed, false);
assert.equal(admission.paidFallbackUsed, false);
assert.equal(admission.supervisedAcceptanceSha256, sha256(acceptanceBytes));
assert.equal(admission.codexCapabilityReceiptSha256, sha256(capabilityBytes));
assert.equal(admission.chatgptAuthenticationReceiptSha256, sha256(authenticationBytes));
assert.equal(admission.physicalAcceptanceVerificationSha256, sha256(jsonBytes(physicalVerification)));
assert.equal(admission.bindings.basePhysicalVerificationSha256, physicalVerification.baseVerificationSha256);
assert.equal(admission.capacityAvailabilityProven, false);
assert.equal(admission.modelTurnPerformed, false);
assert.equal(admission.repositoryMutationPerformed, false);
assert.equal(admission.publicationPerformed, false);
assert.equal(Date.parse(admission.expiresAt) - Date.parse(admission.admittedAt), 600_000);

const rejected = [
  [{ acceptance: { ...acceptance, supervision: { ...acceptance.supervision, cleanupComplete: false } } }, /cleanup/i],
  [{ acceptance: { ...acceptance, supervision: { ...acceptance.supervision, productRepositoryTouched: true } } }, /fixture-only authority/i],
  [{ capability: { ...capability, eligibleForWorkerDispatch: false } }, /not eligible/i],
  [{ capability: { ...capability, capabilities: { ...capability.capabilities, jsonFlag: null } } }, /jsonFlag/i],
  [{ authentication: { ...authentication, accepted: false } }, /authentication is not accepted/i],
  [{ authentication: { ...authentication, apiKeyAllowed: true } }, /API\/mixed login/i],
  [{ physicalVerification: { ...physicalVerification, workerClasses: ["fast-coding"] } }, /exactly test-generation/i],
  [{ physicalVerification: { ...physicalVerification, maximumConcurrency: 2 } }, /concurrency one/i],
  [{ physicalVerification: { ...physicalVerification, paidFallbackAllowed: true } }, /paid fallback/i],
  [{ physicalVerification: { ...physicalVerification, supervisedAcceptanceSha256: "0".repeat(64) } }, /exact acceptance and capability bytes/i],
  [{ physicalVerification: { ...physicalVerification, codexCapabilityReceiptSha256: "0".repeat(64) } }, /exact acceptance and capability bytes/i],
  [{ physicalVerification: { ...physicalVerification, baseVerificationSha256: null } }, /base-verification SHA-256/i],
  [{ baseVerification: { ...baseVerification, accepted: false } }, /not accepted/i],
  [{ baseVerification: { ...baseVerification, workerClasses: ["test-generation", "fast-coding"] } }, /exactly test-generation/i],
  [{ ttlSeconds: 601 }, /TTL/i],
  [{ ttlSeconds: 59 }, /TTL/i],
];
for (const [patch, expected] of rejected) assert.throws(() => compile(patch), expected);

const staleAuthentication = {
  ...authentication,
  observedAt: new Date(nowMs - 20 * 60_000).toISOString(),
};
assert.throws(() => compile({ authentication: staleAuthentication }), /authentication observation is stale/i);
const staleCapability = {
  ...capability,
  observedAt: new Date(nowMs - 20 * 60_000).toISOString(),
};
assert.throws(() => compile({ capability: staleCapability }), /capability is stale/i);
const stalePhysical = {
  ...physicalVerification,
  observedAt: new Date(nowMs - 20 * 60_000).toISOString(),
};
assert.throws(() => compile({ physicalVerification: stalePhysical }), /physical verification observation is stale/i);

const cliPath = path.join(process.cwd(), "scripts", "compile-codex-spark-route-admission.mjs");
const syntax = spawnSync(process.execPath, ["--check", cliPath], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: false,
});
assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
const cliSource = fs.readFileSync(cliPath, "utf8");
assert.ok(cliSource.includes("verify-codex-spark-safe-physical-acceptance.mjs"));
assert.ok(cliSource.includes("compileCodexSparkRouteAdmission"));
assert.ok(cliSource.includes("shell: false"));
assert.ok(!cliSource.includes("run-codex-worker-dispatch.mjs"));

console.log("Codex Spark route-admission tests passed.");
console.log("- admission binds exact supervised acceptance, capability, ChatGPT authentication and physical-verification bytes");
console.log("- admission remains Test Builder only, concurrency one, short-lived and explicitly non-capacity");
console.log("- stale evidence, API/mixed auth, cleanup drift, class/concurrency escalation and paid fallback fail closed");
console.log("- the CLI reruns supervised physical verification without starting Codex or granting mutation/publication authority");
