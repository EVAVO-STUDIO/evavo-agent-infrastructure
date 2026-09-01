#!/usr/bin/env node

import { createHash, webcrypto } from "node:crypto";

const BODY_KIND = "evavo-documentation-truth-runtime-activation-grant-v1";
const ENVELOPE_KIND = "evavo-documentation-truth-runtime-activation-grant-envelope-v1";
const REQUEST_KIND = "evavo-documentation-truth-runtime-grant-request-v1";
const TRUST_KIND = "evavo-documentation-truth-runtime-activation-trust-anchor-v1";
const VERIFICATION_KIND = "evavo-documentation-truth-runtime-activation-grant-verification-v1";
const SIGNATURE_VERSION = "evavo_documentation_truth_runtime_activation_ed25519_v1";
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^EVAVO-STUDIO\/[A-Za-z0-9._-]{1,100}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAXIMUM_LIFETIME_SECONDS = 900;

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

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

export function canonicalDocumentationTruthRuntimeActivationJson(value) {
  return JSON.stringify(canonicalValue(value));
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function exactText(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000\r\n]/.test(value)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value.trim();
}
function exactPattern(value, label, pattern, maximum = 4096) {
  const selected = exactText(value, label, maximum);
  if (!pattern.test(selected)) throw new Error(`${label} is invalid.`);
  return selected;
}
function exactSha256(value, label) { return exactPattern(value, label, SHA256, 64); }
function exactGitSha(value, label) { return exactPattern(value, label, GIT_SHA, 40); }
function exactIdentifier(value, label) { return exactPattern(value, label, IDENTIFIER, 256); }
function exactRepository(value, label) { return exactPattern(value, label, REPOSITORY, 140); }
function canonicalIso(value, label) {
  const selected = exactText(value, label, 64);
  const parsed = new Date(selected);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== selected || parsed.getUTCMilliseconds() !== 0) {
    throw new Error(`${label} must be canonical whole-second ISO-8601.`);
  }
  return selected;
}
function canonicalBase64Bytes(value, label, minimumBytes = 32, maximumBytes = 16_384) {
  const selected = exactText(value, label, maximumBytes * 2);
  if (/\s/.test(selected) || !/^[A-Za-z0-9+/]+={0,2}$/.test(selected)) {
    throw new Error(`${label} must be canonical base64.`);
  }
  const bytes = Buffer.from(selected, "base64");
  if (
    bytes.length < minimumBytes || bytes.length > maximumBytes || bytes.toString("base64") !== selected
  ) throw new Error(`${label} has an invalid canonical byte representation.`);
  return bytes;
}
function canonicalBase64UrlBytes(value, label, minimumBytes = 16, maximumBytes = 512) {
  const selected = exactText(value, label, maximumBytes * 2);
  if (!BASE64URL.test(selected)) throw new Error(`${label} must be canonical base64url.`);
  const bytes = Buffer.from(selected, "base64url");
  if (
    bytes.length < minimumBytes || bytes.length > maximumBytes || bytes.toString("base64url") !== selected
  ) throw new Error(`${label} has an invalid canonical byte representation.`);
  return bytes;
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

function normalizeGrantBody(value) {
  if (!OBJECT(value)) throw new Error("Runtime activation grant body must be an object.");
  const allowed = new Set([
    "schemaVersion", "kind", "issuer", "issuerKeyId", "grantId", "nonce", "issuedAt", "expiresAt",
    "workerClass", "workClass", "routeId", "capacityClass", "agentInfrastructureMainSha",
    "localStorageMainSha", "candidateAcceptanceSha256", "crossRepositoryDesignSha256", "workItemId",
    "workItemSha256", "targetRepository", "targetSourceRevision", "maximumUses", "maximumConcurrency",
    "requiresFreshRouteAdmission", "requiresAtomicLeaseConsumption", "paidFallbackAllowed",
    "publicationAuthority", "repositoryMutationAuthority", "deploymentAuthority", "financialAuthority",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`Runtime activation grant contains unknown fields: ${unknown.join(", ")}.`);
  if (value.schemaVersion !== 1 || value.kind !== BODY_KIND) throw new Error("Runtime activation grant kind/schema is invalid.");
  const issuedAt = canonicalIso(value.issuedAt, "Grant issuedAt");
  const expiresAt = canonicalIso(value.expiresAt, "Grant expiresAt");
  const lifetimeSeconds = (Date.parse(expiresAt) - Date.parse(issuedAt)) / 1000;
  if (lifetimeSeconds < 60 || lifetimeSeconds > MAXIMUM_LIFETIME_SECONDS) {
    throw new Error(`Runtime activation grant lifetime must be between 60 and ${MAXIMUM_LIFETIME_SECONDS} seconds.`);
  }
  const nonce = exactText(value.nonce, "Grant nonce", 128);
  canonicalBase64UrlBytes(nonce, "Grant nonce", 16, 64);
  const body = {
    schemaVersion: 1,
    kind: BODY_KIND,
    issuer: value.issuer === "EVAVO-STUDIO/evavo-development-studio"
      ? value.issuer
      : (() => { throw new Error("Grant issuer is invalid."); })(),
    issuerKeyId: exactIdentifier(value.issuerKeyId, "Grant issuerKeyId"),
    grantId: exactIdentifier(value.grantId, "Grant grantId"),
    nonce,
    issuedAt,
    expiresAt,
    workerClass: value.workerClass === "documentation-truth"
      ? value.workerClass
      : (() => { throw new Error("Grant workerClass is invalid."); })(),
    workClass: value.workClass === "capability-manifest-maintenance"
      ? value.workClass
      : (() => { throw new Error("Grant workClass is invalid."); })(),
    routeId: value.routeId === "codex-spark-pro"
      ? value.routeId
      : (() => { throw new Error("Grant routeId is invalid."); })(),
    capacityClass: value.capacityClass === "included-consumer"
      ? value.capacityClass
      : (() => { throw new Error("Grant capacityClass is invalid."); })(),
    agentInfrastructureMainSha: exactGitSha(value.agentInfrastructureMainSha, "Grant Agent Infrastructure main SHA"),
    localStorageMainSha: exactGitSha(value.localStorageMainSha, "Grant Local Storage main SHA"),
    candidateAcceptanceSha256: exactSha256(value.candidateAcceptanceSha256, "Grant candidate acceptance SHA-256"),
    crossRepositoryDesignSha256: exactSha256(value.crossRepositoryDesignSha256, "Grant design SHA-256"),
    workItemId: exactIdentifier(value.workItemId, "Grant workItemId"),
    workItemSha256: exactSha256(value.workItemSha256, "Grant work-item SHA-256"),
    targetRepository: exactRepository(value.targetRepository, "Grant target repository"),
    targetSourceRevision: exactGitSha(value.targetSourceRevision, "Grant target source revision"),
    maximumUses: value.maximumUses,
    maximumConcurrency: value.maximumConcurrency,
    requiresFreshRouteAdmission: value.requiresFreshRouteAdmission,
    requiresAtomicLeaseConsumption: value.requiresAtomicLeaseConsumption,
    paidFallbackAllowed: value.paidFallbackAllowed,
    publicationAuthority: value.publicationAuthority,
    repositoryMutationAuthority: value.repositoryMutationAuthority,
    deploymentAuthority: value.deploymentAuthority,
    financialAuthority: value.financialAuthority,
  };
  if (body.maximumUses !== 1) throw new Error("Runtime activation grant maximumUses must equal one.");
  if (body.maximumConcurrency !== 1) throw new Error("Runtime activation grant maximumConcurrency must equal one.");
  if (body.requiresFreshRouteAdmission !== true) throw new Error("Runtime activation grant must require fresh route admission.");
  if (body.requiresAtomicLeaseConsumption !== true) throw new Error("Runtime activation grant must require atomic lease consumption.");
  for (const field of [
    "paidFallbackAllowed", "publicationAuthority", "repositoryMutationAuthority", "deploymentAuthority", "financialAuthority",
  ]) {
    if (body[field] !== false) throw new Error(`Runtime activation grant must keep ${field}=false.`);
  }
  const seed = { ...body };
  delete seed.grantId;
  const expectedGrantId = `doc-truth:${sha256(canonicalDocumentationTruthRuntimeActivationJson(seed)).slice(0, 40)}`;
  if (body.grantId !== expectedGrantId) throw new Error("Runtime activation grant grantId does not match its canonical seed.");
  return deepFreeze(body);
}

function validateTrustAnchor(value) {
  if (!OBJECT(value)) throw new Error("Runtime activation trust anchor must be an object.");
  const allowed = new Set([
    "schemaVersion", "kind", "keyId", "algorithm", "publicKeySpkiBase64",
    "privateKeyPresent", "repositoryStored", "modelAccessible",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`Runtime activation trust anchor contains unknown fields: ${unknown.join(", ")}.`);
  if (
    value.schemaVersion !== 1 || value.kind !== TRUST_KIND || value.algorithm !== "Ed25519" ||
    value.privateKeyPresent !== false || value.repositoryStored !== false || value.modelAccessible !== false
  ) throw new Error("Runtime activation trust anchor identity is invalid.");
  const keyId = exactIdentifier(value.keyId, "Trust anchor keyId");
  canonicalBase64Bytes(value.publicKeySpkiBase64, "Trust anchor public key", 32, 16_384);
  return deepFreeze({
    schemaVersion: 1,
    kind: TRUST_KIND,
    keyId,
    algorithm: "Ed25519",
    publicKeySpkiBase64: value.publicKeySpkiBase64,
    privateKeyPresent: false,
    repositoryStored: false,
    modelAccessible: false,
  });
}

function validateRequest(value) {
  if (!OBJECT(value)) throw new Error("Runtime activation grant request must be an object.");
  if (
    value.schemaVersion !== 1 || value.kind !== REQUEST_KIND || value.eligible !== true ||
    value.decision !== "EXTERNAL_SIGNATURE_REQUIRED" || !OBJECT(value.grantBody) ||
    value.externalTrustedSignerRequired !== true || value.privateKeyAccessed !== false || value.signatureCreated !== false
  ) throw new Error("Runtime activation grant request identity is invalid.");
  const requestSha256 = exactSha256(value.requestSha256, "Grant request SHA-256");
  const grantBodySha256 = exactSha256(value.grantBodySha256, "Grant body SHA-256");
  const body = normalizeGrantBody(value.grantBody);
  const canonicalBody = canonicalDocumentationTruthRuntimeActivationJson(body);
  if (value.grantBodyCanonicalJson !== canonicalBody) throw new Error("Grant request normalized body differs from its canonical JSON.");
  if (sha256(Buffer.from(canonicalBody, "utf8")) !== grantBodySha256) throw new Error("Grant request body canonical SHA-256 is invalid.");
  for (const field of [
    "queueMutationPerformed", "leaseAcquired", "modelTurnPerformed", "repositoryMutationPerformed",
    "commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed",
    "financialActionPerformed", "paidFallbackUsed",
  ]) {
    if (value[field] !== false) throw new Error(`Grant request must keep ${field}=false.`);
  }
  return deepFreeze({ value, body, canonicalBody, requestSha256, grantBodySha256 });
}

const signatureMessage = (bodySha256) => Buffer.from(`${SIGNATURE_VERSION}\n${bodySha256}`, "utf8");

export async function verifyDocumentationTruthRuntimeActivationGrant({
  envelope,
  request,
  trustAnchor,
  now = new Date(),
  consumedUses = 0,
}) {
  const trusted = validateTrustAnchor(trustAnchor);
  const requested = validateRequest(request);
  if (!OBJECT(envelope)) throw new Error("Runtime activation grant envelope must be an object.");
  const allowed = new Set(["schemaVersion", "kind", "body", "canonicalJson", "bodySha256", "signature"]);
  const unknown = Object.keys(envelope).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`Runtime activation envelope contains unknown fields: ${unknown.join(", ")}.`);
  if (envelope.schemaVersion !== 1 || envelope.kind !== ENVELOPE_KIND) throw new Error("Runtime activation envelope kind/schema is invalid.");
  const body = normalizeGrantBody(envelope.body);
  const canonicalBody = canonicalDocumentationTruthRuntimeActivationJson(body);
  const bodySha256 = sha256(Buffer.from(canonicalBody, "utf8"));
  if (
    envelope.canonicalJson !== canonicalBody || envelope.bodySha256 !== bodySha256 ||
    canonicalBody !== requested.canonicalBody || bodySha256 !== requested.grantBodySha256
  ) throw new Error("Signed grant body differs from the exact unsigned request.");
  const signature = envelope.signature;
  if (
    !OBJECT(signature) || signature.version !== SIGNATURE_VERSION || signature.algorithm !== "Ed25519" ||
    signature.keyId !== trusted.keyId || body.issuerKeyId !== trusted.keyId
  ) throw new Error("Signed grant key identity differs from the trusted external key.");
  const signatureBytes = canonicalBase64UrlBytes(signature.value, "Runtime activation signature", 64, 64);
  const key = await webcrypto.subtle.importKey(
    "spki",
    canonicalBase64Bytes(trusted.publicKeySpkiBase64, "Runtime activation public key"),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const valid = await webcrypto.subtle.verify(
    { name: "Ed25519" },
    key,
    signatureBytes,
    signatureMessage(bodySha256),
  );
  if (!valid) throw new Error("Runtime activation grant signature is invalid.");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Runtime activation verification time is invalid.");
  const nowMs = now.getTime();
  if (nowMs < Date.parse(body.issuedAt) || nowMs >= Date.parse(body.expiresAt)) {
    throw new Error("Runtime activation grant is not currently valid.");
  }
  if (!Number.isSafeInteger(consumedUses) || consumedUses < 0 || consumedUses >= body.maximumUses) {
    throw new Error("Runtime activation grant has already been consumed or has invalid use state.");
  }
  return deepFreeze({
    schemaVersion: 1,
    kind: VERIFICATION_KIND,
    accepted: true,
    grantId: body.grantId,
    grantBodySha256: bodySha256,
    requestSha256: requested.requestSha256,
    expiresAt: body.expiresAt,
    consumedUses,
    remainingUses: body.maximumUses - consumedUses,
    maximumConcurrency: body.maximumConcurrency,
    workerClass: body.workerClass,
    workClass: body.workClass,
    routeId: body.routeId,
    capacityClass: body.capacityClass,
    agentInfrastructureMainSha: body.agentInfrastructureMainSha,
    localStorageMainSha: body.localStorageMainSha,
    candidateAcceptanceSha256: body.candidateAcceptanceSha256,
    crossRepositoryDesignSha256: body.crossRepositoryDesignSha256,
    workItemId: body.workItemId,
    workItemSha256: body.workItemSha256,
    targetRepository: body.targetRepository,
    targetSourceRevision: body.targetSourceRevision,
    trustAnchorKeyId: trusted.keyId,
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
    truthBoundary:
      "Agent Infrastructure verified one exact externally signed grant against one exact unsigned request and external public key. Verification alone does not consume the grant, acquire a lease, select capacity or start Codex.",
  });
}

export const DOCUMENTATION_TRUTH_RUNTIME_ACTIVATION_VERIFIER_CONTRACT = deepFreeze({
  bodyKind: BODY_KIND,
  envelopeKind: ENVELOPE_KIND,
  requestKind: REQUEST_KIND,
  trustKind: TRUST_KIND,
  verificationKind: VERIFICATION_KIND,
  signatureVersion: SIGNATURE_VERSION,
  maximumLifetimeSeconds: MAXIMUM_LIFETIME_SECONDS,
  maximumUses: 1,
  maximumConcurrency: 1,
  signingAuthority: false,
});
