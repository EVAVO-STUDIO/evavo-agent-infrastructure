#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputs = process.argv.slice(2);
if (inputs.length !== 8) {
  console.error(
    "Usage: node scripts/compile-codex-spark-capacity-heartbeat-dispatch.mjs " +
      "<heartbeat-plan.json> <work-exchange-status.json> <effective-capacity.json> " +
      "<codex-capability.json> <chatgpt-auth.json> <physical-verification.json> " +
      "<route-admission.json> <supervised-acceptance.json>",
  );
  process.exit(2);
}

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const FUTURE_TOLERANCE_MS = 120_000;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isSha256 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

function readJson(input, label) {
  const resolved = fs.realpathSync.native(path.resolve(input));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  if (stat.size < 2 || stat.size > MAX_INPUT_BYTES) throw new Error(`${label} size is outside the bounded contract.`);
  const bytes = fs.readFileSync(resolved);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must contain UTF-8 JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain one JSON object.`);
  return { value, bytes, sha256: sha256(bytes) };
}
function firstValue(object, names) {
  for (const name of names) if (object?.[name] !== undefined && object?.[name] !== null) return object[name];
  return null;
}
function binding(object, name) {
  return object?.[name] ?? object?.bindings?.[name] ?? object?.evidenceBindings?.[name] ?? object?.admissionBindings?.[name] ?? null;
}
function freshTimestamp(object, names, maximumAgeMs, now) {
  const raw = firstValue(object, names);
  const parsed = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) && now - parsed <= maximumAgeMs && parsed - now <= FUTURE_TOLERANCE_MS;
}

const [planEvidence, queueEvidence, capacityEvidence, capabilityEvidence, authEvidence, physicalEvidence, admissionEvidence, acceptanceEvidence] = inputs.map((input, index) =>
  readJson(input, [
    "capacity-heartbeat plan",
    "Work Exchange status",
    "effective-capacity status",
    "Codex capability receipt",
    "ChatGPT authentication receipt",
    "physical-acceptance verification",
    "route admission",
    "supervised physical acceptance",
  ][index]),
);
const policy = readJson(path.join(ROOT, "config", "codex-spark-capacity-observation-policy-v1.json"), "capacity-observation policy").value;
const adapter = readJson(path.join(ROOT, "config", "codex-worker-adapter-v1.json"), "Codex worker adapter").value;
const plan = planEvidence.value;
const queue = queueEvidence.value;
const capacity = capacityEvidence.value;
const capability = capabilityEvidence.value;
const auth = authEvidence.value;
const physical = physicalEvidence.value;
const admission = admissionEvidence.value;
const acceptance = acceptanceEvidence.value;
const errors = [];
const now = Date.now();

if (plan.schemaVersion !== 1 || plan.kind !== "evavo-codex-spark-capacity-probe-plan-v1" || plan.eligible !== true || plan.decision !== "PROBE_ELIGIBLE") {
  errors.push("Capacity-heartbeat plan is not effect-eligible.");
}
if (plan.routeId !== policy.routeId || plan.modelPreference !== policy.modelPreference || plan.capacityClass !== policy.capacityClass) {
  errors.push("Capacity-heartbeat plan route/model/capacity differs from policy.");
}
if (plan.fixtureOnly !== true || plan.maximumConcurrency !== 1 || plan.maximumModelTurns !== 1) errors.push("Capacity-heartbeat plan exceeds fixture-only one-turn authority.");
if (plan.paidFallbackAllowed !== false || plan.paidFallbackUsed !== false) errors.push("Capacity-heartbeat plan violates zero-paid-fallback policy.");
if (plan.workExchangeStatusSha256 !== queueEvidence.sha256) errors.push("Capacity-heartbeat plan is not bound to the exact Work Exchange status.");
if (plan.effectiveCapacityStatusSha256 !== capacityEvidence.sha256) errors.push("Capacity-heartbeat plan is not bound to the exact effective-capacity status.");

const readyCount = Number.isInteger(queue.readyCount) ? queue.readyCount : Number.isInteger(queue.counts?.READY) ? queue.counts.READY : null;
if (readyCount === null || readyCount < 1) errors.push("Capacity heartbeat requires at least one READY work item.");
if (!freshTimestamp(queue, ["observedAt", "recordedAt"], 5 * 60_000, now)) errors.push("Work Exchange status is stale or future-dated.");

if (capacity.schemaVersion !== 1 || capacity.kind !== "evavo-worker-capacity-status-v1" || capacity.ok !== true) errors.push("Effective-capacity status is invalid.");
if (capacity.eligible === true || ["AVAILABLE", "DEGRADED"].includes(capacity.effectiveState)) errors.push("Capacity heartbeat is unnecessary while effective capacity is available.");
if (capacity.paidFallbackAllowed !== false || capacity.paidFallbackUsed !== false) errors.push("Effective-capacity status violates zero-paid-fallback policy.");
for (const gate of ["transport", "authentication", "physicalAdmission", "routeAdmission"]) {
  const value = capacity.evidence?.[gate];
  const positive = gate === "transport"
    ? value?.eligible === true && value?.fresh === true
    : gate === "authentication"
      ? value?.accepted === true && value?.fresh === true
      : gate === "physicalAdmission"
        ? value?.accepted === true && value?.supervisedCleanupProven === true && value?.fresh === true
        : value?.accepted === true && value?.fresh === true;
  if (!positive) errors.push(`Effective-capacity non-capacity gate is not fresh: ${gate}.`);
}
const route = Array.isArray(capacity.routes) ? capacity.routes.find((entry) => entry?.routeId === policy.routeId) : null;
if (!route) errors.push("Effective-capacity status lacks the Spark route.");

if (capability.schemaVersion !== 1 || capability.kind !== "evavo-codex-worker-capability-probe-v1" || capability.eligibleForWorkerDispatch !== true) {
  errors.push("Fresh eligible Codex capability receipt is required.");
}
if (!freshTimestamp(capability, ["observedAt", "recordedAt", "completedAt"], 10 * 60_000, now)) errors.push("Codex capability receipt is stale or future-dated.");
for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
  if (typeof capability.capabilities?.[key] !== "string" || !capability.capabilities[key]) errors.push(`Codex capability receipt lacks ${key}.`);
}

const authKind = String(auth.kind ?? "");
const authAccepted =
  auth.accepted === true || auth.authPolicyAccepted === true || auth.chatgptOnly === true || auth.chatgptConsumerOnly === true || auth.eligibleForConsumerAuth === true;
if (auth.schemaVersion !== 1 || !authKind.includes("codex") || !authKind.includes("auth") || !authAccepted) errors.push("ChatGPT-only authentication receipt is not accepted.");
if (auth.apiKeyAllowed === true || auth.apiLoginAllowed === true || auth.mixedLoginAllowed === true || auth.providerApiCredentialsRequired === true) errors.push("Authentication receipt permits API or mixed login.");
if (!freshTimestamp(auth, ["observedAt", "recordedAt", "completedAt", "verifiedAt"], 10 * 60_000, now)) errors.push("Authentication receipt is stale or future-dated.");

if (physical.schemaVersion !== 1 || physical.kind !== "evavo-codex-spark-safe-physical-acceptance-verification-v1" || physical.accepted !== true || physical.supervisedCleanupProven !== true) {
  errors.push("Supervised physical-acceptance verification is not accepted.");
}
if (physical.routeId !== policy.routeId || physical.modelPreference !== policy.modelPreference || physical.paidFallbackAllowed !== false) errors.push("Physical-acceptance verification differs from policy.");
if (!Array.isArray(physical.workerClasses) || !physical.workerClasses.includes("test-generation") || physical.maximumConcurrency !== 1) errors.push("Physical acceptance does not prove the initial Test Builder/concurrency-one boundary.");
if (!freshTimestamp(physical, ["observedAt", "verifiedAt", "completedAt", "recordedAt", "generatedAt"], 10 * 60_000, now)) errors.push("Physical-acceptance verification is stale or future-dated.");

const admissionKind = String(admission.kind ?? "");
const admissionAccepted = admission.accepted === true || admission.admitted === true || admission.eligible === true;
if (admission.schemaVersion !== 1 || !admissionKind.includes("codex-spark-route-admission") || !admissionAccepted) errors.push("Short-lived route admission is not accepted.");
if (admission.routeId !== policy.routeId || admission.modelPreference !== policy.modelPreference || admission.paidFallbackAllowed !== false || admission.paidFallbackUsed === true) errors.push("Route admission differs from zero-cost policy.");
const admissionExpiry = Date.parse(firstValue(admission, ["expiresAt", "validUntil"]) ?? "");
if (!Number.isFinite(admissionExpiry) || admissionExpiry <= now) errors.push("Route admission is expired or lacks a valid expiry.");
if (!freshTimestamp(admission, ["admittedAt", "issuedAt", "observedAt", "recordedAt"], 10 * 60_000, now)) errors.push("Route admission is stale or future-dated.");

if (acceptance.schemaVersion !== 1 || acceptance.kind !== "evavo-codex-spark-safe-physical-acceptance-v1") errors.push("Supervised physical-acceptance envelope kind/schema is invalid.");
if (acceptance.supervision?.cleanupComplete !== true || acceptance.supervision?.fixtureRepositoryMainUnchanged !== true || acceptance.supervision?.fixtureRepositoryClean !== true || acceptance.supervision?.fixtureRepositoryRemoteCount !== 0 || acceptance.supervision?.registeredWorktreesAfterCleanup !== 1) {
  errors.push("Supervised physical-acceptance envelope lacks required cleanup/fixture truth.");
}
if (acceptance.supervision?.publicationPerformed !== false || acceptance.supervision?.productRepositoryTouched !== false) errors.push("Supervised physical acceptance exceeds fixture-only authority.");

if (route) {
  if (route.codexCapabilityReceiptSha256 !== capabilityEvidence.sha256) errors.push("Effective status is not bound to the exact capability receipt.");
  if (route.physicalAcceptanceVerificationSha256 !== physicalEvidence.sha256) errors.push("Effective status is not bound to the exact physical verification.");
  if (route.routeAdmissionSha256 !== admissionEvidence.sha256) errors.push("Effective status is not bound to the exact route admission.");
  if (route.supervisedAcceptanceSha256 !== acceptanceEvidence.sha256) errors.push("Effective status is not bound to the exact supervised acceptance envelope.");
}
if (capacity.evidence?.authentication?.sha256 !== authEvidence.sha256) errors.push("Effective status is not bound to the exact authentication receipt.");
if (binding(admission, "codexCapabilityReceiptSha256") !== capabilityEvidence.sha256) errors.push("Route admission is not bound to the exact capability receipt.");
if (binding(admission, "physicalAcceptanceVerificationSha256") !== physicalEvidence.sha256) errors.push("Route admission is not bound to the exact physical verification.");
if (binding(admission, "supervisedAcceptanceSha256") !== acceptanceEvidence.sha256) errors.push("Route admission is not bound to the exact supervised acceptance envelope.");
const physicalAcceptanceBinding = binding(physical, "supervisedAcceptanceSha256");
if (physicalAcceptanceBinding !== null && physicalAcceptanceBinding !== acceptanceEvidence.sha256) errors.push("Physical verification disagrees with supervised acceptance identity.");

if (adapter.spark?.routeId !== policy.routeId || adapter.spark?.preferredModel !== policy.modelPreference) errors.push("Codex adapter route/model differs from capacity-observation policy.");
if (adapter.dispatch?.paidFallbackAllowed !== false || adapter.dispatch?.sandboxMode !== "workspace-write" || adapter.dispatch?.approvalPolicy !== "never") errors.push("Codex adapter dispatch policy is not admitted for the heartbeat.");

if (errors.length) {
  console.error(JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-spark-capacity-heartbeat-dispatch-plan-v1",
    eligible: false,
    errors,
    modelTurnPerformed: false,
    paidFallbackUsed: false,
  }, null, 2));
  process.exit(1);
}

const prompt = JSON.stringify({
  task: "EVAVO_CODEX_SPARK_CAPACITY_HEARTBEAT",
  instruction: "Do not modify any file, Git state, dependency, configuration, credential, network setting, or machine setting. Return exactly the required JSON object and nothing else.",
  requiredFinalJson: {
    capacityHeartbeat: "AVAILABLE",
    repositoryMutationPerformed: false,
    commitPerformed: false,
    publicationPerformed: false,
  },
});
if (Buffer.byteLength(prompt, "utf8") > policy.fixtureProbe.maximumPromptBytes) throw new Error("Capacity-heartbeat prompt exceeded policy.");
const invocation = [
  "exec",
  capability.capabilities.jsonFlag,
  capability.capabilities.modelFlag,
  policy.modelPreference,
  capability.capabilities.sandboxFlag,
  adapter.dispatch.sandboxMode,
  capability.capabilities.approvalFlag,
  adapter.dispatch.approvalPolicy,
  "-",
];

console.log(JSON.stringify({
  schemaVersion: 1,
  kind: "evavo-codex-spark-capacity-heartbeat-dispatch-plan-v1",
  eligible: true,
  routeId: policy.routeId,
  modelPreference: policy.modelPreference,
  capacityClass: policy.capacityClass,
  executable: adapter.executable,
  argv: invocation,
  stdinPrompt: prompt,
  fixtureOnly: true,
  maximumModelTurns: 1,
  maximumConcurrency: 1,
  sandboxMode: adapter.dispatch.sandboxMode,
  approvalPolicy: adapter.dispatch.approvalPolicy,
  evidenceBindings: {
    heartbeatPlanSha256: planEvidence.sha256,
    workExchangeStatusSha256: queueEvidence.sha256,
    effectiveCapacityStatusSha256: capacityEvidence.sha256,
    codexCapabilityReceiptSha256: capabilityEvidence.sha256,
    chatgptAuthenticationReceiptSha256: authEvidence.sha256,
    physicalAcceptanceVerificationSha256: physicalEvidence.sha256,
    routeAdmissionSha256: admissionEvidence.sha256,
    supervisedAcceptanceSha256: acceptanceEvidence.sha256,
  },
  fixtureRequirements: {
    temporaryRepository: true,
    remoteCount: 0,
    initialBranch: "main",
    workspaceCleanBefore: true,
    workspaceCleanAfter: true,
    headUnchanged: true,
    temporaryStateRemoved: true,
  },
  apiKeyEnvironmentVariablesMustBeRemoved: adapter.dispatch.apiKeyEnvironmentVariablesMustBeRemoved,
  paidFallbackAllowed: false,
  paidFallbackUsed: false,
  repositoryMutationAuthority: false,
  commitAuthority: false,
  pushAuthority: false,
  publicationAuthority: false,
  modelTurnPerformed: false,
  truthBoundary:
    "This plan binds every queue, capacity, transport, authentication and acceptance input before one disposable no-write heartbeat may be attempted. It creates no fixture, starts no Codex process and grants no repository, Git or publication authority.",
}, null, 2));
