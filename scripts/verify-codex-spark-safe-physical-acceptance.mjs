#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [envelopePathInput, capabilityPathInput] = process.argv.slice(2);
if (!envelopePathInput || !capabilityPathInput) {
  console.error("Usage: node scripts/verify-codex-spark-safe-physical-acceptance.mjs <supervised-acceptance.json> <fresh-capability.json>");
  process.exit(2);
}
const regular = (value, label) => {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return resolved;
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const envelopePath = regular(envelopePathInput, "supervised physical acceptance");
const capabilityPath = regular(capabilityPathInput, "fresh Codex capability receipt");
const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8"));
const errors = [];

if (envelope.schemaVersion !== 1 || envelope.kind !== "evavo-codex-spark-safe-physical-acceptance-v1") errors.push("Supervised physical acceptance kind/schema is invalid.");
if (envelope.supervision?.cleanupComplete !== true) errors.push("Supervised acceptance does not prove complete detached-candidate cleanup.");
if (envelope.supervision?.fixtureRepositoryMainUnchanged !== true) errors.push("Supervised acceptance does not prove unchanged fixture main.");
if (envelope.supervision?.fixtureRepositoryClean !== true) errors.push("Supervised acceptance does not prove a clean fixture primary checkout.");
if (envelope.supervision?.fixtureRepositoryRemoteCount !== 0) errors.push("Supervised acceptance fixture must remain remote-less.");
if (envelope.supervision?.registeredWorktreesAfterCleanup !== 1) errors.push("Supervised acceptance must prove only one registered fixture worktree remains.");
if (envelope.supervision?.stagedAcceptancePromotedOnlyAfterCleanup !== true) errors.push("Supervised acceptance was not explicitly promoted after cleanup.");
if (envelope.supervision?.publicationPerformed !== false || envelope.supervision?.productRepositoryTouched !== false) errors.push("Supervised acceptance exceeds fixture-only authority.");
if (!envelope.physicalAcceptance || typeof envelope.physicalAcceptance !== "object" || Array.isArray(envelope.physicalAcceptance)) errors.push("Nested physical acceptance is missing.");
const canonicalPhysical = envelope.physicalAcceptance ? JSON.stringify(envelope.physicalAcceptance) : "";
if (!/^[0-9a-f]{64}$/.test(String(envelope.physicalAcceptanceSha256 ?? "")) || sha256(Buffer.from(canonicalPhysical, "utf8")) !== envelope.physicalAcceptanceSha256) {
  errors.push("Nested physical acceptance digest mismatch.");
}
const supervisedAt = Date.parse(envelope.supervisedAt ?? "");
if (!Number.isFinite(supervisedAt) || supervisedAt - Date.now() > 120000) errors.push("Supervision timestamp is invalid or future-dated.");

let baseVerification = null;
let temporaryPhysicalPath = null;
try {
  if (errors.length === 0) {
    temporaryPhysicalPath = path.join(os.tmpdir(), `evavo-spark-physical-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(temporaryPhysicalPath, `${JSON.stringify(envelope.physicalAcceptance, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const verifier = regular(path.resolve("scripts/verify-codex-spark-physical-acceptance.mjs"), "base physical acceptance verifier");
    const child = spawnSync(process.execPath, [verifier, temporaryPhysicalPath, capabilityPath], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    });
    try {
      baseVerification = JSON.parse(String(child.stdout ?? "").trim());
    } catch {
      errors.push(`Base physical acceptance verifier did not return valid JSON: ${String(child.stderr ?? "").trim().slice(0, 2048)}`);
    }
    if (child.status !== 0 || baseVerification?.accepted !== true) {
      const detail = Array.isArray(baseVerification?.errors) ? baseVerification.errors.join("; ") : "base verification rejected";
      errors.push(`Nested physical acceptance failed base verification: ${detail}`);
    }
  }
} finally {
  if (temporaryPhysicalPath) fs.rmSync(temporaryPhysicalPath, { force: true });
}

const accepted = errors.length === 0;
console.log(JSON.stringify({
  schemaVersion: 1,
  kind: "evavo-codex-spark-safe-physical-acceptance-verification-v1",
  accepted,
  routeId: accepted ? baseVerification.routeId : null,
  modelPreference: accepted ? baseVerification.modelPreference : null,
  workerClasses: accepted ? baseVerification.workerClasses : [],
  maximumConcurrency: accepted ? baseVerification.maximumConcurrency : 0,
  paidFallbackAllowed: false,
  supervisedCleanupProven: accepted,
  errors,
  modelTurnPerformed: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
  truthBoundary: "Normal Spark execution is admitted only by a supervised acceptance envelope whose nested physical acceptance remains fresh and whose post-certification cleanup, unchanged-main, clean-checkout, remote-less fixture and single-worktree proofs all hold."
}, null, 2));
process.exit(accepted ? 0 : 1);
