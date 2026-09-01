#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-doc-truth-acceptance-"));
const NOW = "2026-09-01T11:00:00.000Z";
const ADAPTER_PATH = path.join(ROOT, "config", "codex-worker-adapter-v1.json");
const ROUTES_PATH = path.join(ROOT, "config", "worker-capacity-routing-v1.json");
const POLICY_PATH = path.join(ROOT, "config", "codex-documentation-truth-physical-acceptance-v1.json");
const DISPATCH_POLICY_PATH = path.join(ROOT, "config", "codex-documentation-truth-dispatch-v1.json");
const sha = (character, length = 64) => character.repeat(length);

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
const canonical = (value) => JSON.stringify(ordered(value));
const digest = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).digest("hex");

const adapter = {
  schemaVersion: 1,
  kind: "evavo-codex-worker-adapter-v1",
  executable: "codex",
  dispatch: {
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessExpected: false,
    apiKeyEnvironmentVariablesMustBeRemoved: ["OPENAI_API_KEY"],
    paidFallbackAllowed: false,
    publicationAuthority: false,
    validationAuthority: false
  },
  spark: {
    routeId: "codex-spark-pro",
    preferredModel: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer"
  }
};
const routes = {
  schemaVersion: 1,
  kind: "evavo-worker-capacity-routing",
  workerRoutes: [{
    id: "codex-spark-pro",
    runtime: "codex",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    workerClasses: ["test-generation", "documentation-truth"],
    maximumAutomaticConcurrency: 1,
    paidFallbackAllowed: false
  }]
};
const originals = new Map();
for (const [file, document] of [[ADAPTER_PATH, adapter], [ROUTES_PATH, routes]]) {
  originals.set(file, fs.existsSync(file) ? fs.readFileSync(file) : null);
  fs.writeFileSync(file, JSON.stringify(document, null, 2) + "\n");
}

function capability(patch = {}) {
  return {
    schemaVersion: 1,
    kind: "evavo-codex-worker-capability-probe-v1",
    observedAt: "2026-09-01T10:59:30.000Z",
    version: "codex-cli 1.2.3",
    eligibleForWorkerDispatch: true,
    capabilities: {
      jsonFlag: "--json",
      modelFlag: "--model",
      sandboxFlag: "--sandbox",
      approvalFlag: "--ask-for-approval"
    },
    ...patch
  };
}

function buildReceipt(capabilityBytes, patch = {}) {
  const policyBytes = fs.readFileSync(POLICY_PATH);
  const dispatchPolicyBytes = fs.readFileSync(DISPATCH_POLICY_PATH);
  const adapterBytes = fs.readFileSync(ADAPTER_PATH);
  const routeBytes = fs.readFileSync(ROUTES_PATH);
  const policy = JSON.parse(policyBytes);
  const fingerprintIdentity = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-acceptance-fingerprint-v1",
    policySha256: digest(policyBytes),
    dispatchPolicySha256: digest(dispatchPolicyBytes),
    adapterSha256: digest(adapterBytes),
    routeConfigSha256: digest(routeBytes),
    routeId: policy.routeId,
    modelPreference: policy.modelPreference,
    capacityClass: policy.capacityClass,
    authenticationClass: policy.requiredAuthenticationClass,
    sandboxMode: policy.sandboxMode,
    approvalPolicy: policy.approvalPolicy,
    workerClasses: policy.workerClasses,
    maximumConcurrency: policy.maximumConcurrency,
    codexVersion: "codex-cli 1.2.3"
  };
  const evidence = Object.fromEntries(policy.requiredEvidence.map((key, index) => [key, { sha256: sha((index % 9 + 1).toString()), byteLength: 100 + index }]));
  evidence["fresh-codex-capability-probe"] = { sha256: digest(capabilityBytes), byteLength: capabilityBytes.length };
  const body = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-physical-acceptance-v1",
    acceptedAt: "2026-09-01T10:58:00.000Z",
    routeId: policy.routeId,
    modelPreference: policy.modelPreference,
    capacityClass: policy.capacityClass,
    authenticationClass: policy.requiredAuthenticationClass,
    sandboxMode: policy.sandboxMode,
    approvalPolicy: policy.approvalPolicy,
    workerClasses: policy.workerClasses,
    maximumConcurrency: policy.maximumConcurrency,
    codexVersion: "codex-cli 1.2.3",
    fixtureOnly: true,
    modelTurnCompleted: true,
    structuredTurnCompleted: true,
    successPathProven: true,
    noActionPathProven: true,
    pathBoundaryRejectionProven: true,
    currentHeadMismatchRejectionProven: true,
    authPolicyAccepted: true,
    apiKeyEnvironmentAbsent: true,
    paidFallbackUsed: false,
    candidateAuditAccepted: true,
    deterministicValidationPassed: true,
    primaryCheckoutUnchanged: true,
    workerCommitPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    cleanupComplete: true,
    acceptanceFingerprintSha256: digest(canonical(fingerprintIdentity)),
    evidence,
    ...patch
  };
  return { ...body, receiptSha256: digest(canonical(body)) };
}

