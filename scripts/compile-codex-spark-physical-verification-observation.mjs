#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePhysicalVerificationObservation } from "./codex-spark-physical-verification-observation-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [acceptanceInput, capabilityInput] = process.argv.slice(2);
if (!acceptanceInput || !capabilityInput) {
  console.error("Usage: node scripts/compile-codex-spark-physical-verification-observation.mjs <supervised-acceptance.json> <fresh-capability.json>");
  process.exit(2);
}

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
function regularJsonBytes(input, label) {
  const resolved = fs.realpathSync.native(path.resolve(input));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  if (stat.size < 2 || stat.size > MAX_INPUT_BYTES) throw new Error(`${label} size is outside the bounded contract.`);
  const bytes = fs.readFileSync(resolved);
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  } catch {
    throw new Error(`${label} must contain one UTF-8 JSON object.`);
  }
  return { resolved, bytes };
}

const acceptance = regularJsonBytes(acceptanceInput, "supervised physical acceptance");
const capability = regularJsonBytes(capabilityInput, "Codex capability receipt");
const verifier = fs.realpathSync.native(path.join(ROOT, "scripts", "verify-codex-spark-safe-physical-acceptance.mjs"));
const verifierStat = fs.lstatSync(verifier);
if (!verifierStat.isFile() || verifierStat.isSymbolicLink()) throw new Error("Supervised physical-acceptance verifier is unavailable or unsafe.");
const result = spawnSync(process.execPath, [verifier, acceptance.resolved, capability.resolved], {
  cwd: ROOT,
  env: process.env,
  encoding: "utf8",
  shell: false,
  windowsHide: true,
  timeout: 120_000,
  maxBuffer: 4 * 1024 * 1024,
});
let verification;
try {
  verification = JSON.parse(String(result.stdout ?? "").trim());
} catch {
  throw new Error(`Supervised physical verifier did not return valid JSON: ${String(result.stderr ?? "").trim().slice(0, 2048)}`);
}
if (result.status !== 0 || verification.accepted !== true) {
  const detail = Array.isArray(verification.errors) ? verification.errors.join("; ") : "verification rejected";
  throw new Error(`Supervised physical verification failed: ${detail}`);
}
const observation = compilePhysicalVerificationObservation({
  acceptanceBytes: acceptance.bytes,
  capabilityBytes: capability.bytes,
  verification,
});
console.log(JSON.stringify(observation, null, 2));
