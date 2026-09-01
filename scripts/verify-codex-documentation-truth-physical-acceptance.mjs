#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_BYTES = 8 * 1024 * 1024;

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
const canonical = (value) => JSON.stringify(ordered(value));
const sha256 = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).digest("hex");

function readJsonBytes(input, label, maximum = MAX_BYTES) {
  const resolved = fs.realpathSync.native(path.resolve(input));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximum) throw new Error(`${label} must be a bounded regular non-symlink file.`);
  const bytes = fs.readFileSync(resolved);
  let document;
  try { document = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} is not valid UTF-8 JSON.`); }
  if (!OBJECT(document)) throw new Error(`${label} must contain a JSON object.`);
  return { resolved, bytes, sha256: sha256(bytes), document };
}
function owned(relative, label) { return readJsonBytes(path.join(ROOT, relative), label, 2 * 1024 * 1024); }
function parseTime(value, label) {
  if (typeof value !== "string" || value.length > 64) throw new Error(`${label} is invalid.`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return milliseconds;
}
function parseArguments(argv) {
  if (argv.length !== 2 && argv.length !== 4) throw new Error("Usage: node scripts/verify-codex-documentation-truth-physical-acceptance.mjs <acceptance-receipt.json> <fresh-capability.json> [--now <iso-8601>]");
  const [receiptInput, capabilityInput, option, nowInput] = argv;
  if (argv.length === 4 && option !== "--now") throw new Error("Only --now is accepted as an optional argument.");
  return { receiptInput, capabilityInput, nowInput };
}
function equalStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}
function safeError(value) {
  return String(value ?? "documentation-truth physical acceptance verification failed")
    .replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>")
    .replace(/(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi, "credential=<redacted>")
    .slice(0, 1600);
}

let receiptSource = null;
let capabilitySource = null;
try {
  const { receiptInput, capabilityInput, nowInput } = parseArguments(process.argv.slice(2));
  const policySource = owned("config/codex-documentation-truth-physical-acceptance-v1.json", "documentation-truth physical acceptance policy");
  const dispatchPolicySource = owned("config/codex-documentation-truth-dispatch-v1.json", "documentation-truth dispatch policy");
  const adapterSource = owned("config/codex-worker-adapter-v1.json", "Codex worker adapter");
  const routesSource = owned("config/worker-capacity-routing-v1.json", "worker capacity routing policy");
  receiptSource = readJsonBytes(receiptInput, "documentation-truth physical acceptance receipt");
  capabilitySource = readJsonBytes(capabilityInput, "fresh Codex capability receipt");
  const policy = policySource.document;
  const dispatchPolicy = dispatchPolicySource.document;
  const adapter = adapterSource.document;
  const routes = routesSource.document;
  const receipt = receiptSource.document;
  const capability = capabilitySource.document;
  const now = nowInput ? parseTime(nowInput, "--now") : Date.now();
  const errors = [];

  if (policy.schemaVersion !== 1 || policy.kind !== "evavo-codex-documentation-truth-physical-acceptance-policy-v1") errors.push("Physical acceptance policy identity is invalid.");
  if (dispatchPolicy.schemaVersion !== 1 || dispatchPolicy.kind !== "evavo-codex-documentation-truth-dispatch-policy-v1") errors.push("Documentation-truth dispatch policy identity is invalid.");
  if (adapter.schemaVersion !== 1 || adapter.kind !== "evavo-codex-worker-adapter-v1") errors.push("Codex worker adapter identity is invalid.");
  if (routes.schemaVersion !== 1 || routes.kind !== "evavo-worker-capacity-routing") errors.push("Worker capacity routing identity is invalid.");

  if (receipt.schemaVersion !== 1 || receipt.kind !== "evavo-codex-documentation-truth-physical-acceptance-v1") errors.push("Acceptance receipt kind/schema is invalid.");
  const receiptBody = { ...receipt };
  const suppliedReceiptSha = receiptBody.receiptSha256;
  delete receiptBody.receiptSha256;
  if (!SHA256.test(String(suppliedReceiptSha ?? "")) || sha256(canonical(receiptBody)) !== suppliedReceiptSha) errors.push("Acceptance receipt SHA-256 is invalid.");
  if (receipt.routeId !== policy.routeId || receipt.modelPreference !== policy.modelPreference || receipt.capacityClass !== policy.capacityClass) errors.push("Acceptance route, model or capacity differs from policy.");
  if (receipt.authenticationClass !== policy.requiredAuthenticationClass || receipt.sandboxMode !== policy.sandboxMode || receipt.approvalPolicy !== policy.approvalPolicy) errors.push("Acceptance authentication, sandbox or approval posture differs from policy.");
  if (!equalStrings(receipt.workerClasses, policy.workerClasses) || receipt.maximumConcurrency !== policy.maximumConcurrency) errors.push("Acceptance worker class or concurrency differs from policy.");
  if (receipt.paidFallbackUsed !== false) errors.push("Acceptance does not prove zero paid fallback.");
  for (const [field, expected] of Object.entries(policy.requiredTruth ?? {})) {
    if (receipt[field] !== expected) errors.push(`Acceptance truth ${field} must equal ${JSON.stringify(expected)}.`);
  }

  const acceptedAt = parseTime(receipt.acceptedAt, "acceptance acceptedAt");
  const maximumAgeMs = Number(policy.maximumAcceptanceAgeHours) * 60 * 60 * 1000;
  if (acceptedAt - now > Number(policy.maximumFutureClockSkewSeconds) * 1000 || now - acceptedAt > maximumAgeMs) errors.push("Acceptance receipt is expired or future-dated.");

  if (capability.schemaVersion !== 1 || capability.kind !== "evavo-codex-worker-capability-probe-v1" || capability.eligibleForWorkerDispatch !== true) errors.push("Fresh eligible Codex capability receipt is required.");
  const capabilityAt = parseTime(capability.observedAt, "capability observedAt");
  if (capabilityAt - now > Number(policy.maximumFutureClockSkewSeconds) * 1000 || now - capabilityAt > Number(policy.maximumCapabilityAgeSeconds) * 1000) errors.push("Codex capability receipt is stale or future-dated.");
  if (receipt.codexVersion !== capability.version) errors.push("Codex version changed since documentation-truth acceptance.");
  for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) if (typeof capability.capabilities?.[key] !== "string" || !capability.capabilities[key]) errors.push(`Fresh capability lacks ${key}.`);

  const route = (routes.workerRoutes ?? []).find((entry) => entry?.id === policy.routeId);
  if (!OBJECT(route) || route.modelPreference !== policy.modelPreference || route.capacityClass !== policy.capacityClass || route.paidFallbackAllowed !== false || route.maximumAutomaticConcurrency !== 1 || !Array.isArray(route.workerClasses) || !route.workerClasses.includes("documentation-truth")) {
    errors.push("Current Spark route does not physically admit documentation-truth at zero-paid-fallback concurrency one.");
  }
  if (adapter.spark?.routeId !== policy.routeId || adapter.spark?.preferredModel !== policy.modelPreference || adapter.spark?.capacityClass !== policy.capacityClass) errors.push("Current Codex adapter route/model/capacity differs from policy.");
  if (adapter.dispatch?.sandboxMode !== policy.sandboxMode || adapter.dispatch?.approvalPolicy !== policy.approvalPolicy || adapter.dispatch?.networkAccessExpected !== false || adapter.dispatch?.paidFallbackAllowed !== false || adapter.dispatch?.publicationAuthority !== false || adapter.dispatch?.validationAuthority !== false) {
    errors.push("Current Codex adapter exceeds the accepted sandbox, network, cost, publication or validation boundary.");
  }

  const evidence = receipt.evidence;
  if (!OBJECT(evidence)) errors.push("Acceptance evidence map is missing.");
  else {
    for (const key of policy.requiredEvidence ?? []) {
      const item = evidence[key];
      if (!OBJECT(item) || !SHA256.test(String(item.sha256 ?? "")) || !Number.isInteger(item.byteLength) || item.byteLength < 2) errors.push(`Acceptance evidence ${key} lacks a bounded SHA-256 identity.`);
    }
    if (evidence["fresh-codex-capability-probe"]?.sha256 !== capabilitySource.sha256 || evidence["fresh-codex-capability-probe"]?.byteLength !== capabilitySource.bytes.length) {
      errors.push("Acceptance capability evidence differs from the fresh capability bytes.");
    }
  }

  const fingerprintIdentity = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-acceptance-fingerprint-v1",
    policySha256: policySource.sha256,
    dispatchPolicySha256: dispatchPolicySource.sha256,
    adapterSha256: adapterSource.sha256,
    routeConfigSha256: routesSource.sha256,
    routeId: policy.routeId,
    modelPreference: policy.modelPreference,
    capacityClass: policy.capacityClass,
    authenticationClass: policy.requiredAuthenticationClass,
    sandboxMode: policy.sandboxMode,
    approvalPolicy: policy.approvalPolicy,
    workerClasses: policy.workerClasses,
    maximumConcurrency: policy.maximumConcurrency,
    codexVersion: receipt.codexVersion
  };
  const expectedFingerprint = sha256(canonical(fingerprintIdentity));
  if (receipt.acceptanceFingerprintSha256 !== expectedFingerprint) errors.push("Acceptance fingerprint differs from current policy, adapter, route configuration or Codex version.");

  const accepted = errors.length === 0;
  const verificationBody = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-physical-acceptance-verification-v1",
    accepted,
    routeId: accepted ? policy.routeId : null,
    modelPreference: accepted ? policy.modelPreference : null,
    capacityClass: accepted ? policy.capacityClass : null,
    workerClasses: accepted ? policy.workerClasses : [],
    maximumConcurrency: accepted ? policy.maximumConcurrency : 0,
    acceptanceReceiptSha256: receiptSource.sha256,
    capabilityReceiptSha256: capabilitySource.sha256,
    acceptanceFingerprintSha256: accepted ? expectedFingerprint : null,
    paidFallbackAllowed: false,
    errors,
    modelTurnPerformed: false,
    candidateWorktreeMutationPerformed: false,
    primaryRepositoryMutationPerformed: false,
    deterministicValidationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    truthBoundary: "This verifier admits only documentation-truth at concurrency one when current route, adapter, capability bytes and supervised fixture evidence still match. It performs no model, validation, repository, Git, publication or deployment effect."
  };
  process.stdout.write(`${JSON.stringify({ ...verificationBody, verificationSha256: sha256(canonical(verificationBody)) }, null, 2)}\n`);
  process.exitCode = accepted ? 0 : 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-physical-acceptance-verification-v1",
    accepted: false,
    acceptanceReceiptSha256: receiptSource?.sha256 ?? null,
    capabilityReceiptSha256: capabilitySource?.sha256 ?? null,
    errors: [safeError(error?.message ?? error)],
    paidFallbackAllowed: false,
    modelTurnPerformed: false,
    candidateWorktreeMutationPerformed: false,
    primaryRepositoryMutationPerformed: false,
    deterministicValidationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false
  }, null, 2)}\n`);
  process.exitCode = 1;
}
