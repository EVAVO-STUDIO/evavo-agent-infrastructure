#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA256 = /^[0-9a-f]{64}$/;
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const POLICY_PATH = "config/codex-documentation-truth-physical-acceptance-v1.json";

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, ordered(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(ordered(value));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function without(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function regularFile(value, label) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  return resolved;
}

function readJsonBytes(value, label, maximumBytes = 8 * 1024 * 1024) {
  const resolved = regularFile(value, label);
  const bytes = fs.readFileSync(resolved);
  if (bytes.length < 2 || bytes.length > maximumBytes) {
    throw new Error(`${label} is outside its bounded byte limit.`);
  }
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
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

function requireInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function parseTimestamp(value, label) {
  const text = requireString(value, label, 64);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return milliseconds;
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const a = [...new Set(left.filter((value) => typeof value === "string"))].sort();
  const b = [...new Set(right.filter((value) => typeof value === "string"))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function authorityMustRemainFalse(value, label) {
  for (const field of [
    "leaseAcquired",
    "normalRouteMutationPerformed",
    "modelTurnPerformedByCompiler",
    "repositoryMutationPerformedByCompiler",
    "commitPerformed",
    "pushPerformed",
    "publicationPerformed",
    "deploymentPerformed",
    "paidFallbackUsed",
    "financialActionPerformed",
  ]) {
    if (value[field] !== false) throw new Error(`${label} must keep ${field}=false.`);
  }
}

function parseArguments(values) {
  if (values.length < 2 || values.length > 4) {
    throw new Error(
      "Usage: node scripts/compile-codex-documentation-truth-acceptance-readiness.mjs <acceptance.json> <fresh-capability.json> [--now <ISO-8601>]",
    );
  }
  const acceptance = values[0];
  const capability = values[1];
  let now = new Date();
  if (values.length > 2) {
    if (values.length !== 4 || values[2] !== "--now") throw new Error("Optional argument must be --now <ISO-8601>.");
    now = new Date(values[3]);
  }
  if (!Number.isFinite(now.getTime())) throw new Error("Compilation time is invalid.");
  return { acceptance, capability, now };
}

function validatePolicy(policy) {
  if (
    policy.schemaVersion !== 1 ||
    policy.kind !== "evavo-codex-documentation-truth-physical-acceptance-policy-v1" ||
    policy.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure"
  ) {
    throw new Error("Documentation-truth acceptance policy identity is invalid.");
  }
  if (
    policy.routeId !== "codex-spark-pro" ||
    policy.modelPreference !== "gpt-5.3-codex-spark" ||
    policy.capacityClass !== "included-consumer" ||
    policy.authenticationClass !== "chatgpt-consumer" ||
    policy.stagedWorkerClass !== "documentation-truth" ||
    policy.stagedWorkClass !== "capability-manifest-maintenance"
  ) {
    throw new Error("Documentation-truth acceptance policy route identity is invalid.");
  }
  if (!sameStringSet(policy.currentNormalWorkerClasses, ["test-generation"])) {
    throw new Error("Current normal worker-class boundary must remain test-generation only.");
  }
  if (!sameStringSet(policy.allowedManifestPaths, ["evavo.capabilities.json", ".evavo/capabilities.json"])) {
    throw new Error("Documentation-truth allowed manifest paths are invalid.");
  }
  if (
    !sameStringSet(policy.requiredScenarios, [
      "validated-success",
      "validated-no-action",
      "forbidden-path-rejection",
      "stale-head-rejection",
    ])
  ) {
    throw new Error("Documentation-truth required scenario set is invalid.");
  }
  if (policy.activation?.automaticActivationAllowed !== false || policy.activation?.sourceReviewRequired !== true) {
    throw new Error("Documentation-truth activation must remain review-gated.");
  }
  for (const field of [
    "normalRouteMutationPerformedByCompiler",
    "leaseMutationPerformedByCompiler",
    "modelTurnPerformedByCompiler",
    "publicationPerformedByCompiler",
  ]) {
    if (policy.activation?.[field] !== false) throw new Error(`Acceptance policy widens ${field}.`);
  }
  return policy;
}

function validateCurrentBindings(policy) {
  const bindings = {};
  for (const relativePath of policy.requiredCurrentBindings) {
    const source = readJsonBytes(path.join(ROOT, relativePath), `Current binding ${relativePath}`, 4 * 1024 * 1024);
    bindings[relativePath] = source;
  }

  const routing = bindings["config/worker-capacity-routing-v1.json"].document;
  if (routing.schemaVersion !== 1 || routing.kind !== "evavo-worker-capacity-routing") {
    throw new Error("Current worker routing policy identity is invalid.");
  }
  const route = (routing.workerRoutes ?? []).find((entry) => entry?.id === policy.routeId);
  if (!OBJECT(route)) throw new Error("Current codex-spark-pro route is missing.");
  if (
    route.runtime !== "codex" ||
    route.modelPreference !== policy.modelPreference ||
    route.capacityClass !== policy.capacityClass ||
    route.paidFallbackAllowed !== false ||
    route.maximumAutomaticConcurrency !== policy.limits.maximumConcurrency ||
    !sameStringSet(route.workerClasses, policy.currentNormalWorkerClasses)
  ) {
    throw new Error("Current Spark route drifted from its staged-only worker boundary.");
  }

  const capacityPolicy = bindings["config/codex-spark-capacity-status-v1.json"].document;
  if (
    capacityPolicy.schemaVersion !== 1 ||
    capacityPolicy.kind !== "evavo-codex-spark-capacity-status-policy-v1" ||
    capacityPolicy.routeId !== policy.routeId ||
    capacityPolicy.modelPreference !== policy.modelPreference ||
    capacityPolicy.capacityClass !== policy.capacityClass ||
    capacityPolicy.maximumConcurrency !== policy.limits.maximumConcurrency ||
    capacityPolicy.paidFallbackAllowed !== false ||
    !sameStringSet(capacityPolicy.admittedWorkerClasses, policy.currentNormalWorkerClasses)
  ) {
    throw new Error("Current Spark capacity policy drifted from its staged-only worker boundary.");
  }

  const physicalPolicy = bindings["config/codex-spark-physical-acceptance-v1.json"].document;
  if (
    physicalPolicy.schemaVersion !== 1 ||
    physicalPolicy.kind !== "evavo-codex-spark-physical-acceptance-policy-v1" ||
    physicalPolicy.routeId !== policy.routeId ||
    physicalPolicy.modelPreference !== policy.modelPreference ||
    physicalPolicy.capacityClass !== policy.capacityClass ||
    physicalPolicy.paidFallbackAllowed !== false ||
    physicalPolicy.initialMaximumConcurrency !== policy.limits.maximumConcurrency ||
    !sameStringSet(physicalPolicy.initialWorkerClasses, policy.currentNormalWorkerClasses)
  ) {
    throw new Error("Current Test Builder physical acceptance policy drifted.");
  }

  const adapter = bindings["config/codex-worker-adapter-v1.json"].document;
  if (
    adapter.schemaVersion !== 1 ||
    adapter.kind !== "evavo-codex-worker-adapter-v1" ||
    adapter.spark?.routeId !== policy.routeId ||
    adapter.spark?.preferredModel !== policy.modelPreference ||
    adapter.spark?.capacityClass !== policy.capacityClass ||
    adapter.dispatch?.sandboxMode !== "workspace-write" ||
    adapter.dispatch?.approvalPolicy !== "never" ||
    adapter.dispatch?.paidFallbackAllowed !== false ||
    adapter.dispatch?.publicationAuthority !== false ||
    adapter.dispatch?.validationAuthority !== false
  ) {
    throw new Error("Current Codex worker adapter drifted from the accepted execution boundary.");
  }

  const profile = bindings[policy.workerProfile].document;
  if (
    profile.schemaVersion !== 1 ||
    profile.kind !== "evavo-worker-profile-v1" ||
    profile.id !== "documentation-truth-v1" ||
    profile.workerClass !== policy.stagedWorkerClass ||
    profile.workClass !== policy.stagedWorkClass ||
    profile.activationState !== "staged-only" ||
    profile.physicalActivation?.normalRouteEnabled !== false ||
    profile.physicalActivation?.leaseEnabled !== false ||
    profile.physicalActivation?.modelExecutionEnabled !== false ||
    profile.capacity?.paidFallbackAllowed !== false
  ) {
    throw new Error("Staged documentation-truth worker profile is invalid or already activated.");
  }

  return Object.fromEntries(
    Object.entries(bindings).map(([relativePath, source]) => [
      relativePath,
      { sha256: source.sha256, byteLength: source.bytes.length },
    ]),
  );
}

function validateCapability(policy, source, now) {
  const capability = source.document;
  if (
    capability.schemaVersion !== 1 ||
    capability.kind !== "evavo-codex-worker-capability-probe-v1" ||
    capability.eligibleForWorkerDispatch !== true
  ) {
    throw new Error("Fresh eligible Codex capability receipt is required.");
  }
  const observedAt = parseTimestamp(capability.observedAt, "Codex capability observedAt");
  const age = now.getTime() - observedAt;
  if (
    observedAt - now.getTime() > policy.limits.maximumFutureClockSkewSeconds * 1000 ||
    age > policy.limits.maximumCapabilityReceiptAgeSeconds * 1000
  ) {
    throw new Error("Codex capability receipt is stale or future-dated.");
  }
  requireString(capability.version, "Codex capability version", 160);
  for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
    requireString(capability.capabilities?.[key], `Codex capability ${key}`, 64);
  }
  return capability;
}

function verifyScenarioDigest(scenario, label) {
  if (!OBJECT(scenario)) throw new Error(`${label} must be an object.`);
  const observed = requireSha(scenario.receiptSha256, `${label}.receiptSha256`);
  const expected = sha256Bytes(Buffer.from(canonicalJson(without(scenario, "receiptSha256")), "utf8"));
  if (observed !== expected) throw new Error(`${label} receipt digest does not match its canonical body.`);
  requireSha(scenario.evidenceSha256, `${label}.evidenceSha256`);
}

function validateScenario(policy, name, scenario) {
  const label = `Scenario ${name}`;
  verifyScenarioDigest(scenario, label);
  if (
    scenario.schemaVersion !== 1 ||
    scenario.kind !== "evavo-codex-documentation-truth-fixture-scenario-v1" ||
    scenario.scenario !== name
  ) {
    throw new Error(`${label} identity is invalid.`);
  }
  if (scenario.fixtureOnly !== true || scenario.paidFallbackUsed !== false) {
    throw new Error(`${label} exceeds fixture or zero-paid-fallback scope.`);
  }
  for (const field of ["commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed"] ) {
    if (scenario[field] !== false) throw new Error(`${label} must keep ${field}=false.`);
  }

  if (name === "validated-success") {
    if (
      scenario.accepted !== true ||
      scenario.resultState !== "SUCCESS" ||
      scenario.externalValidationAccepted !== true ||
      scenario.changedFiles !== 1 ||
      !Array.isArray(scenario.changedPaths) ||
      scenario.changedPaths.length !== 1 ||
      !policy.allowedManifestPaths.includes(scenario.changedPaths[0]) ||
      scenario.candidateMutationPersisted !== true
    ) {
      throw new Error("Validated-success scenario did not prove one externally validated manifest-only candidate.");
    }
    requireInteger(
      scenario.changedLines,
      "Validated-success changedLines",
      1,
      policy.limits.maximumChangedLines,
    );
  } else if (name === "validated-no-action") {
    if (
      scenario.accepted !== true ||
      scenario.resultState !== "NO_ACTION" ||
      scenario.externalValidationAccepted !== true ||
      scenario.changedFiles !== 0 ||
      scenario.changedLines !== 0 ||
      !Array.isArray(scenario.changedPaths) ||
      scenario.changedPaths.length !== 0 ||
      scenario.candidateMutationPersisted !== false
    ) {
      throw new Error("Validated-no-action scenario did not prove a clean successful terminal NO_ACTION result.");
    }
  } else if (name === "forbidden-path-rejection") {
    if (
      scenario.accepted !== false ||
      scenario.rejected !== true ||
      scenario.rejectionReason !== "FORBIDDEN_PATH" ||
      scenario.externalValidationAccepted !== false ||
      scenario.candidateMutationPersisted !== false
    ) {
      throw new Error("Forbidden-path scenario did not fail closed without retained mutation.");
    }
  } else if (name === "stale-head-rejection") {
    if (
      scenario.accepted !== false ||
      scenario.rejected !== true ||
      scenario.rejectionReason !== "STALE_HEAD" ||
      scenario.modelTurnPerformed !== false ||
      scenario.candidateMutationPersisted !== false
    ) {
      throw new Error("Stale-head scenario did not reject before model execution.");
    }
  }
}

function validateAcceptance(policy, source, capabilitySource, capability, currentBindings, now) {
  const acceptance = source.document;
  if (
    acceptance.schemaVersion !== 1 ||
    acceptance.kind !== "evavo-codex-documentation-truth-physical-acceptance-v1" ||
    acceptance.accepted !== true
  ) {
    throw new Error("Documentation-truth physical acceptance identity is invalid.");
  }
  const observedAcceptanceSha = requireSha(acceptance.acceptanceSha256, "acceptanceSha256");
  const expectedAcceptanceSha = sha256Bytes(
    Buffer.from(canonicalJson(without(acceptance, "acceptanceSha256")), "utf8"),
  );
  if (observedAcceptanceSha !== expectedAcceptanceSha) {
    throw new Error("Documentation-truth acceptance digest does not match its canonical body.");
  }
  if (
    acceptance.routeId !== policy.routeId ||
    acceptance.modelPreference !== policy.modelPreference ||
    acceptance.capacityClass !== policy.capacityClass ||
    acceptance.authenticationClass !== policy.authenticationClass ||
    acceptance.workerClass !== policy.stagedWorkerClass ||
    acceptance.workClass !== policy.stagedWorkClass ||
    acceptance.codexVersion !== capability.version ||
    acceptance.capabilityReceiptSha256 !== capabilitySource.sha256
  ) {
    throw new Error("Documentation-truth acceptance route, worker or capability identity changed.");
  }
  const acceptedAt = parseTimestamp(acceptance.acceptedAt, "Acceptance acceptedAt");
  if (
    acceptedAt - now.getTime() > policy.limits.maximumFutureClockSkewSeconds * 1000 ||
    now.getTime() - acceptedAt > policy.limits.maximumAcceptanceAgeSeconds * 1000
  ) {
    throw new Error("Documentation-truth acceptance is stale or future-dated.");
  }
  if (!OBJECT(acceptance.currentBindings)) throw new Error("Acceptance currentBindings map is missing.");
  for (const [relativePath, binding] of Object.entries(currentBindings)) {
    const observed = acceptance.currentBindings[relativePath];
    if (
      !OBJECT(observed) ||
      observed.sha256 !== binding.sha256 ||
      observed.byteLength !== binding.byteLength
    ) {
      throw new Error(`Acceptance binding drifted for ${relativePath}.`);
    }
  }
  if (Object.keys(acceptance.currentBindings).sort().join("\n") !== Object.keys(currentBindings).sort().join("\n")) {
    throw new Error("Acceptance currentBindings contains an unexpected or missing source binding.");
  }
  for (const [field, expected] of Object.entries(policy.requiredTruth)) {
    if (acceptance[field] !== expected) throw new Error(`Acceptance truth ${field} must equal ${JSON.stringify(expected)}.`);
  }
  authorityMustRemainFalse(acceptance, "Documentation-truth acceptance");
  if (!OBJECT(acceptance.scenarios)) throw new Error("Acceptance scenarios map is missing.");
  if (!sameStringSet(Object.keys(acceptance.scenarios), policy.requiredScenarios)) {
    throw new Error("Acceptance scenario set is incomplete or unexpected.");
  }
  for (const name of policy.requiredScenarios) validateScenario(policy, name, acceptance.scenarios[name]);
  return acceptance;
}

try {
  const { acceptance: acceptanceInput, capability: capabilityInput, now } = parseArguments(process.argv.slice(2));
  const policySource = readJsonBytes(path.join(ROOT, POLICY_PATH), "Documentation-truth acceptance policy", 2 * 1024 * 1024);
  const policy = validatePolicy(policySource.document);
  const currentBindings = validateCurrentBindings(policy);
  const capabilitySource = readJsonBytes(capabilityInput, "Fresh Codex capability receipt", 2 * 1024 * 1024);
  const capability = validateCapability(policy, capabilitySource, now);
  const acceptanceSource = readJsonBytes(acceptanceInput, "Documentation-truth physical acceptance", 8 * 1024 * 1024);
  const acceptance = validateAcceptance(
    policy,
    acceptanceSource,
    capabilitySource,
    capability,
    currentBindings,
    now,
  );
  const body = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-activation-readiness-v1",
    ready: true,
    decision: "READY_FOR_SOURCE_ACTIVATION_REVIEW",
    routeId: policy.routeId,
    modelPreference: policy.modelPreference,
    capacityClass: policy.capacityClass,
    workerClass: policy.stagedWorkerClass,
    workClass: policy.stagedWorkClass,
    currentNormalWorkerClasses: [...policy.currentNormalWorkerClasses],
    acceptanceSha256: acceptance.acceptanceSha256,
    acceptanceBytesSha256: acceptanceSource.sha256,
    capabilityReceiptSha256: capabilitySource.sha256,
    policySha256: policySource.sha256,
    currentBindings,
    sourceActivationReviewRequired: true,
    automaticActivationAllowed: false,
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
      "This receipt proves only that staged fixture evidence is fresh and exactly bound to current source policy. It does not activate a route, acquire a lease, run a model, modify a repository, publish, deploy or authorize paid fallback.",
  };
  process.stdout.write(`${JSON.stringify({
    ...body,
    readinessSha256: sha256Bytes(Buffer.from(canonicalJson(body), "utf8")),
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-activation-readiness-v1",
    ready: false,
    decision: "RETAIN_STAGED_ONLY",
    errors: [String(error?.message ?? error).slice(0, 2000)],
    sourceActivationReviewRequired: true,
    automaticActivationAllowed: false,
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
