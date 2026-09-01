#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  canonicalDocumentationTruthRuntimeActivationJson,
  verifyDocumentationTruthRuntimeActivationGrant,
} from "./documentation-truth-runtime-activation-verifier-core.mjs";
import { verifyDocumentationTruthRuntimeActivationGrantFiles } from "./verify-documentation-truth-runtime-activation-grant.mjs";

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-agent-doc-truth-grant-"));
const SIGNATURE_VERSION = "evavo_documentation_truth_runtime_activation_ed25519_v1";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function write(name, value) {
  const file = path.join(TEMP, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

try {
  const keyPair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privateKey = keyPair.privateKey;
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
    privateKey,
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
  const request = {
    schemaVersion: 1,
    kind: "evavo-documentation-truth-runtime-grant-request-v1",
    eligible: true,
    decision: "EXTERNAL_SIGNATURE_REQUIRED",
    requestId: `doc-truth-grant-request:${"7".repeat(40)}`,
    requestSha256: "8".repeat(64),
    grantBody: body,
    grantBodyCanonicalJson: canonicalBody,
    grantBodySha256: bodySha256,
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
    const result = await verifyDocumentationTruthRuntimeActivationGrant({
      envelope,
      request,
      trustAnchor,
      now: new Date("2026-09-01T12:05:00.000Z"),
      consumedUses: 0,
    });
    assert.equal(result.accepted, true);
    assert.equal(result.grantId, grantId);
    assert.equal(result.remainingUses, 1);
    assert.equal(result.maximumConcurrency, 1);
    assert.equal(result.agentInfrastructureMainSha, "1".repeat(40));
    assert.equal(result.localStorageMainSha, "2".repeat(40));
    assert.equal(result.workItemId, body.workItemId);
    assert.equal(result.workItemSha256, body.workItemSha256);
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
    const result = await verifyDocumentationTruthRuntimeActivationGrantFiles({
      envelopePath,
      requestPath,
      trustAnchorPath: trustPath,
      now: new Date("2026-09-01T12:05:00.000Z"),
      consumedUses: 0,
    });
    assert.equal(result.accepted, true);
    assert.match(result.requestBytesSha256, /^[0-9a-f]{64}$/);
    assert.match(result.envelopeBytesSha256, /^[0-9a-f]{64}$/);
    assert.match(result.trustAnchorBytesSha256, /^[0-9a-f]{64}$/);
    assert.match(result.verificationSha256, /^[0-9a-f]{64}$/);
  }

  await assert.rejects(
    () => verifyDocumentationTruthRuntimeActivationGrant({
      envelope,
      request,
      trustAnchor,
      now: new Date("2026-09-01T12:10:00.000Z"),
      consumedUses: 0,
    }),
    /not currently valid/,
  );

  await assert.rejects(
    () => verifyDocumentationTruthRuntimeActivationGrant({
      envelope,
      request,
      trustAnchor,
      now: new Date("2026-09-01T12:05:00.000Z"),
      consumedUses: 1,
    }),
    /already been consumed/,
  );

  {
    const tampered = structuredClone(envelope);
    tampered.body.targetRepository = "EVAVO-STUDIO/other";
    await assert.rejects(
      () => verifyDocumentationTruthRuntimeActivationGrant({
        envelope: tampered,
        request,
        trustAnchor,
        now: new Date("2026-09-01T12:05:00.000Z"),
        consumedUses: 0,
      }),
      /Signed grant body differs from the exact unsigned request|canonical seed/,
    );
  }

  {
    const wrongTrust = { ...trustAnchor, keyId: "wrong-runtime-key" };
    await assert.rejects(
      () => verifyDocumentationTruthRuntimeActivationGrant({
        envelope,
        request,
        trustAnchor: wrongTrust,
        now: new Date("2026-09-01T12:05:00.000Z"),
        consumedUses: 0,
      }),
      /key identity differs/,
    );
  }

  {
    const unsafeTrust = { ...trustAnchor, privateKeyPresent: true };
    await assert.rejects(
      () => verifyDocumentationTruthRuntimeActivationGrant({
        envelope,
        request,
        trustAnchor: unsafeTrust,
        now: new Date("2026-09-01T12:05:00.000Z"),
        consumedUses: 0,
      }),
      /trust anchor identity is invalid/,
    );
  }

  {
    const tampered = structuredClone(envelope);
    tampered.signature.value = `${tampered.signature.value.slice(0, -1)}${tampered.signature.value.endsWith("A") ? "B" : "A"}`;
    await assert.rejects(
      () => verifyDocumentationTruthRuntimeActivationGrant({
        envelope: tampered,
        request,
        trustAnchor,
        now: new Date("2026-09-01T12:05:00.000Z"),
        consumedUses: 0,
      }),
      /signature is invalid/,
    );
  }

  console.log("Agent Infrastructure documentation-truth runtime grant verifier tests passed.");
  console.log("- exact request, signed envelope and external trust anchor must agree");
  console.log("- expiry, prior use, source/request drift, key drift, unsafe trust and signature tampering fail closed");
  console.log("- verification receives no private key and performs no queue, lease, model, repository or publication effect");
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true });
}
