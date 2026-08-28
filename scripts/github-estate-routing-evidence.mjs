import path from 'node:path';

import {
  AGENT_CAPABILITY_STATUS_KIND,
  ESTATE_ROUTING_VERIFICATION_KIND,
  ESTATE_SNAPSHOT_ATTESTATION_FILE,
  ESTATE_SNAPSHOT_SOURCE_REPOSITORY,
  MAX_ATTESTATION_BYTES,
  MAX_INDEX_BYTES,
  MAX_TRUST_BYTES,
  PREFIXED_SHA256_PATTERN,
  ROUTING_CAPABILITY_ID,
  ROUTING_CLIENTS,
  ROUTING_STRATEGY_ID,
  assert,
  authority,
  canonicalInstant,
  canonicalJson,
  digestJson,
  fail,
  falseAuthority,
  isRecord,
  parseStrictJson,
  readCanonicalJsonFile,
  readRegularFile,
  sha256Bytes,
  text,
} from './github-estate-routing-common.mjs';
import { verifyEstateSnapshotAttestation } from './github-estate-attestation-verifier.mjs';
import {
  selectLatestEstateSnapshotDirectory,
  verifyEstateSnapshotDirectory,
} from './github-estate-snapshot-verifier.mjs';

export * from './github-estate-routing-common.mjs';
export * from './github-estate-attestation-verifier.mjs';
export * from './github-estate-snapshot-verifier.mjs';

function provenanceReceiptId(snapshot, attestation) {
  const body = {
    snapshotDigest: snapshot.snapshotDigest,
    indexDigest: snapshot.indexDigest,
    sourceRevision: attestation.sourceRevision,
    attestationKeyId: attestation.keyId,
    signatureSha256: attestation.signatureSha256,
  };
  return `evavo-estate-routing:sha256:${sha256Bytes(
    Buffer.from(canonicalJson(body), 'utf8'),
  )}`;
}

export function verifyEstateRoutingEvidence({
  snapshotDirectory,
  snapshotRoot,
  trustBundle,
  now = new Date().toISOString(),
}) {
  assert(
    (typeof snapshotDirectory === 'string') !== (typeof snapshotRoot === 'string'),
    'EVAVO_ESTATE_ROUTING_SNAPSHOT_SELECTOR',
  );
  const selectedDirectory =
    typeof snapshotDirectory === 'string'
      ? snapshotDirectory
      : selectLatestEstateSnapshotDirectory(snapshotRoot);
  const snapshot = verifyEstateSnapshotDirectory(selectedDirectory);
  const attestationDocument = readCanonicalJsonFile(
    path.join(snapshot.directory, ESTATE_SNAPSHOT_ATTESTATION_FILE),
    MAX_ATTESTATION_BYTES,
    'EVAVO_ESTATE_ROUTING_ATTESTATION_FILE',
  );
  const source = verifyEstateSnapshotAttestation({
    attestation: attestationDocument.value,
    trustBundle,
    now,
  });
  assert(
    source.snapshotAt === snapshot.snapshotAt &&
      source.snapshotDigest === snapshot.snapshotDigest &&
      source.indexDigest === snapshot.indexDigest &&
      source.selectionIntent === snapshot.selectionIntent &&
      source.snapshotDirectoryName === path.basename(snapshot.directory),
    'EVAVO_ESTATE_ROUTING_ATTESTATION_SNAPSHOT_BINDING',
  );
  const current = canonicalInstant(now, 'EVAVO_ESTATE_ROUTING_VERIFIED_AT');
  const body = {
    schemaVersion: 1,
    kind: ESTATE_ROUTING_VERIFICATION_KIND,
    verifiedAt: current.text,
    snapshotDirectory: snapshot.directory,
    snapshotAt: snapshot.snapshotAt,
    snapshotDigest: snapshot.snapshotDigest,
    indexDigest: snapshot.indexDigest,
    selectionIntent: snapshot.selectionIntent,
    inventoryRepositoryCount: snapshot.inventoryRepositoryCount,
    manifestStatus: snapshot.manifestStatus,
    providerAuditStatus: snapshot.providerAuditStatus,
    sourceRepository: ESTATE_SNAPSHOT_SOURCE_REPOSITORY,
    sourceRevision: source.sourceRevision,
    sourceManifestBlobSha: source.manifestBlobSha,
    sourceAttestedAt: source.attestedAt,
    sourceAttestationKeyId: source.keyId,
    sourceBinding: 'signed-snapshot-sidecar-v1',
    strategyId: ROUTING_STRATEGY_ID,
    capability: ROUTING_CAPABILITY_ID,
    evidenceState: 'completed',
    receiptId: provenanceReceiptId(snapshot, source),
    authority: authority(),
  };
  return Object.freeze({ ...body, verificationDigest: digestJson(body) });
}

