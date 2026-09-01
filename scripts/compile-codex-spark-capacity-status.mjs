#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { compileCodexSparkCapacityStatus } from "./codex-spark-capacity-status-core.mjs";

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!name?.startsWith("--") || value == null) {
    console.error(
      "Usage: node scripts/compile-codex-spark-capacity-status.mjs --capacity-observation <json> --codex-capability <json> --chatgpt-auth-policy <json> [--supervised-acceptance <json>]",
    );
    process.exit(2);
  }
  if (options.has(name)) {
    console.error(`Duplicate option: ${name}`);
    process.exit(2);
  }
  options.set(name, value);
}

for (const required of ["--capacity-observation", "--codex-capability", "--chatgpt-auth-policy"]) {
  if (!options.has(required)) {
    console.error(`Missing required option: ${required}`);
    process.exit(2);
  }
}
for (const name of options.keys()) {
  if (!["--capacity-observation", "--codex-capability", "--chatgpt-auth-policy", "--supervised-acceptance"].includes(name)) {
    console.error(`Unsupported option: ${name}`);
    process.exit(2);
  }
}

function regularFile(value, label) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return resolved;
}

function readBytes(file, label, maximum = 4 * 1024 * 1024) {
  const bytes = fs.readFileSync(file);
  if (bytes.length === 0 || bytes.length > maximum) throw new Error(`${label} has an invalid byte length.`);
  return bytes;
}

function readJsonBytes(file, label) {
  const bytes = readBytes(file, label);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 JSON: ${error?.message ?? error}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain a JSON object.`);
  return { bytes, value };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function normalizeAuthenticationPolicy(raw) {
  const accepted =
    raw.accepted === true ||
    raw.chatgptOnly === true ||
    raw.chatgptConsumerOnly === true ||
    raw.eligibleForConsumerAuth === true ||
    raw.authenticationClass === "chatgpt-consumer" && raw.policyAccepted === true;
  return {
    schemaVersion: 1,
    kind: "evavo-codex-chatgpt-authentication-admission-v1",
    observedAt: raw.observedAt ?? raw.checkedAt ?? raw.recordedAt,
    accepted,
    authenticationClass: accepted ? "chatgpt-consumer" : String(raw.authenticationClass ?? "unadmitted"),
    credentialValuesReturned: raw.credentialValuesReturned === true,
  };
}

function loadRoutePolicy() {
  const routing = JSON.parse(fs.readFileSync(path.resolve("config/worker-capacity-routing-v1.json"), "utf8"));
  const route = (routing.workerRoutes ?? []).find((entry) => entry.id === "codex-spark-pro");
  if (!route) throw new Error("Canonical codex-spark-pro route is unavailable.");
  return route;
}

function loadPhysicalPolicy() {
  return JSON.parse(fs.readFileSync(path.resolve("config/codex-spark-physical-acceptance-v1.json"), "utf8"));
}

try {
  const capacityPath = regularFile(options.get("--capacity-observation"), "Spark capacity observation");
  const capabilityPath = regularFile(options.get("--codex-capability"), "Codex capability receipt");
  const authenticationPath = regularFile(options.get("--chatgpt-auth-policy"), "ChatGPT authentication-policy receipt");
  const capacity = readJsonBytes(capacityPath, "Spark capacity observation");
  const capability = readJsonBytes(capabilityPath, "Codex capability receipt");
  const authenticationRaw = readJsonBytes(authenticationPath, "ChatGPT authentication-policy receipt");
  const authentication = normalizeAuthenticationPolicy(authenticationRaw.value);

  let supervisedAcceptanceSha256 = null;
  let supervisedAt = null;
  let physicalVerification = null;
  const supervisedInput = options.get("--supervised-acceptance");
  if (supervisedInput) {
    const supervisedPath = regularFile(supervisedInput, "Supervised physical acceptance");
    const supervised = readJsonBytes(supervisedPath, "Supervised physical acceptance");
    supervisedAcceptanceSha256 = sha256(supervised.bytes);
    supervisedAt = supervised.value.supervisedAt;

    const verifier = regularFile(
      path.resolve("scripts/verify-codex-spark-safe-physical-acceptance.mjs"),
      "Supervised physical-acceptance verifier",
    );
    const verified = spawnSync(process.execPath, [verifier, supervisedPath, capabilityPath], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    try {
      physicalVerification = JSON.parse(String(verified.stdout ?? "").trim());
    } catch {
      throw new Error(
        `Supervised physical-acceptance verifier did not return valid JSON: ${String(verified.stderr ?? "").trim().slice(0, 2048)}`,
      );
    }
    if (verified.status !== 0 && physicalVerification?.accepted === true) {
      throw new Error("Supervised physical-acceptance verifier returned a contradictory successful receipt with a failing exit code.");
    }
  }

  const status = compileCodexSparkCapacityStatus({
    now: new Date(),
    routePolicy: loadRoutePolicy(),
    physicalPolicy: loadPhysicalPolicy(),
    capacityObservation: capacity.value,
    capabilityReceipt: capability.value,
    authenticationReceipt: authentication,
    physicalVerification,
    supervisedAt,
    sourceDigests: {
      capacityObservationSha256: sha256(capacity.bytes),
      capabilityReceiptSha256: sha256(capability.bytes),
      authenticationReceiptSha256: sha256(authenticationRaw.bytes),
      supervisedAcceptanceSha256,
    },
  });
  console.log(JSON.stringify(status, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        schemaVersion: 1,
        kind: "evavo-worker-capacity-status-error-v1",
        ok: false,
        errorType: error?.constructor?.name ?? "Error",
        errorMessage: String(error?.message ?? error).slice(0, 4096),
        capacityAloneGrantsDispatch: false,
        paidFallbackAllowed: false,
        modelTurnPerformed: false,
        repositoryMutationPerformed: false,
        publicationPerformed: false,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
