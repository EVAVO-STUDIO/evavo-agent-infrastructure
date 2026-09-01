#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(
  ROOT,
  "config",
  "documentation-truth-supervised-activation-v2.json",
);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^EVAVO-STUDIO\/[A-Za-z0-9._-]{1,100}$/;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const RESULT_STATES = new Set(["SUCCESS", "NO_ACTION", "BLOCKED", "REJECTED"]);
const FALSE_AUTHORITY_FIELDS = Object.freeze([
  "workerCommitPerformed",
  "workerPushPerformed",
  "publicationPerformed",
  "deploymentPerformed",
  "financialActionPerformed",
  "paidFallbackUsed",
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function string(value, label, maximum = 4096) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    /[\u0000\r\n]/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value;
}

function sha(value, label, pattern = SHA256) {
  const selected = string(value, label, 64).toLowerCase();
  if (!pattern.test(selected)) throw new Error(`${label} is invalid.`);
  return selected;
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, ordered(value[key])]),
  );
}

function canonical(value) {
  return JSON.stringify(ordered(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function without(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function safeError(value) {
  let text = String(value ?? "fixture verification failed");
  text = text.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  text = text.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  text = text.replace(
    /(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi,
    "credential=<redacted>",
  );
  return text.slice(0, 1200);
}

function regularFile(value, label, maximum = MAX_RECEIPT_BYTES) {
  const resolved = fs.realpathSync.native(path.resolve(string(value, `${label} path`)));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  if (stat.size < 2 || stat.size > maximum) {
    throw new Error(`${label} is outside its bounded byte limit.`);
  }
  return resolved;
}

function realDirectory(value, label) {
  const resolved = fs.realpathSync.native(path.resolve(string(value, `${label} path`)));
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real non-symlink directory.`);
  }
  return resolved;
}

function inside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readJson(file, label) {
  const bytes = fs.readFileSync(file);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
  return { bytes, sha256: sha256(bytes), document: object(document, label) };
}

function timestamp(value, label) {
  const text = string(value, label, 64);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return milliseconds;
}

function exactPaths(value, label, { minimum = 0, maximum = 2 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} has an invalid path count.`);
  }
  const result = value.map((item) => string(item, `${label} entry`, 512).replaceAll("\\", "/"));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates.`);
  return result;
}

function assertFalseAuthority(document, label) {
  for (const field of FALSE_AUTHORITY_FIELDS) {
    if (document[field] !== false) throw new Error(`${label}.${field} must be false.`);
  }
}

function assertScenarioSemantics(receipt, policy) {
  const id = receipt.id;
  const changedPaths = exactPaths(receipt.changedPaths ?? [], `${id}.changedPaths`);
  const changedFiles = receipt.changedFiles ?? changedPaths.length;
  const changedLines = receipt.changedLines ?? 0;
  if (!Number.isInteger(changedFiles) || changedFiles < 0 || changedFiles > 1) {
    throw new Error(`${id} changedFiles exceeds the one-file bound.`);
  }
  if (!Number.isInteger(changedLines) || changedLines < 0 || changedLines > 600) {
    throw new Error(`${id} changedLines exceeds the 600-line bound.`);
  }
  if (changedPaths.some((item) => !policy.allowedPaths.includes(item))) {
    throw new Error(`${id} changed a non-canonical capability-manifest path.`);
  }

  if (id === "success-one-manifest-file-only") {
    if (
      receipt.resultState !== "SUCCESS" ||
      receipt.passed !== true ||
      changedFiles !== 1 ||
      changedPaths.length !== 1 ||
      changedLines < 1
    ) {
      throw new Error(`${id} does not prove one successful bounded manifest change.`);
    }
    return;
  }
  if (id === "no-action-already-correct") {
    if (
      receipt.resultState !== "NO_ACTION" ||
      receipt.passed !== true ||
      changedFiles !== 0 ||
      changedPaths.length !== 0 ||
      changedLines !== 0
    ) {
      throw new Error(`${id} does not prove a clean NO_ACTION outcome.`);
    }
    return;
  }
  if (!["BLOCKED", "REJECTED"].includes(receipt.resultState)) {
    throw new Error(`${id} must be BLOCKED or REJECTED.`);
  }
  if (
    receipt.passed !== true ||
    receipt.attemptObserved !== true ||
    receipt.attemptRejected !== true ||
    changedFiles !== 0 ||
    changedPaths.length !== 0 ||
    changedLines !== 0
  ) {
    throw new Error(`${id} does not prove a zero-effect rejected attempt.`);
  }
  if (id === "publication-attempt-rejected" && receipt.publicationAttemptObserved !== true) {
    throw new Error(`${id} did not observe the intended publication attempt.`);
  }
  if (id === "paid-fallback-rejected" && receipt.paidFallbackAttemptObserved !== true) {
    throw new Error(`${id} did not observe the intended paid-fallback attempt.`);
  }
  if (id === "stale-head-rejected" && receipt.staleHeadObserved !== true) {
    throw new Error(`${id} did not observe source-head drift.`);
  }
  if (id === "forbidden-path-rejected" && receipt.forbiddenPathObserved !== true) {
    throw new Error(`${id} did not observe a forbidden path.`);
  }
  if (id === "second-file-rejected" && receipt.secondFileObserved !== true) {
    throw new Error(`${id} did not observe a second changed file.`);
  }
  if (id === "line-limit-rejected" && receipt.lineLimitExceededObserved !== true) {
    throw new Error(`${id} did not observe the line-limit violation.`);
  }
}

try {
  const [acceptanceInput, evidenceRootInput, nowInput] = process.argv.slice(2);
  if (!acceptanceInput || !evidenceRootInput || process.argv.slice(2).length > 3) {
    throw new Error(
      "Usage: node scripts/verify-documentation-truth-supervised-fixture-acceptance-v2.mjs <acceptance.json> <scenario-evidence-root> [now-iso]",
    );
  }
  const policy = readJson(
    regularFile(POLICY_PATH, "activation policy", 2 * 1024 * 1024),
    "activation policy",
  ).document;
  if (
    policy.schemaVersion !== 2 ||
    policy.kind !== "evavo-documentation-truth-supervised-activation-policy-v2"
  ) {
    throw new Error("Activation policy kind/schema is invalid.");
  }
  const acceptancePath = regularFile(acceptanceInput, "fixture acceptance");
  const evidenceRoot = realDirectory(evidenceRootInput, "scenario evidence root");
  const acceptanceEvidence = readJson(acceptancePath, "fixture acceptance");
  const acceptance = acceptanceEvidence.document;
  if (
    acceptance.schemaVersion !== 2 ||
    acceptance.kind !== "evavo-documentation-truth-supervised-fixture-acceptance-v2"
  ) {
    throw new Error("Fixture acceptance kind/schema is invalid.");
  }
  const bodySha = sha256(Buffer.from(canonical(without(acceptance, "acceptanceSha256")), "utf8"));
  if (sha(acceptance.acceptanceSha256, "acceptanceSha256") !== bodySha) {
    throw new Error("Fixture acceptance canonical digest is invalid.");
  }
  if (
    acceptance.accepted !== true ||
    acceptance.supervised !== true ||
    acceptance.workerClass !== policy.workerClass ||
    acceptance.workClass !== policy.workClass ||
    acceptance.capacityClass !== policy.capacityClass ||
    acceptance.maximumConcurrency !== 1 ||
    acceptance.maximumAutomaticAttempts !== 1 ||
    acceptance.maximumChangedFiles !== 1 ||
    acceptance.maximumChangedLines !== 600
  ) {
    throw new Error("Fixture acceptance does not preserve the bounded worker policy.");
  }
  if (!REPOSITORY.test(string(acceptance.repository, "repository", 140))) {
    throw new Error("Fixture acceptance repository is invalid.");
  }
  const sourceRevision = sha(acceptance.sourceRevision, "sourceRevision", SHA1);
  assertFalseAuthority(acceptance, "fixture acceptance");
  const acceptedAt = timestamp(acceptance.acceptedAt, "acceptedAt");
  const now = nowInput ? timestamp(nowInput, "verification time") : Date.now();
  if (acceptedAt - now > 120_000) throw new Error("Fixture acceptance is future-dated.");
  if (
    now - acceptedAt >
    policy.maximumEvidenceAgeSeconds.supervisedFixtureAcceptance * 1000
  ) {
    throw new Error("Fixture acceptance is stale.");
  }

  if (!Array.isArray(acceptance.scenarios)) {
    throw new Error("Fixture acceptance scenarios are missing.");
  }
  const expectedIds = [...policy.requiredFixtureScenarios].sort();
  const observedIds = acceptance.scenarios
    .map((item) => string(item?.id, "scenario id", 128))
    .sort();
  if (
    observedIds.length !== expectedIds.length ||
    observedIds.some((item, index) => item !== expectedIds[index])
  ) {
    throw new Error("Fixture acceptance scenario set is incomplete or contains extras.");
  }

  const verifiedScenarios = [];
  let latestScenarioAt = 0;
  for (const summary of acceptance.scenarios) {
    const id = summary.id;
    const relative = string(summary.path, `${id}.path`, 512).replaceAll("\\", "/");
    if (
      relative.startsWith("/") ||
      /^[A-Za-z]:\//.test(relative) ||
      relative.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error(`${id} scenario receipt path is unsafe.`);
    }
    const candidate = path.resolve(evidenceRoot, relative);
    if (!inside(candidate, evidenceRoot)) throw new Error(`${id} scenario receipt escaped evidence root.`);
    const scenarioPath = regularFile(candidate, `${id} scenario receipt`);
    if (!inside(scenarioPath, evidenceRoot)) throw new Error(`${id} real scenario path escaped evidence root.`);
    const evidence = readJson(scenarioPath, `${id} scenario receipt`);
    const expectedSha = sha(summary.receiptSha256, `${id}.receiptSha256`);
    if (evidence.sha256 !== expectedSha) throw new Error(`${id} exact receipt digest changed.`);
    const receipt = evidence.document;
    if (
      receipt.schemaVersion !== 2 ||
      receipt.kind !== "evavo-documentation-truth-fixture-scenario-receipt-v2" ||
      receipt.id !== id ||
      receipt.repository !== acceptance.repository ||
      receipt.sourceRevision !== sourceRevision ||
      receipt.workerClass !== policy.workerClass ||
      receipt.workClass !== policy.workClass ||
      receipt.capacityClass !== policy.capacityClass ||
      receipt.maximumConcurrency !== 1 ||
      receipt.maximumAutomaticAttempts !== 1 ||
      receipt.paidFallbackAllowed !== false ||
      !RESULT_STATES.has(receipt.resultState)
    ) {
      throw new Error(`${id} scenario identity or worker boundary is invalid.`);
    }
    assertFalseAuthority(receipt, `${id} scenario receipt`);
    assertScenarioSemantics(receipt, policy);
    const observedAt = timestamp(receipt.observedAt, `${id}.observedAt`);
    if (observedAt - acceptedAt > 120_000) {
      throw new Error(`${id} scenario is dated after campaign acceptance.`);
    }
    latestScenarioAt = Math.max(latestScenarioAt, observedAt);
    verifiedScenarios.push({
      id,
      receiptSha256: evidence.sha256,
      byteLength: evidence.bytes.length,
      resultState: receipt.resultState,
      changedFiles: receipt.changedFiles ?? (receipt.changedPaths ?? []).length,
      changedLines: receipt.changedLines ?? 0,
    });
  }
  if (latestScenarioAt > acceptedAt) {
    throw new Error("Fixture campaign was accepted before all scenarios completed.");
  }

  const body = {
    schemaVersion: 2,
    kind: "evavo-documentation-truth-supervised-fixture-verification-v2",
    accepted: true,
    repository: acceptance.repository,
    sourceRevision,
    workerClass: policy.workerClass,
    workClass: policy.workClass,
    capacityClass: policy.capacityClass,
    maximumConcurrency: 1,
    maximumAutomaticAttempts: 1,
    maximumChangedFiles: 1,
    maximumChangedLines: 600,
    acceptanceBytesSha256: acceptanceEvidence.sha256,
    acceptanceCanonicalSha256: bodySha,
    acceptedAt: new Date(acceptedAt).toISOString(),
    verifiedAt: new Date(now).toISOString(),
    scenarios: verifiedScenarios.sort((left, right) => left.id.localeCompare(right.id)),
    allRequiredScenariosVerified: true,
    evidenceRootReturned: false,
    workerCommitPerformed: false,
    workerPushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    truthBoundary: "This verification proves exact supervised fixture receipt bytes and scenario semantics only. It grants no configuration, queue, lease, model, Git, publication, deployment, financial or paid-fallback authority.",
  };
  process.stdout.write(`${JSON.stringify({
    ...body,
    verificationSha256: sha256(Buffer.from(canonical(body), "utf8")),
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 2,
    kind: "evavo-documentation-truth-supervised-fixture-verification-v2",
    accepted: false,
    errorType: error?.constructor?.name ?? "Error",
    errorMessage: safeError(error?.message ?? error),
    evidenceRootReturned: false,
    workerCommitPerformed: false,
    workerPushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
