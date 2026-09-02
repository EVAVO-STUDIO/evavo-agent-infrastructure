#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA256 = /^[0-9a-f]{64}$/;
const GRANT_ID = /^doc-truth:[0-9a-f]{40}$/;
const REQUIRED_OPTIONS = ["--work-item", "--route-plan", "--worker-id", "--work-exchange-root", "--local-storage-root"];
const GRANT_OPTIONS = ["--agent-infrastructure-root", "--runtime-grant-envelope", "--runtime-grant-trust-anchor", "--runtime-grant-request"];
const ALLOWED_OPTIONS = new Set([...REQUIRED_OPTIONS, ...GRANT_OPTIONS]);

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
const canonical = (value) => JSON.stringify(ordered(value));
const sha256 = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).digest("hex");

function usage() {
  return "Usage: node scripts/run-autonomous-work-exchange-lease.mjs --work-item <json> --route-plan <json> --worker-id <id> --work-exchange-root <dir> --local-storage-root <dir> [--agent-infrastructure-root <dir> --runtime-grant-envelope <json> --runtime-grant-trust-anchor <json> --runtime-grant-request <json>]";
}

function parseArguments(argv) {
  if (argv.length === 0 || argv.length % 2 !== 0) throw new Error(usage());
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!ALLOWED_OPTIONS.has(key) || typeof value !== "string" || !value || value.startsWith("--")) throw new Error(usage());
    if (values.has(key)) throw new Error(`Duplicate option ${key} is forbidden.`);
    values.set(key, value);
  }
  for (const key of REQUIRED_OPTIONS) if (!values.has(key)) throw new Error(`Missing required option ${key}.`);
  return values;
}

