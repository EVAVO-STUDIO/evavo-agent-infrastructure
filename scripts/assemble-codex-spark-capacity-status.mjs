#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileCodexSparkCapacityStatus } from "./codex-spark-capacity-status-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(ROOT, "config", "codex-spark-capacity-status-v1.json");
const VERIFIER_PATH = path.join(ROOT, "scripts", "verify-codex-spark-safe-physical-acceptance.mjs");

function parseArguments(values) {
  const allowed = new Set(["--capacity-observation", "--supervised-acceptance", "--capability", "--now"]);
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || !value || result.has(name)) {
      throw new Error("Usage: node scripts/assemble-codex-spark-capacity-status.mjs --capacity-observation <json> --supervised-acceptance <json> --capability <json> [--now <ISO-8601>]");
    }
    result.set(name, value);
  }
  for (const required of ["--capacity-observation", "--supervised-acceptance", "--capability"]) {
    if (!result.has(required)) throw new Error(`Missing required argument: ${required}`);
  }
  return result;
}

function regularFile(value, label) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return resolved;
}

function readJsonBytes(file, label) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 2 || bytes.length > 4 * 1024 * 1024) throw new Error(`${label} is outside the bounded 4 MiB evidence limit.`);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain a JSON object.`);
  return { bytes, value };
}

function safeError(value) {
  let text = String(value ?? "capacity status assembly failed");
  text = text.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  text = text.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  text = text.replace(/\b(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi, "credential=<redacted>");
  return text.slice(0, 1000);
}

try {
  const args = parseArguments(process.argv.slice(2));
  const policy = readJsonBytes(regularFile(POLICY_PATH, "Spark capacity policy"), "Spark capacity policy").value;
  const capacity = readJsonBytes(
    regularFile(args.get("--capacity-observation"), "raw capacity observation"),
    "raw capacity observation",
  );
  const acceptancePath = regularFile(args.get("--supervised-acceptance"), "supervised physical acceptance");
  const acceptance = readJsonBytes(acceptancePath, "supervised physical acceptance");
  const capabilityPath = regularFile(args.get("--capability"), "fresh Codex capability receipt");
  const capability = readJsonBytes(capabilityPath, "fresh Codex capability receipt");

  const verifier = spawnSync(process.execPath, [VERIFIER_PATH, acceptancePath, capabilityPath], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (verifier.error) throw verifier.error;
  if (![0, 1].includes(verifier.status)) throw new Error("Supervised acceptance verifier ended outside its admitted success/rejection exit codes.");
  const verificationText = String(verifier.stdout ?? "").trim();
  let verification;
  try {
    verification = JSON.parse(verificationText);
  } catch {
    throw new Error("Supervised acceptance verifier did not return one valid JSON object.");
  }
  if (verification?.kind !== "evavo-codex-spark-safe-physical-acceptance-verification-v1") {
    throw new Error("Supervised acceptance verifier returned an unexpected receipt kind.");
  }
  if (typeof verification.accepted !== "boolean") {
    throw new Error("Supervised acceptance verifier omitted its boolean accepted decision.");
  }
  if ((verifier.status === 0) !== verification.accepted) {
    throw new Error("Supervised acceptance verifier exit status contradicts its accepted decision.");
  }

  const nowInput = args.get("--now");
  const now = nowInput ? new Date(nowInput) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("--now must be a valid ISO-8601 timestamp.");

  const status = compileCodexSparkCapacityStatus({
    policy,
    capacityObservation: capacity.value,
    capacityObservationBytes: capacity.bytes,
    supervisedAcceptance: acceptance.value,
    supervisedAcceptanceBytes: acceptance.bytes,
    capabilityReceipt: capability.value,
    capabilityReceiptBytes: capability.bytes,
    acceptanceVerification: verification,
    acceptanceVerificationBytes: Buffer.from(String(verifier.stdout ?? ""), "utf8"),
    now,
  });
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-worker-capacity-status-assembly-error-v1",
    ok: false,
    errorType: error?.constructor?.name ?? "Error",
    errorMessage: safeError(error?.message ?? error),
    physicalPathsReturned: false,
    credentialValuesReturned: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 2;
}
