#!/usr/bin/env node

import { createHash } from "node:crypto";

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA256 = /^[0-9a-f]{64}$/;
const REQUEST_ID = /^doc-truth-grant-request:[0-9a-f]{40}$/;
const REQUEST_KIND = "evavo-documentation-truth-runtime-grant-request-v1";
const REQUEST_IDENTITY_KIND = "evavo-documentation-truth-runtime-grant-request-identity-v1";

function canonicalValue(value, label = "value") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} contains a non-canonical number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonicalValue(entry, `${label}[${index}]`));
  if (OBJECT(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => {
          if (value[key] === undefined) throw new Error(`${label}.${key} is undefined.`);
          return [key, canonicalValue(value[key], `${label}.${key}`)];
        }),
    );
  }
  throw new Error(`${label} contains an unsupported value.`);
}

export function canonicalDocumentationTruthRuntimeRequestJson(value) {
  return JSON.stringify(canonicalValue(value));
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function exactText(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000\r\n]/.test(value)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value.trim();
}
function exactSha(value, label) {
  const selected = exactText(value, label, 64);
  if (!SHA256.test(selected)) throw new Error(`${label} is invalid.`);
  return selected;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

export function validateDocumentationTruthRuntimeGrantRequestIdentity(value) {
  if (!OBJECT(value)) throw new Error("Runtime activation grant request must be an object.");
  if (
    value.schemaVersion !== 1 ||
    value.kind !== REQUEST_KIND ||
    value.eligible !== true ||
    value.decision !== "EXTERNAL_SIGNATURE_REQUIRED" ||
    !OBJECT(value.grantBody) ||
    !OBJECT(value.evidence) ||
    value.externalTrustedSignerRequired !== true ||
    value.privateKeyAccessed !== false ||
    value.signatureCreated !== false
  ) throw new Error("Runtime activation grant request identity is invalid.");

  const requestId = exactText(value.requestId, "Grant request ID", 160);
  if (!REQUEST_ID.test(requestId)) throw new Error("Grant request ID is invalid.");
  const requestSha256 = exactSha(value.requestSha256, "Grant request SHA-256");
  const grantBodySha256 = exactSha(value.grantBodySha256, "Grant body SHA-256");
  const grantBodyCanonicalJson = exactText(value.grantBodyCanonicalJson, "Grant body canonical JSON", 65_536);
  const canonicalGrantBody = canonicalDocumentationTruthRuntimeRequestJson(value.grantBody);
  if (grantBodyCanonicalJson !== canonicalGrantBody) {
    throw new Error("Grant request normalized body differs from its canonical JSON.");
  }
  if (sha256(Buffer.from(grantBodyCanonicalJson, "utf8")) !== grantBodySha256) {
    throw new Error("Grant request body canonical SHA-256 is invalid.");
  }

  const identity = {
    schemaVersion: 1,
    kind: REQUEST_IDENTITY_KIND,
    grantId: exactText(value.grantBody.grantId, "Grant request grantId", 160),
    grantBodySha256,
    designSha256: exactSha(value.evidence.designSha256, "Grant request design SHA-256"),
    publicationAttestationSha256: exactSha(
      value.evidence.publicationAttestationSha256,
      "Grant request publication attestation SHA-256",
    ),
    candidateAcceptanceSha256: exactSha(
      value.evidence.candidateAcceptanceSha256,
      "Grant request candidate acceptance SHA-256",
    ),
    workItemSha256: exactSha(value.evidence.workItemSha256, "Grant request work-item SHA-256"),
    issuerKeyId: exactText(value.grantBody.issuerKeyId, "Grant request issuer key ID", 256),
  };
  const canonicalIdentity = canonicalDocumentationTruthRuntimeRequestJson(identity);
  const expectedRequestSha256 = sha256(Buffer.from(canonicalIdentity, "utf8"));
  if (requestSha256 !== expectedRequestSha256) {
    throw new Error("Grant request SHA-256 does not match its canonical request identity.");
  }
  if (requestId !== `doc-truth-grant-request:${expectedRequestSha256.slice(0, 40)}`) {
    throw new Error("Grant request ID does not match its canonical request identity.");
  }
  if (identity.workItemSha256 !== value.grantBody.workItemSha256) {
    throw new Error("Grant request evidence work-item SHA-256 differs from the signed grant body.");
  }
  if (identity.designSha256 !== value.grantBody.crossRepositoryDesignSha256) {
    throw new Error("Grant request evidence design SHA-256 differs from the signed grant body.");
  }
  if (identity.candidateAcceptanceSha256 !== value.grantBody.candidateAcceptanceSha256) {
    throw new Error("Grant request evidence candidate acceptance SHA-256 differs from the signed grant body.");
  }
  for (const field of [
    "queueMutationPerformed", "leaseAcquired", "modelTurnPerformed", "repositoryMutationPerformed",
    "commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed",
    "financialActionPerformed", "paidFallbackUsed",
  ]) {
    if (value[field] !== false) throw new Error(`Grant request must keep ${field}=false.`);
  }
  return deepFreeze({
    requestId,
    requestSha256,
    grantBodySha256,
    grantBodyCanonicalJson,
    identity: deepFreeze(identity),
    canonicalIdentity,
    exactRequestIdentityVerified: true,
  });
}

export const DOCUMENTATION_TRUTH_RUNTIME_REQUEST_INTEGRITY_CONTRACT = deepFreeze({
  requestKind: REQUEST_KIND,
  requestIdentityKind: REQUEST_IDENTITY_KIND,
  exactRequestIdentityVerified: true,
  privateKeyAuthority: false,
  signatureAuthority: false,
  grantConsumptionAuthority: false,
  leaseAuthority: false,
  modelAuthority: false,
});