function realDirectory(value, label) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real non-symlink directory.`);
  return resolved;
}

function regularFile(value, label, maximum) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximum) {
    throw new Error(`${label} must be a bounded regular non-symlink file.`);
  }
  return resolved;
}

function ownedFile(root, relative, label, maximum) {
  const resolved = regularFile(path.join(root, relative), label, maximum);
  const relation = path.relative(root, resolved);
  if (relation.startsWith("..") || path.isAbsolute(relation)) throw new Error(`${label} escaped its repository root.`);
  return resolved;
}

function samePath(left, right) {
  const normalize = (value) => {
    const selected = path.normalize(value);
    return process.platform === "win32" ? selected.toLowerCase() : selected;
  };
  return normalize(left) === normalize(right);
}

function readJson(file, label) {
  let document;
  try {
    document = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
  if (!OBJECT(document)) throw new Error(`${label} must contain a JSON object.`);
  return document;
}

function minimalEnvironment() {
  const environment = {
    PATH: process.env.PATH ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    WINDIR: process.env.WINDIR ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "0",
    EVAVO_CODEX_DOCUMENTATION_TRUTH_EXECUTION_ENABLED: "0"
  };
  return Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== ""));
}

function runJson(executable, argv, cwd, timeoutSeconds, maximumOutputBytes) {
  const result = spawnSync(executable, argv, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: timeoutSeconds * 1000,
    maxBuffer: maximumOutputBytes,
    env: minimalEnvironment(),
    stdin: "ignore"
  });
  if (result.error) throw result.error;
  const channel = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  let document;
  try {
    document = JSON.parse(String(channel).trim());
  } catch {
    throw new Error(`Child process returned non-JSON output with exit status ${String(result.status)}.`);
  }
  if (result.status !== 0) {
    throw new Error(String(document.errorMessage ?? document.errors?.[0] ?? "Child process failed").slice(0, 2000));
  }
  return document;
}

function validateRegistry(registry, policy, workerClass) {
  if (registry.schemaVersion !== 1 || registry.kind !== "evavo-autonomous-spark-task-registry-v1") {
    throw new Error("Local Storage autonomous task registry kind/schema is invalid.");
  }
  if (registry.canonicalWorkExchangeStoreAlreadyExists !== true) throw new Error("Local Storage did not acknowledge the canonical Work Exchange store.");
  if (registry.autonomousLeaseActionPhysicallyRegistered !== true || registry.leaseActionPhysicallyRegistered !== true) {
    throw new Error("Local Storage route-bound lease effect is not physically registered.");
  }
  if (registry.autonomousLeasePlanKind !== policy.acceptedPlanKind || registry.autonomousLeaseCommand !== policy.localStorageEffect) {
    throw new Error("Local Storage lease plan or command identity differs from runner policy.");
  }
  const classes = registry.autonomousLeaseWorkerClasses;
  if (!Array.isArray(classes) || policy.acceptedWorkerClasses.some((workerClassName) => !classes.includes(workerClassName))) {
    throw new Error("Local Storage does not admit all runner worker classes.");
  }
  if (registry.autonomousLeaseRequiresExclusiveLock !== true || registry.autonomousLeaseRequiresExactSnapshotSha256 !== true || registry.autonomousLeaseRequiresExpectedGeneration !== true || registry.autonomousLeaseCrashRecoveryRegistered !== true || registry.autonomousLeaseIdempotentReplayRegistered !== true) {
    throw new Error("Local Storage route-bound lease durability contract is incomplete.");
  }
  if (workerClass === "documentation-truth") {
    for (const [field, expected] of Object.entries(policy.documentationTruthRuntimeGrant.requiredRegistryTruth)) {
      if (registry[field] !== expected) throw new Error(`Local Storage documentation-truth grant boundary differs at ${field}.`);
    }
  }
  if (registry.physicalCodexExecutionForNormalWorkRegistered !== false || registry.publicationAuthority !== false || registry.paidFallbackAllowed !== false) {
    throw new Error("Local Storage lease registry widened model, publication or paid-fallback authority.");
  }
}

function validatePlan(plan, policy) {
  if (plan.schemaVersion !== 2 || plan.kind !== policy.acceptedPlanKind || plan.eligible !== true || plan.decision !== "LEASE_REQUIRED") {
    throw new Error("Compiled autonomous lease plan is not eligible.");
  }
  if (!policy.acceptedWorkerClasses.includes(plan.workerClass)) throw new Error("Compiled plan worker class is not admitted.");
  if (!SHA256.test(String(plan.planSha256 ?? ""))) throw new Error("Compiled plan SHA-256 is invalid.");
  const body = { ...plan };
  delete body.planSha256;
  if (sha256(canonical(body)) !== plan.planSha256) throw new Error("Compiled plan canonical SHA-256 is invalid.");
  if (plan.maximumItemsLeased !== 1 || plan.oneWriterPerRepository !== true || plan.paidFallbackUsed !== false) {
    throw new Error("Compiled plan widened lease or paid-fallback authority.");
  }
  for (const field of ["queueMutationPerformed", "leaseAcquired", "modelTurnPerformed", "deterministicValidationPerformed", "repositoryMutationPerformed", "commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed"]) {
    if (plan[field] !== false) throw new Error(`Compiled plan pre-effect field ${field} must remain false.`);
  }
}

function grantArguments(input, plan, policy) {
  const present = GRANT_OPTIONS.filter((option) => input.has(option));
  if (plan.workerClass !== "documentation-truth") {
    if (policy.testGenerationRuntimeGrant.inputsForbidden !== true || present.length > 0) {
      throw new Error("Runtime-grant evidence is forbidden for test-generation leases.");
    }
    return [];
  }
  if (present.length !== GRANT_OPTIONS.length) {
    throw new Error("Documentation-truth leases require the complete runtime-grant evidence set.");
  }
  const grant = policy.documentationTruthRuntimeGrant;
  if (grant.verificationPolicyVersion !== 3 || grant.agentInfrastructureRootMustMatchRunnerRoot !== true) {
    throw new Error("Documentation-truth runtime-grant runner policy is invalid.");
  }
  const agentRoot = realDirectory(input.get("--agent-infrastructure-root"), "Agent Infrastructure root");
  if (!samePath(agentRoot, ROOT)) throw new Error("Agent Infrastructure grant-verification root must match this runner checkout.");
  const envelope = regularFile(input.get("--runtime-grant-envelope"), "runtime activation grant envelope", grant.maximumEnvelopeBytes);
  const trustAnchor = regularFile(input.get("--runtime-grant-trust-anchor"), "runtime activation trust anchor", grant.maximumTrustAnchorBytes);
  const request = regularFile(input.get("--runtime-grant-request"), "runtime activation grant request", grant.maximumRequestBytes);
  return [
    grant.effectArguments.agentInfrastructureRoot,
    agentRoot,
    grant.effectArguments.envelope,
    envelope,
    grant.effectArguments.trustAnchor,
    trustAnchor,
    grant.effectArguments.request,
    request
  ];
}

function validateReceipt(receipt, plan, policy) {
  if (receipt.schemaVersion !== 2 || receipt.kind !== policy.acceptedReceiptKind || receipt.ok !== true) {
    throw new Error("Local Storage autonomous lease receipt is invalid.");
  }
  const receiptBody = { ...receipt };
  const observedReceiptSha = receiptBody.receiptSha256;
  delete receiptBody.receiptSha256;
  if (!SHA256.test(String(observedReceiptSha ?? "")) || sha256(canonical(receiptBody)) !== observedReceiptSha) {
    throw new Error("Lease receipt SHA-256 is invalid.");
  }
  for (const field of ["planSha256", "workItemId", "repository", "sourceRevision", "workerId", "workerClass", "routeAdmissionSha256", "dispatchIntentSha256", "expectedSnapshotSha256"]) {
    if (receipt[field] !== plan[field]) throw new Error(`Lease receipt ${field} continuity failed.`);
  }
  if (receipt.queueMutationPerformed !== true || receipt.leaseAcquired !== true || receipt.itemsLeased !== 1) {
    throw new Error("Lease receipt does not prove exactly one lease transition.");
  }
  if (plan.workerClass === "documentation-truth") {
    for (const [field, expected] of Object.entries(policy.documentationTruthRuntimeGrant.requiredReceiptTruth)) {
      if (receipt[field] !== expected) throw new Error(`Documentation-truth lease receipt did not prove ${field}.`);
    }
    if (!GRANT_ID.test(String(receipt.runtimeActivationGrantId ?? ""))) throw new Error("Documentation-truth lease receipt grant ID is invalid.");
    for (const field of ["runtimeActivationGrantBodySha256", "runtimeActivationGrantVerificationSha256", "runtimeGrantConsumptionSha256"]) {
      if (!SHA256.test(String(receipt[field] ?? ""))) throw new Error(`Documentation-truth lease receipt ${field} is invalid.`);
    }
  } else {
    for (const [field, expected] of Object.entries(policy.testGenerationRuntimeGrant.requiredReceiptTruth)) {
      if (receipt[field] !== expected) throw new Error(`Test-generation lease receipt must keep ${field}=${String(expected)}.`);
    }
    for (const field of ["runtimeActivationGrantId", "runtimeActivationGrantBodySha256", "runtimeActivationGrantVerificationSha256", "runtimeGrantConsumptionSha256", "grantConsumedUses", "grantRemainingUses"]) {
      if (Object.prototype.hasOwnProperty.call(receipt, field)) throw new Error(`Test-generation lease receipt unexpectedly contains ${field}.`);
    }
  }
  for (const field of ["modelTurnPerformed", "deterministicValidationPerformed", "repositoryMutationPerformed", "commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed", "financialActionPerformed", "paidFallbackUsed"]) {
    if (receipt[field] !== false) throw new Error(`Lease receipt widened authority through ${field}.`);
  }
}

try {
  const input = parseArguments(process.argv.slice(2));
  const policy = readJson(ownedFile(ROOT, "config/autonomous-work-exchange-lease-runner-v1.json", "lease runner policy", 1024 * 1024), "lease runner policy");
  if (policy.schemaVersion !== 1 || policy.kind !== "evavo-autonomous-work-exchange-lease-runner-policy-v1") throw new Error("Lease runner policy kind/schema is invalid.");
  for (const field of ["modelExecutionAuthority", "deterministicValidationAuthority", "repositoryMutationAuthority", "commitAuthority", "pushAuthority", "publicationAuthority", "deploymentAuthority", "paidFallbackAllowed"]) {
    if (policy[field] !== false) throw new Error(`Lease runner policy authority boundary is invalid at ${field}.`);
  }

  const localStorageRoot = realDirectory(input.get("--local-storage-root"), "Local Storage root");
  const workExchangeRoot = realDirectory(input.get("--work-exchange-root"), "Work Exchange root");
  const workItem = regularFile(input.get("--work-item"), "READY work item", policy.maximumInputBytes);
  const routePlan = regularFile(input.get("--route-plan"), "route plan", policy.maximumInputBytes);
  const snapshot = regularFile(path.join(workExchangeRoot, "work-exchange-state.json"), "canonical Work Exchange state", policy.maximumInputBytes);
  const compiler = ownedFile(ROOT, policy.compiler, "lease plan compiler", 2 * 1024 * 1024);
  const registryPath = ownedFile(localStorageRoot, policy.localStorageRegistry, "Local Storage autonomous registry", 2 * 1024 * 1024);
  const effect = ownedFile(localStorageRoot, policy.localStorageEffect, "Local Storage autonomous lease effect", 4 * 1024 * 1024);

  const plan = runJson(process.execPath, [compiler, workItem, snapshot, routePlan, input.get("--worker-id")], ROOT, policy.compilerTimeoutSeconds, policy.maximumOutputBytes);
  validatePlan(plan, policy);
  const registry = readJson(registryPath, "Local Storage autonomous registry");
  validateRegistry(registry, policy, plan.workerClass);
  const runtimeGrantArguments = grantArguments(input, plan, policy);

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-autonomous-lease-"));
  const planPath = path.join(temporaryDirectory, `${plan.planSha256}.json`);
  try {
    fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    const python = process.platform === "win32" ? "python.exe" : "python3";
    const receipt = runJson(
      python,
      [effect, "--root", workExchangeRoot, "--plan-json", planPath, ...runtimeGrantArguments],
      localStorageRoot,
      policy.effectTimeoutSeconds,
      policy.maximumOutputBytes
    );
    validateReceipt(receipt, plan, policy);
    const grantConsumed = receipt.grantConsumed === true;
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      kind: "evavo-autonomous-work-exchange-lease-run-v1",
      ok: true,
      decision: "LEASE_ACQUIRED",
      planSha256: plan.planSha256,
      receiptSha256: receipt.receiptSha256,
      workItemId: receipt.workItemId,
      repository: receipt.repository,
      sourceRevision: receipt.sourceRevision,
      workerId: receipt.workerId,
      workerClass: receipt.workerClass,
      leaseExpiresAt: receipt.leaseExpiresAt,
      runtimeGrantVerificationPerformed: receipt.runtimeGrantVerificationPerformed,
      grantConsumed,
      grantConsumptionRecorded: receipt.grantConsumptionRecorded,
      runtimeActivationGrantId: grantConsumed ? receipt.runtimeActivationGrantId : null,
      runtimeActivationGrantVerificationSha256: grantConsumed ? receipt.runtimeActivationGrantVerificationSha256 : null,
      runtimeGrantConsumptionSha256: grantConsumed ? receipt.runtimeGrantConsumptionSha256 : null,
      queueMutationPerformed: true,
      leaseAcquired: true,
      modelTurnPerformed: false,
      deterministicValidationPerformed: false,
      repositoryMutationPerformed: false,
      commitPerformed: false,
      pushPerformed: false,
      publicationPerformed: false,
      deploymentPerformed: false,
      financialActionPerformed: false,
      paidFallbackUsed: false,
      truthBoundary: policy.truthBoundary
    }, null, 2)}\n`);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-autonomous-work-exchange-lease-run-error-v1",
    ok: false,
    decision: "RETAIN_READY_JOB",
    errorMessage: String(error?.message ?? error).slice(0, 3000),
    runtimeGrantVerificationPerformed: false,
    grantConsumed: false,
    grantConsumptionRecorded: false,
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    deterministicValidationPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false
  }, null, 2)}\n`);
  process.exitCode = 1;
}