function execute({ capabilityPatch = {}, receiptPatch = {}, corruptReceiptAfterHash = null } = {}) {
  const cap = capability(capabilityPatch);
  const capBytes = Buffer.from(JSON.stringify(cap), "utf8");
  let receipt = buildReceipt(capBytes, receiptPatch);
  if (typeof corruptReceiptAfterHash === "function") receipt = corruptReceiptAfterHash(receipt);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const capPath = path.join(TEMP, `cap-${suffix}.json`);
  const receiptPath = path.join(TEMP, `receipt-${suffix}.json`);
  fs.writeFileSync(capPath, capBytes);
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  const result = spawnSync(process.execPath, [
    "scripts/verify-codex-documentation-truth-physical-acceptance.mjs",
    receiptPath,
    capPath,
    "--now",
    NOW
  ], { cwd: ROOT, encoding: "utf8", shell: false, timeout: 120_000 });
  const channel = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  return { result, document: JSON.parse(String(channel).trim()), capability: cap, receipt };
}

try {
  {
    const first = execute();
    assert.equal(first.result.status, 0, first.result.stderr);
    assert.equal(first.document.accepted, true);
    assert.deepEqual(first.document.workerClasses, ["documentation-truth"]);
    assert.equal(first.document.maximumConcurrency, 1);
    assert.equal(first.document.paidFallbackAllowed, false);
    assert.equal(first.document.modelTurnPerformed, false);
    assert.equal(first.document.deterministicValidationPerformed, false);
    assert.equal(first.document.publicationPerformed, false);
    assert.match(first.document.verificationSha256, /^[0-9a-f]{64}$/);
    const body = { ...first.document };
    const observed = body.verificationSha256;
    delete body.verificationSha256;
    assert.equal(observed, digest(canonical(body)));
    const second = execute().document;
    assert.equal(first.document.verificationSha256, second.verificationSha256, "fixed acceptance verification must be deterministic");
  }

  {
    const outcome = execute({ receiptPatch: { acceptedAt: "2026-08-20T10:58:00.000Z" } });
    assert.equal(outcome.result.status, 1);
    assert.ok(outcome.document.errors.some((value) => /expired/.test(value)));
  }

  {
    const original = fs.readFileSync(ROUTES_PATH);
    const changed = structuredClone(routes);
    changed.workerRoutes[0].workerClasses = ["test-generation"];
    fs.writeFileSync(ROUTES_PATH, JSON.stringify(changed, null, 2) + "\n");
    const outcome = execute();
    assert.equal(outcome.result.status, 1);
    assert.ok(outcome.document.errors.some((value) => /does not physically admit documentation-truth/.test(value)));
    fs.writeFileSync(ROUTES_PATH, original);
  }

  {
    const outcome = execute({ corruptReceiptAfterHash: (receipt) => ({ ...receipt, noActionPathProven: false }) });
    assert.equal(outcome.result.status, 1);
    assert.ok(outcome.document.errors.some((value) => /receipt SHA-256 is invalid/.test(value)));
  }

  {
    const outcome = execute({ receiptPatch: { deterministicValidationPassed: false } });
    assert.equal(outcome.result.status, 1);
    assert.ok(outcome.document.errors.some((value) => /deterministicValidationPassed/.test(value)));
  }

  {
    const outcome = execute({ capabilityPatch: { version: "codex-cli 2.0.0" } });
    assert.equal(outcome.result.status, 1);
    assert.ok(outcome.document.errors.some((value) => /Codex version changed/.test(value)));
  }

  {
    const outcome = execute({ receiptPatch: { evidence: {} } });
    assert.equal(outcome.result.status, 1);
    assert.ok(outcome.document.errors.some((value) => /Acceptance evidence/.test(value)));
  }

  console.log("Codex documentation-truth physical-acceptance verifier tests passed.");
  console.log("- exact policy, adapter, route configuration, capability bytes and Codex version are fingerprinted");
  console.log("- only documentation-truth at zero-paid-fallback concurrency one is admitted");
  console.log("- stale, tampered, incomplete, route-drifted and version-drifted acceptance fails closed");
  console.log("- verification performs no model, candidate, primary-repository, validation, Git, publication or deployment effect");
} finally {
  for (const [file, bytes] of originals) {
    if (bytes === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, bytes);
  }
  fs.rmSync(TEMP, { recursive: true, force: true });
}