export function createEstateRoutingStatus({ verification, client }) {
  assert(
    isRecord(verification) && verification.kind === ESTATE_ROUTING_VERIFICATION_KIND,
    'EVAVO_ESTATE_ROUTING_VERIFICATION_REQUIRED',
  );
  const { verificationDigest, ...unsigned } = verification;
  text(verificationDigest, 'EVAVO_ESTATE_ROUTING_VERIFICATION_DIGEST', {
    maximum: 71,
    pattern: PREFIXED_SHA256_PATTERN,
  });
  assert(
    verificationDigest === digestJson(unsigned),
    'EVAVO_ESTATE_ROUTING_VERIFICATION_DIGEST_MISMATCH',
  );
  falseAuthority(
    verification.authority,
    'EVAVO_ESTATE_ROUTING_VERIFICATION_AUTHORITY',
  );
  const selectedClient = text(client, 'EVAVO_ESTATE_ROUTING_CLIENT', {
    maximum: 64,
  });
  assert(
    ROUTING_CLIENTS.has(selectedClient),
    'EVAVO_ESTATE_ROUTING_CLIENT_UNKNOWN',
    selectedClient,
  );
  return Object.freeze({
    schemaVersion: 1,
    kind: AGENT_CAPABILITY_STATUS_KIND,
    capturedAt: verification.verifiedAt,
    client: selectedClient,
    requestedCapabilities: Object.freeze([ROUTING_CAPABILITY_ID]),
    evidence: Object.freeze([
      Object.freeze({
        strategyId: ROUTING_STRATEGY_ID,
        state: 'completed',
        observedAt: verification.snapshotAt,
        sourceRevision: verification.sourceRevision,
        healthy: true,
        receiptId: verification.receiptId,
        detail: `estate=${verification.snapshotDigest};audit=${verification.providerAuditStatus};source=${verification.sourceRevision};binding=${verification.sourceBinding}`,
      }),
    ]),
  });
}

function readStrictJsonFile(filePath, maximumBytes, code) {
  const bytes = readRegularFile(filePath, maximumBytes, code);
  return parseStrictJson(bytes.toString('utf8').replace(/^\uFEFF/u, ''), maximumBytes);
}

export function readEstateRoutingInputFile(filePath, kind) {
  const resolved = path.resolve(
    text(filePath, 'EVAVO_ESTATE_ROUTING_INPUT_FILE', { maximum: 4096 }),
  );
  if (kind === 'trust-bundle') {
    return readStrictJsonFile(
      resolved,
      MAX_TRUST_BYTES,
      'EVAVO_ESTATE_ROUTING_TRUST_FILE',
    );
  }
  if (kind === 'snapshot-index') {
    return readCanonicalJsonFile(
      resolved,
      MAX_INDEX_BYTES,
      'EVAVO_ESTATE_ROUTING_INDEX_INPUT_FILE',
    ).value;
  }
  fail('EVAVO_ESTATE_ROUTING_INPUT_KIND', String(kind));
}
