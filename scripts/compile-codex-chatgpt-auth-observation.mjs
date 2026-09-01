#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error("Usage: node scripts/compile-codex-chatgpt-auth-observation.mjs <auth-policy-probe.json>");
  process.exit(2);
}

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_SOURCE_AGE_MS = 10 * 60_000;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const resolved = fs.realpathSync.native(path.resolve(inputPath));
const stat = fs.lstatSync(resolved);
if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Authentication-policy probe must be a regular non-symlink file.");
if (stat.size < 2 || stat.size > MAX_INPUT_BYTES) throw new Error("Authentication-policy probe size is outside the bounded contract.");
const bytes = fs.readFileSync(resolved);
let source;
try {
  source = JSON.parse(bytes.toString("utf8"));
} catch {
  throw new Error("Authentication-policy probe must contain UTF-8 JSON.");
}
if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Authentication-policy probe must contain one JSON object.");
const sourceKind = String(source.kind ?? "");
if (source.schemaVersion !== 1 || !sourceKind.includes("codex") || !sourceKind.includes("auth")) {
  throw new Error("Authentication-policy probe kind/schema is invalid.");
}
const sourceObservedAtRaw = source.observedAt ?? source.recordedAt ?? source.completedAt ?? source.verifiedAt ?? null;
const sourceObservedAtMs = typeof sourceObservedAtRaw === "string" ? Date.parse(sourceObservedAtRaw) : Number.NaN;
if (!Number.isFinite(sourceObservedAtMs)) throw new Error("Authentication-policy probe lacks a valid observation timestamp.");
if (Date.now() - sourceObservedAtMs > MAX_SOURCE_AGE_MS || sourceObservedAtMs - Date.now() > 120_000) {
  throw new Error("Authentication-policy probe is stale or future-dated.");
}

const policy = source.policy && typeof source.policy === "object" ? source.policy : {};
const forcedMethod = String(
  source.forcedLoginMethod ?? source.forced_login_method ?? policy.forcedLoginMethod ?? policy.forced_login_method ?? "",
).toLowerCase();
const allowedRaw = source.allowedLoginMethods ?? source.allowed_login_methods ?? policy.allowedLoginMethods ?? policy.allowed_login_methods ?? [];
const allowedMethods = Array.isArray(allowedRaw)
  ? [...new Set(allowedRaw.filter((value) => typeof value === "string").map((value) => value.toLowerCase()))]
  : [];
const explicitPositive =
  source.accepted === true ||
  source.authPolicyAccepted === true ||
  source.chatgptOnly === true ||
  source.chatgptConsumerOnly === true ||
  source.eligibleForConsumerAuth === true;
const forcedChatgpt = forcedMethod === "chatgpt";
const allowedChatgptOnly = allowedMethods.length === 1 && allowedMethods[0] === "chatgpt";
const apiOrMixedDeclared =
  source.apiKeyAllowed === true ||
  source.apiLoginAllowed === true ||
  source.mixedLoginAllowed === true ||
  source.providerApiCredentialsRequired === true ||
  allowedMethods.some((method) => method !== "chatgpt") ||
  (forcedMethod.length > 0 && forcedMethod !== "chatgpt");
const credentialValuesRead = source.credentialValuesRead === true || source.credentialsRead === true || source.secretValuesRead === true;
const accepted = (explicitPositive || forcedChatgpt || allowedChatgptOnly) && !apiOrMixedDeclared && !credentialValuesRead;
const reasons = [];
if (!(explicitPositive || forcedChatgpt || allowedChatgptOnly)) reasons.push("chatgpt-only-login-not-proven");
if (apiOrMixedDeclared) reasons.push("api-or-mixed-login-permitted");
if (credentialValuesRead) reasons.push("credential-values-read");

console.log(JSON.stringify({
  schemaVersion: 1,
  kind: "evavo-codex-chatgpt-auth-observation-v1",
  observedAt: new Date(sourceObservedAtMs).toISOString(),
  accepted,
  authPolicyAccepted: accepted,
  authenticationClass: accepted ? "chatgpt-consumer" : "unaccepted",
  chatgptOnly: accepted,
  chatgptConsumerOnly: accepted,
  forcedLoginMethod: forcedMethod || null,
  allowedLoginMethods: allowedMethods,
  apiKeyAllowed: false,
  apiLoginAllowed: false,
  mixedLoginAllowed: false,
  providerApiCredentialsRequired: false,
  credentialValuesRead: false,
  sourceKind,
  sourceReceiptSha256: sha256(bytes),
  sourceReceiptBytes: bytes.length,
  rejectionReasons: reasons,
  modelTurnPerformed: false,
  authenticationMutationPerformed: false,
  credentialValuesReturned: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
  truthBoundary:
    "This observation normalizes one fresh read-only Codex login-policy probe. ChatGPT consumer authentication is accepted only when ChatGPT-only policy is explicit and no API/mixed login or credential-value read is reported. It neither logs in nor reads credentials.",
}, null, 2));
