#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(ROOT, "config", "codex-documentation-truth-physical-acceptance-v1.json");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA256 = /^[0-9a-f]{64}$/;

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, ordered(value[key])]),
  );
}

const canonicalJson = (value) => JSON.stringify(ordered(value));
const sha256Bytes = (value) => createHash("sha256").update(value).digest("hex");
function without(value, key) { const copy = { ...value }; delete copy[key]; return copy; }

function regularFile(value, label) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return resolved;
}

function readJsonBytes(value, label, maximum = 8 * 1024 * 1024) {
  const resolved = regularFile(value, label);
  const bytes = fs.readFileSync(resolved);
  if (bytes.length < 2 || bytes.length > maximum) throw new Error(`${label} is outside its bounded byte limit.`);
  let document;
  try { document = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} is not valid UTF-8 JSON.`); }
  if (!OBJECT(document)) throw new Error(`${label} must contain one JSON object.`);
  return { resolved, bytes, sha256: sha256Bytes(bytes), document };
}

function requireString(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value || value.length > maximum || value.includes("\0")) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value;
}
function requireSha(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}
function parseTimestamp(value, label) {
  const milliseconds = Date.parse(requireString(value, label, 64));
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return milliseconds;
}
function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const a = [...new Set(left.filter((value) => typeof value === "string"))].sort();
  const b = [...new Set(right.filter((value) => typeof value === "string"))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function requireFalseEffects(value, label) {
  for (const field of [
    "commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed",
    "paidFallbackUsed", "financialActionPerformed",
  ]) {
    if (value[field] !== false) throw new Error(`${label} must keep ${field}=false.`);
  }
}

function parseArguments(values) {
  if (![6, 8].includes(values.length)) {
    throw new Error(
      "Usage: node scripts/compile-codex-documentation-truth-physical-acceptance.mjs <success.json> <no-action.json> <forbidden.json> <stale-head.json> <supervision.json> <fresh-capability.json> [--now <ISO-8601>]",
    );
  }
  const now = values.length === 8 && values[6] === "--now" ? new Date(values[7]) : new Date();
  if (values.length === 8 && values[6] !== "--now") throw new Error("Optional argument must be --now <ISO-8601>.");
  if (!Number.isFinite(now.getTime())) throw new Error("Compilation time is invalid.");
  return {
    scenarioPaths: {
      "validated-success": values[0],
      "validated-no-action": values[1],
      "forbidden-path-rejection": values[2],
      "stale-head-rejection": values[3],
    },
    supervisionPath: values[4],
    capabilityPath: values[5],
    now,
  };
}

function validatePolicy(policy) {
  if (
    policy.schemaVersion !== 1 ||
    policy.kind !== "evavo-codex-documentation-truth-physical-acceptance-policy-v1" ||
    policy.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure"
  ) throw new Error("Documentation-truth acceptance policy identity is invalid.");
  if (
    policy.routeId !== "codex-spark-pro" ||
    policy.modelPreference !== "gpt-5.3-codex-spark" ||
    policy.capacityClass !== "included-consumer" ||
    policy.authenticationClass !== "chatgpt-consumer" ||
    policy.stagedWorkerClass !== "documentation-truth" ||
    policy.stagedWorkClass !== "capability-manifest-maintenance"
  ) throw new Error("Documentation-truth acceptance policy route identity is invalid.");
  if (!sameStringSet(policy.currentNormalWorkerClasses, ["test-generation"])) {
    throw new Error("Normal Spark route must still admit only test-generation during staged certification.");
  }
  if (!sameStringSet(policy.requiredScenarios, [
    "validated-success", "validated-no-action", "forbidden-path-rejection", "stale-head-rejection",
  ])) throw new Error("Documentation-truth acceptance scenario policy is invalid.");
  return policy;
}

function currentBindings(policy) {
  const bindings = {};
  for (const relativePath of policy.requiredCurrentBindings) {
    const source = readJsonBytes(path.join(ROOT, relativePath), `Current binding ${relativePath}`, 4 * 1024 * 1024);
    bindings[relativePath] = { sha256: source.sha256, byteLength: source.bytes.length };
  }
  const routing = readJsonBytes(path.join(ROOT, "config", "worker-capacity-routing-v1.json"), "Worker routing policy").document;
  const route = (routing.workerRoutes ?? []).find((entry) => entry?.id === policy.routeId);
  if (!OBJECT(route) || !sameStringSet(route.workerClasses, policy.currentNormalWorkerClasses)) {
    throw new Error("Normal Spark route changed before staged documentation-truth acceptance compilation.");
  }
  if (
    route.modelPreference !== policy.modelPreference ||
    route.capacityClass !== policy.capacityClass ||
    route.maximumAutomaticConcurrency !== policy.limits.maximumConcurrency ||
    route.paidFallbackAllowed !== false
  ) throw new Error("Normal Spark route identity or capacity boundary changed.");
  const capacity = readJsonBytes(path.join(ROOT, "config", "codex-spark-capacity-status-v1.json"), "Spark capacity policy").document;
  if (!sameStringSet(capacity.admittedWorkerClasses, policy.currentNormalWorkerClasses)) {
    throw new Error("Spark capacity policy already widened its worker classes.");
  }
  const profile = readJsonBytes(path.join(ROOT, policy.workerProfile), "Staged documentation-truth profile").document;
  if (
    profile.activationState !== "staged-only" ||
    profile.physicalActivation?.normalRouteEnabled !== false ||
    profile.physicalActivation?.leaseEnabled !== false ||
    profile.physicalActivation?.modelExecutionEnabled !== false
  ) throw new Error("Documentation-truth worker profile is not staged-only.");
  return bindings;
}

function validateCapability(policy, source, now) {
  const capability = source.document;
  if (
    capability.schemaVersion !== 1 ||
    capability.kind !== "evavo-codex-worker-capability-probe-v1" ||
    capability.eligibleForWorkerDispatch !== true
  ) throw new Error("Fresh eligible Codex capability receipt is required.");
  const observed = parseTimestamp(capability.observedAt, "Codex capability observedAt");
  if (
    observed - now.getTime() > policy.limits.maximumFutureClockSkewSeconds * 1000 ||
    now.getTime() - observed > policy.limits.maximumCapabilityReceiptAgeSeconds * 1000
  ) throw new Error("Codex capability receipt is stale or future-dated.");
  requireString(capability.version, "Codex capability version", 160);
  for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
    requireString(capability.capabilities?.[key], `Codex capability ${key}`, 64);
  }
  return capability;
}

function validateEmbeddedDigest(value, label) {
  const observed = requireSha(value.receiptSha256, `${label}.receiptSha256`);
  const expected = sha256Bytes(Buffer.from(canonicalJson(without(value, "receiptSha256")), "utf8"));
  if (observed !== expected) throw new Error(`${label} digest does not match its canonical body.`);
  requireSha(value.evidenceSha256, `${label}.evidenceSha256`);
}

function validateScenario(policy, name, source, capability) {
  const scenario = source.document;
  validateEmbeddedDigest(scenario, `Scenario ${name}`);
  if (
    scenario.schemaVersion !== 1 ||
    scenario.kind !== "evavo-codex-documentation-truth-fixture-scenario-v1" ||
    scenario.scenario !== name ||
    scenario.fixtureOnly !== true ||
    scenario.workerClass !== policy.stagedWorkerClass ||
    scenario.workClass !== policy.stagedWorkClass ||
    scenario.routeId !== policy.routeId ||
    scenario.modelPreference !== policy.modelPreference ||
    scenario.capacityClass !== policy.capacityClass ||
    scenario.codexVersion !== capability.version ||
    scenario.paidFallbackUsed !== false
  ) throw new Error(`Scenario ${name} identity changed.`);
  requireFalseEffects(scenario, `Scenario ${name}`);
  requireString(scenario.fixtureId, `Scenario ${name} fixtureId`, 160);

  if (name === "validated-success") {
    if (
      scenario.accepted !== true || scenario.resultState !== "SUCCESS" ||
      scenario.externalValidationAccepted !== true || scenario.changedFiles !== 1 ||
      !Number.isSafeInteger(scenario.changedLines) || scenario.changedLines < 1 ||
      scenario.changedLines > policy.limits.maximumChangedLines ||
      !Array.isArray(scenario.changedPaths) || scenario.changedPaths.length !== 1 ||
      !policy.allowedManifestPaths.includes(scenario.changedPaths[0]) ||
      scenario.candidateMutationPersisted !== true
    ) throw new Error("Validated-success scenario is incomplete or exceeds manifest-only scope.");
  } else if (name === "validated-no-action") {
    if (
      scenario.accepted !== true || scenario.resultState !== "NO_ACTION" ||
      scenario.externalValidationAccepted !== true || scenario.changedFiles !== 0 ||
      scenario.changedLines !== 0 || !Array.isArray(scenario.changedPaths) ||
      scenario.changedPaths.length !== 0 || scenario.candidateMutationPersisted !== false
    ) throw new Error("Validated-no-action scenario did not prove a clean terminal NO_ACTION result.");
  } else if (name === "forbidden-path-rejection") {
    if (
      scenario.accepted !== false || scenario.rejected !== true ||
      scenario.rejectionReason !== "FORBIDDEN_PATH" ||
      scenario.externalValidationAccepted !== false ||
      scenario.candidateMutationPersisted !== false
    ) throw new Error("Forbidden-path scenario did not fail closed.");
  } else if (name === "stale-head-rejection") {
    if (
      scenario.accepted !== false || scenario.rejected !== true ||
      scenario.rejectionReason !== "STALE_HEAD" ||
      scenario.modelTurnPerformed !== false ||
      scenario.candidateMutationPersisted !== false
    ) throw new Error("Stale-head scenario did not reject before model execution.");
  }
  return scenario;
}

function validateSupervision(policy, source, capability, fixtureId) {
  const supervision = source.document;
  validateEmbeddedDigest(supervision, "Fixture supervision");
  if (
    supervision.schemaVersion !== 1 ||
    supervision.kind !== "evavo-codex-documentation-truth-fixture-supervision-v1" ||
    supervision.fixtureId !== fixtureId ||
    supervision.workerClass !== policy.stagedWorkerClass ||
    supervision.workClass !== policy.stagedWorkClass ||
    supervision.routeId !== policy.routeId ||
    supervision.modelPreference !== policy.modelPreference ||
    supervision.codexVersion !== capability.version
  ) throw new Error("Fixture supervision identity changed.");
  for (const [field, expected] of Object.entries(policy.requiredTruth)) {
    if (supervision[field] !== expected) {
      throw new Error(`Fixture supervision truth ${field} must equal ${JSON.stringify(expected)}.`);
    }
  }
  requireFalseEffects(supervision, "Fixture supervision");
  return supervision;
}

try {
  const args = parseArguments(process.argv.slice(2));
  const policySource = readJsonBytes(POLICY_PATH, "Documentation-truth acceptance policy", 2 * 1024 * 1024);
  const policy = validatePolicy(policySource.document);
  const bindings = currentBindings(policy);
  const capabilitySource = readJsonBytes(args.capabilityPath, "Fresh Codex capability receipt", 2 * 1024 * 1024);
  const capability = validateCapability(policy, capabilitySource, args.now);

  const scenarioSources = Object.fromEntries(
    Object.entries(args.scenarioPaths).map(([name, scenarioPath]) => [
      name,
      readJsonBytes(scenarioPath, `Scenario receipt ${name}`, 8 * 1024 * 1024),
    ]),
  );
  const scenarios = Object.fromEntries(
    policy.requiredScenarios.map((name) => [
      name,
      validateScenario(policy, name, scenarioSources[name], capability),
    ]),
  );
  const fixtureIds = [...new Set(Object.values(scenarios).map((scenario) => scenario.fixtureId))];
  if (fixtureIds.length !== 1) throw new Error("Scenario receipts do not share one fixture identity.");
  const supervisionSource = readJsonBytes(args.supervisionPath, "Fixture supervision receipt", 8 * 1024 * 1024);
  const supervision = validateSupervision(policy, supervisionSource, capability, fixtureIds[0]);

  const acceptedAt = args.now.toISOString();
  const body = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-physical-acceptance-v1",
    accepted: true,
    acceptedAt,
    routeId: policy.routeId,
    modelPreference: policy.modelPreference,
    capacityClass: policy.capacityClass,
    authenticationClass: policy.authenticationClass,
    workerClass: policy.stagedWorkerClass,
    workClass: policy.stagedWorkClass,
    codexVersion: capability.version,
    fixtureId: fixtureIds[0],
    capabilityReceiptSha256: capabilitySource.sha256,
    policySha256: policySource.sha256,
    supervisionReceiptSha256: supervision.receiptSha256,
    supervisionBytesSha256: supervisionSource.sha256,
    currentBindings: bindings,
    scenarios,
    scenarioBytesSha256: Object.fromEntries(
      Object.entries(scenarioSources).map(([name, source]) => [name, source.sha256]),
    ),
    fixtureOnly: supervision.fixtureOnly,
    fixtureRepositoryRemoteCount: supervision.fixtureRepositoryRemoteCount,
    fixturePrimaryCheckoutClean: supervision.fixturePrimaryCheckoutClean,
    fixtureMainUnchanged: supervision.fixtureMainUnchanged,
    candidateCleanupComplete: supervision.candidateCleanupComplete,
    registeredWorktreesAfterCleanup: supervision.registeredWorktreesAfterCleanup,
    normalRouteWasUnchanged: supervision.normalRouteWasUnchanged,
    workerCommitPerformed: false,
    leaseAcquired: false,
    normalRouteMutationPerformed: false,
    modelTurnPerformedByCompiler: false,
    repositoryMutationPerformedByCompiler: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    paidFallbackUsed: false,
    financialActionPerformed: false,
    truthBoundary:
      "This envelope combines externally supplied fixture scenario and cleanup receipts. The compiler performs no model turn and does not activate the normal route, acquire a lease, modify Git, publish, deploy or authorize paid fallback.",
  };
  process.stdout.write(`${JSON.stringify({
    ...body,
    acceptanceSha256: sha256Bytes(Buffer.from(canonicalJson(body), "utf8")),
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-physical-acceptance-v1",
    accepted: false,
    errors: [String(error?.message ?? error).slice(0, 2000)],
    leaseAcquired: false,
    normalRouteMutationPerformed: false,
    modelTurnPerformedByCompiler: false,
    repositoryMutationPerformedByCompiler: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    paidFallbackUsed: false,
    financialActionPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
