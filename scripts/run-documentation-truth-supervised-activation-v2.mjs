#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERIFIER = path.join(
  ROOT,
  "scripts",
  "verify-documentation-truth-supervised-fixture-acceptance-v2.mjs",
);
const COMPILER = path.join(
  ROOT,
  "scripts",
  "compile-documentation-truth-supervised-activation-v2.mjs",
);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FALSE_AUTHORITY_FIELDS = Object.freeze([
  "configurationMutationPerformed",
  "queueMutationPerformed",
  "leaseAcquired",
  "modelTurnPerformed",
  "repositoryMutationPerformed",
  "commitPerformed",
  "pushPerformed",
  "publicationPerformed",
  "deploymentPerformed",
  "financialActionPerformed",
  "paidFallbackUsed",
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function regularFile(value, label) {
  const resolved = fs.realpathSync.native(path.resolve(string(value, `${label} path`)));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 16 * 1024 * 1024) {
    throw new Error(`${label} must be a bounded regular non-symlink file.`);
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

function safeError(value) {
  let text = String(value ?? "supervised activation failed");
  text = text.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  text = text.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  text = text.replace(
    /(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi,
    "credential=<redacted>",
  );
  return text.slice(0, 1200);
}

function parseArguments(values) {
  const allowed = new Set([
    "--wave-manifest",
    "--wave-validation",
    "--repository-head",
    "--work-exchange-receipt",
    "--codex-capability",
    "--capacity-status",
    "--fixture-acceptance",
    "--fixture-evidence-root",
    "--candidate-validation",
    "--primary-attestation",
    "--now",
  ]);
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || !value || result.has(name)) {
      throw new Error("Supervised activation arguments are invalid or duplicated.");
    }
    result.set(name, value);
  }
  for (const name of [...allowed].filter((item) => item !== "--now")) {
    if (!result.has(name)) throw new Error(`Missing required argument ${name}.`);
  }
  return result;
}

function minimalEnvironment() {
  return {
    PATH: process.env.PATH ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    WINDIR: process.env.WINDIR ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    NO_COLOR: "1",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "0",
    EVAVO_CODEX_SPARK_CERTIFICATION_MODE: "0",
  };
}

function runJson(executable, argv, label) {
  const completed = spawnSync(executable, argv, {
    cwd: ROOT,
    env: minimalEnvironment(),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const channel = completed.status === 0 ? completed.stdout : completed.stderr || completed.stdout;
  let document;
  try {
    document = JSON.parse(String(channel ?? "").trim());
  } catch {
    throw new Error(`${label} did not return one JSON object.`);
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${label} returned an invalid JSON document.`);
  }
  return {
    status: completed.status,
    bytes: Buffer.from(String(channel ?? ""), "utf8"),
    document,
  };
}

function assertNoAuthority(document, label) {
  for (const field of FALSE_AUTHORITY_FIELDS) {
    if (document[field] === true) throw new Error(`${label} claims prohibited ${field}.`);
  }
}

try {
  const args = parseArguments(process.argv.slice(2));
  const fixtureAcceptance = regularFile(args.get("--fixture-acceptance"), "fixture acceptance");
  const fixtureEvidenceRoot = realDirectory(
    args.get("--fixture-evidence-root"),
    "fixture evidence root",
  );
  const now = args.get("--now") ?? new Date().toISOString();

  const verification = runJson(
    process.execPath,
    [VERIFIER, fixtureAcceptance, fixtureEvidenceRoot, now],
    "Fixture verifier",
  );
  if (
    verification.status !== 0 ||
    verification.document.schemaVersion !== 2 ||
    verification.document.kind !==
      "evavo-documentation-truth-supervised-fixture-verification-v2" ||
    verification.document.accepted !== true ||
    verification.document.allRequiredScenariosVerified !== true
  ) {
    throw new Error(
      `Fixture verification was not accepted: ${safeError(
        verification.document.errorMessage ?? verification.document,
      )}`,
    );
  }
  assertNoAuthority(verification.document, "Fixture verification");
  const fixtureBytes = fs.readFileSync(fixtureAcceptance);
  if (verification.document.acceptanceBytesSha256 !== sha256(fixtureBytes)) {
    throw new Error("Fixture verification is not bound to the exact acceptance bytes.");
  }
  if (!SHA256.test(verification.document.verificationSha256 ?? "")) {
    throw new Error("Fixture verification digest is invalid.");
  }
  const expectedVerification = sha256(
    Buffer.from(
      canonical(
        Object.fromEntries(
          Object.entries(verification.document).filter(
            ([name]) => name !== "verificationSha256",
          ),
        ),
      ),
      "utf8",
    ),
  );
  if (expectedVerification !== verification.document.verificationSha256) {
    throw new Error("Fixture verification canonical digest does not match.");
  }

  const compilerArguments = [COMPILER];
  for (const name of [
    "--wave-manifest",
    "--wave-validation",
    "--repository-head",
    "--work-exchange-receipt",
    "--codex-capability",
    "--capacity-status",
    "--fixture-acceptance",
    "--candidate-validation",
    "--primary-attestation",
  ]) {
    compilerArguments.push(name, regularFile(args.get(name), name));
  }
  compilerArguments.push("--now", now);
  const activation = runJson(
    process.execPath,
    compilerArguments,
    "Activation compiler",
  );
  if (activation.status !== 0 && activation.document.decision !== "REJECTED") {
    throw new Error("Activation compiler exit status contradicts its decision.");
  }
  if (
    activation.document.schemaVersion !== 2 ||
    activation.document.kind !==
      "evavo-documentation-truth-supervised-activation-decision-v2" ||
    !["ACTIVATE_ELIGIBLE", "RETAIN_READY", "REJECTED"].includes(
      activation.document.decision,
    )
  ) {
    throw new Error("Activation compiler returned an invalid decision.");
  }
  assertNoAuthority(activation.document, "Activation decision");
  if (
    activation.document.repository !== verification.document.repository ||
    activation.document.sourceRevision !== verification.document.sourceRevision ||
    !SHA1.test(activation.document.sourceRevision ?? "")
  ) {
    throw new Error("Fixture verification and activation source identity differ.");
  }

  const body = {
    schemaVersion: 2,
    kind: "evavo-documentation-truth-supervised-activation-run-v2",
    decision: activation.document.decision,
    eligible: activation.document.decision === "ACTIVATE_ELIGIBLE",
    repository: activation.document.repository,
    sourceRevision: activation.document.sourceRevision,
    workerClass: "documentation-truth",
    workClass: "capability-manifest-maintenance",
    routeId: activation.document.routeId,
    capacityClass: activation.document.capacityClass,
    maximumConcurrency: 1,
    maximumAutomaticAttempts: 1,
    activationDecisionSha256: activation.document.activationDecisionSha256,
    activationDecisionBytesSha256: sha256(activation.bytes),
    fixtureAcceptanceBytesSha256: verification.document.acceptanceBytesSha256,
    fixtureVerificationSha256: verification.document.verificationSha256,
    fixtureVerificationBytesSha256: sha256(verification.bytes),
    blockers: activation.document.blockers ?? [],
    rejections: activation.document.rejections ?? [],
    observedAt: activation.document.observedAt,
    expiresAt: activation.document.expiresAt,
    configurationMutationPerformed: false,
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
    truthBoundary: "This runner proves that the activation decision consumed an exact-byte-verified supervised fixture campaign. It still performs no configuration, queue, lease, model, repository, Git, publication, deployment, financial or paid-fallback effect.",
  };
  process.stdout.write(`${JSON.stringify({
    ...body,
    activationRunSha256: sha256(Buffer.from(canonical(body), "utf8")),
  }, null, 2)}\n`);
  process.exitCode = activation.document.decision === "REJECTED" ? 1 : 0;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 2,
    kind: "evavo-documentation-truth-supervised-activation-run-v2",
    decision: "REJECTED",
    eligible: false,
    errorType: error?.constructor?.name ?? "Error",
    errorMessage: safeError(error?.message ?? error),
    configurationMutationPerformed: false,
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
