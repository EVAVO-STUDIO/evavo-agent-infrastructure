#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalDocumentationTruthRuntimeActivationJson } from "./documentation-truth-runtime-activation-verifier-core.mjs";
import { verifyDocumentationTruthRuntimeActivationGrantV2 } from "./documentation-truth-runtime-activation-verifier-v2-core.mjs";
import { verifyDocumentationTruthRuntimeActivationGrantV2Files } from "./verify-documentation-truth-runtime-activation-grant-v2.mjs";
import { canonicalDocumentationTruthRuntimeRequestJson } from "./documentation-truth-runtime-request-integrity.mjs";

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-agent-doc-truth-grant-v2-"));
const SIGNATURE_VERSION = "evavo_documentation_truth_runtime_activation_ed25519_v1";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function write(name, value) {
  const file = path.join(TEMP, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

function buildRequest(body) {
  const canonicalBody = canonicalDocumentationTruthRuntimeRequestJson(body);
  const grantBodySha256 = sha256(Buffer.from(canonicalBody, "utf8"));
  const evidence = {
    designSha256: body.crossRepositoryDesignSha256,
    designBytesSha256: "7".repeat(64),
    publicationAttestationSha256: "8".repeat(64),
    publicationAttestationBytesSha256: "9".repeat(64),
    candidateAcceptanceSha256: body.candidateAcceptanceSha256,
    candidateAcceptanceBytesSha256: "a".repeat(64),
    workItemSha256: body.workItemSha256,
    requestPolicySha256: "b".repeat(64),
    grantPolicySha256: "c".repeat(64),
    designPolicySha256: "d".repeat(64),
  };
  const identity = {
    schemaVersion: 1,
    kind: "evavo-documentation-truth-runtime-grant-request-identity-v1",
    grantId: body.grantId,
    grantBodySha256,
    designSha256: evidence.designSha256,
    publicationAttestationSha256: evidence.publicationAttestationSha256,
    candidateAcceptanceSha256: evidence.candidateAcceptanceSha256,
    workItemSha256: evidence.workItemSha256,
    issuerKeyId: body.issuerKeyId,
  };
  const requestSha256 = sha256(Buffer.from(canonicalDocumentationTruthRuntimeRequestJson(identity), "utf8"));
  return {
    schemaVersion: 1,
    kind: "evavo-documentation-truth-runtime-grant-request-v1",
    eligible: true,
    decision: "EXTERNAL_SIGNATURE_REQUIRED",
    requestId: `doc-truth-grant-request:${requestSha256.slice(0, 40)}`,
    requestSha256,
    grantBody: body,
    grantBodyCanonicalJson: canonicalBody,
    grantBodySha256,
    evidence,
    externalTrustedSignerRequired: true,
    privateKeyAccessed: false,
    signatureCreated: false,
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
  };
}

try {
  const keyPair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeySpkiBase64 = Buffer.from(
    await webcrypto.subtle.exportKey("spki", keyPair.publicKey),
  ).toString("base64");
  const keyId = "evavo-doc-truth-runtime-2026";
  const seed = {
    schemaVersion: 1,
    kind: "evavo-documentation-truth-runtime-activation-grant-v1",
    issuer: "EVAVO-STUDIO/evavo-development-studio",
    issuerKeyId: keyId,
    nonce: Buffer.alloc(24, 3).toString("base64url"),
    issuedAt: "2026-09-01T12:00:00.000Z",
    expiresAt: "2026-09-01T12:10:00.000Z",
    workerClass: "documentation-truth",
    workClass: "capability-manifest-maintenance",
    routeId: "codex-spark-pro",
    capacityClass: "included-consumer",
    agentInfrastructureMainSha: "1".repeat(40),
    localStorageMainSha: "2".repeat(40),
    candidateAcceptanceSha256: "3".repeat(64),
    crossRepositoryDesignSha256: "4".repeat(64),
    workItemId: "work:documentation-truth:example",
    workItemSha256: "5".repeat(64),
    targetRepository: "EVAVO-STUDIO/example",
    targetSourceRevision: "6".repeat(40),
    maximumUses: 1,
    maximumConcurrency: 1,
    requiresFreshRouteAdmission: true,
    requiresAtomicLeaseConsumption: true,
    paidFallbackAllowed: false,
    publicationAuthority: false,
    repositoryMutationAuthority: false,
    deploymentAuthority: false,
    financialAuthority: false,
  };
  const grantId = `doc-truth:${sha256(canonicalDocumentationTruthRuntimeActivationJson(seed)).slice(0, 40)}`;
  const body = { ...seed, grantId };
  const canonicalBody = canonicalDocumentationTruthRuntimeActivationJson(body);
  const bodySha256 = sha256(Buffer.from(canonicalBody, "utf8"));
  const signatureBytes = await webcrypto.subtle.sign(
    { name: "Ed25519" },
    keyPair.privateKey,
    Buffer.from(`${SIGNATURE_VERSION}\n${bodySha256}`, "utf8"),
  );
  const envelope = {
    schemaVersion: 1,
    kind: "evavo-documentation-truth-runtime-activation-grant-envelope-v1",
    body,
    canonicalJson: canonicalBody,
    bodySha256,
    signature: {
      version: SIGNATURE_VERSION,
      algorithm: "Ed25519",
      keyId,
      value: Buffer.from(signatureBytes).toString("base64url"),
    },
  };
  const request = buildRequest(body);
  const trustAnchor = {
    schemaVersion: 1,
    kind: "evavo-documentation-truth-runtime-activation-trust-anchor-v1",
    keyId,
    algorithm: "Ed25519",
    publicKeySpkiBase64,
    privateKeyPresent: false,
    repositoryStored: false,
    modelAccessible: false,
  };

  {
    const result = await verifyDocumentationTruthRuntimeActivationGrantV2({
      envelope,
      request,
      trustAnchor,
      now: new Date("2026-09-01T12:05:00.000Z"),
      consumedUses: 0,
    });
    assert.equal(result.accepted, true);
    assert.equal(result.exactRequestIdentityVerified, true);
    assert.equal(result.requestSha256, request.requestSha256);
    assert.equal(result.remainingUses, 1);
    assert.equal(result.maximumConcurrency, 1);
    assert.equal(result.leaseAcquired, false);
    assert.equal(result.modelTurnPerformed, false);
    assert.equal(result.queueMutationPerformed, false);
    assert.equal(result.repositoryMutationPerformed, false);
    assert.equal(result.publicationPerformed, false);
    assert.equal(result.privateKeyAccessed, false);
  }

  const envelopePath = write("envelope.json", envelope);
  const requestPath = write("request.json", request);
  const trustPath = write("trust.json", trustAnchor);
  {
    const result = await verifyDocumentationTruthRuntimeActivationGrantV2Files({
      envelopePath,
      requestPath,
      trustAnchorPath: trustPath,
      now: new Date("2026-09-01T12:05:00.000Z"),
      consumedUses: 0,
    });
    assert.equal(result.accepted, true);
    assert.equal(result.exactRequestIdentityVerified, true);
    assert.match(result.requestBytesSha256, /^[0-9a-f]{64}$/);
    assert.match(result.envelopeBytesSha256, /^[0-9a-f]{64}$/);
    assert.match(result.trustAnchorBytesSha256, /^[0-9a-f]{64}$/);
    assert.match(result.verificationSha256, /^[0-9a-f]{64}$/);
  }

  {
    const tampered = structuredClone(request);
    tampered.evidence.publicationAttestationSha256 = "e".repeat(64);
    await assert.rejects(
      () => verifyDocumentationTruthRuntimeActivationGrantV2({
        envelope,
        request: tampered,
        trustAnchor,
        now: new Date("2026-09-01T12:05:00.000Z"),
        consumedUses: 0,
      }),
      /request SHA-256 does not match/,
    );
  }

  {
    const tampered = structuredClone(request);
    tampered.requestId = `doc-truth-grant-request:${"f".repeat(40)}`;
    await assert.rejects(
      () => verifyDocumentationTruthRuntimeActivationGrantV2({
        envelope,
        request: tampered,
        trustAnchor,
        now: new Date("2026-09-01T12:05:00.000Z"),
        consumedUses: 0,
      }),
      /request ID does not match/,
    );
  }

  {
    const tampered = structuredClone(request);
    tampered.evidence.workItemSha256 = "0".repeat(64);
    const identity = {
      schemaVersion: 1,
      kind: "evavo-documentation-truth-runtime-grant-request-identity-v1",
      grantId: body.grantId,
      grantBodySha256: request.grantBodySha256,
      designSha256: tampered.evidence.designSha256,
      publicationAttestationSha256: tampered.evidence.publicationAttestationSha256,
      candidateAcceptanceSha256: tampered.evidence.candidateAcceptanceSha256,
      workItemSha256: tampered.evidence.workItemSha256,
      issuerKeyId: body.issuerKeyId,
    };
    tampered.requestSha256 = sha256(Buffer.from(canonicalDocumentationTruthRuntimeRequestJson(identity), "utf8"));
    tampered.requestId = `doc-truth-grant-request:${tampered.requestSha256.slice(0, 40)}`;
    await assert.rejects(
      () => verifyDocumentationTruthRuntimeActivationGrantV2({
        envelope,
        request: tampered,
        trustAnchor,
        now: new Date("2026-09-01T12:05:00.000Z"),
        consumedUses: 0,
      }),
      /evidence work-item SHA-256 differs/,
    );
  }

  await assert.rejects(
    () => verifyDocumentationTruthRuntimeActivationGrantV2({
      envelope,
      request,
      trustAnchor,
      now: new Date("2026-09-01T12:10:00.000Z"),
      consumedUses: 0,
    }),
    /not currently valid/,
  );

  await assert.rejects(
    () => verifyDocumentationTruthRuntimeActivationGrantV2({
      envelope,
      request,
      trustAnchor,
      now: new Date("2026-09-01T12:05:00.000Z"),
      consumedUses: 1,
    }),
    /already been consumed/,
  );

  console.log("Agent Infrastructure documentation-truth runtime grant verifier v2 tests passed.");
  console.log("- exact request identity is recomputed before Ed25519 verification");
  console.log("- request digest drift, request id drift, evidence/body drift, expiry and prior use fail closed");
  console.log("- v2 verification receives no private key and performs no consumption, queue, lease, model, repository or publication effect");
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true });
}
