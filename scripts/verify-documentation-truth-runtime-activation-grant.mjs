#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyDocumentationTruthRuntimeActivationGrant } from "./documentation-truth-runtime-activation-verifier-core.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function regularFile(value, label, maximum = 8 * 1024 * 1024) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximum) {
    throw new Error(`${label} must be a bounded regular non-symlink file.`);
  }
  return resolved;
}
function readJsonBytes(value, label, maximum = 8 * 1024 * 1024) {
  const resolved = regularFile(value, label, maximum);
  const bytes = fs.readFileSync(resolved);
  let document;
  try { document = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} is not valid UTF-8 JSON.`); }
  if (!OBJECT(document)) throw new Error(`${label} must contain one JSON object.`);
  return { resolved, bytes, sha256: sha256(bytes), document };
}
function parseArguments(values) {
  const options = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || options.has(key)) {
      throw new Error(
        "Usage: node scripts/verify-documentation-truth-runtime-activation-grant.mjs --envelope <json> --trust-anchor <json> --request <json> --now <ISO-8601> --consumed-uses <integer>",
      );
    }
    options.set(key, value);
  }
  for (const key of ["--envelope", "--trust-anchor", "--request", "--now", "--consumed-uses"]) {
    if (!options.has(key)) throw new Error(`Missing required option ${key}.`);
  }
  const now = new Date(options.get("--now"));
  if (!Number.isFinite(now.getTime())) throw new Error("--now is invalid.");
  const consumedUses = Number.parseInt(options.get("--consumed-uses"), 10);
  if (!Number.isSafeInteger(consumedUses) || consumedUses < 0 || String(consumedUses) !== options.get("--consumed-uses")) {
    throw new Error("--consumed-uses must be a canonical non-negative integer.");
  }
  return {
    envelope: options.get("--envelope"),
    trustAnchor: options.get("--trust-anchor"),
    request: options.get("--request"),
    now,
    consumedUses,
  };
}

export async function verifyDocumentationTruthRuntimeActivationGrantFiles({
  envelopePath,
  trustAnchorPath,
  requestPath,
  now,
  consumedUses,
}) {
  const envelope = readJsonBytes(envelopePath, "Signed runtime activation grant envelope");
  const trustAnchor = readJsonBytes(trustAnchorPath, "Runtime activation trust anchor", 1 * 1024 * 1024);
  const request = readJsonBytes(requestPath, "Runtime activation grant request");
  const result = await verifyDocumentationTruthRuntimeActivationGrant({
    envelope: envelope.document,
    request: request.document,
    trustAnchor: trustAnchor.document,
    now,
    consumedUses,
  });
  const body = {
    ...result,
    verifiedAt: now.toISOString(),
    requestBytesSha256: request.sha256,
    envelopeBytesSha256: envelope.sha256,
    trustAnchorBytesSha256: trustAnchor.sha256,
  };
  return {
    ...body,
    verificationSha256: sha256(Buffer.from(JSON.stringify(body, Object.keys(body).sort()), "utf8")),
  };
}

const directInvocation = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directInvocation) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = await verifyDocumentationTruthRuntimeActivationGrantFiles({
      envelopePath: args.envelope,
      trustAnchorPath: args.trustAnchor,
      requestPath: args.request,
      now: args.now,
      consumedUses: args.consumedUses,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      kind: "evavo-documentation-truth-runtime-activation-grant-verification-v1",
      accepted: false,
      errors: [String(error?.message ?? error).slice(0, 2000)],
      leaseAcquired: false,
      modelTurnPerformed: false,
      queueMutationPerformed: false,
      repositoryMutationPerformed: false,
      commitPerformed: false,
      pushPerformed: false,
      publicationPerformed: false,
      deploymentPerformed: false,
      financialActionPerformed: false,
      paidFallbackUsed: false,
      privateKeyAccessed: false,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
