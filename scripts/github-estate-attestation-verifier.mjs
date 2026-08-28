import { createPublicKey, verify as verifySignature } from 'node:crypto';

import {
  DIRECTORY_PATTERN,
  ESTATE_SNAPSHOT_ATTESTATION_SCHEMA,
  ESTATE_SNAPSHOT_ATTESTATION_SIGNING_DOMAIN,
  ESTATE_SNAPSHOT_ATTESTATION_TRUST_SCHEMA,
  ESTATE_SNAPSHOT_ATTESTOR_SYSTEM_ID,
  ESTATE_SNAPSHOT_SOURCE_REPOSITORY,
  FORBIDDEN_KEYS,
  KEY_ID_PATTERN,
  MAX_ATTESTATION_LAG_MS,
  MAX_CLOCK_SKEW_MS,
  PREFIXED_SHA256_PATTERN,
  SHA1_PATTERN,
  SHA256_PATTERN,
  SNAPSHOT_INTENTS,
  assert,
  canonicalInstant,
  exactKeys,
  fail,
  falseAuthority,
  isRecord,
  pemText,
  sha256Bytes,
  text,
} from './github-estate-routing-common.mjs';

function canonicalAttestationValue(value, seen = new Set()) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      assert(Number.isFinite(value), 'EVAVO_ESTATE_ROUTING_ATTESTATION_NUMBER');
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'object': {
      assert(!seen.has(value), 'EVAVO_ESTATE_ROUTING_ATTESTATION_CYCLE');
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          return `[${value.map((entry) => canonicalAttestationValue(entry, seen)).join(',')}]`;
        }
        assert(isRecord(value), 'EVAVO_ESTATE_ROUTING_ATTESTATION_OBJECT');
        return `{${Object.keys(value)
          .sort()
          .map((key) => {
            assert(!FORBIDDEN_KEYS.has(key), 'EVAVO_ESTATE_ROUTING_ATTESTATION_KEY', key);
            assert(value[key] !== undefined, 'EVAVO_ESTATE_ROUTING_ATTESTATION_UNDEFINED', key);
            return `${JSON.stringify(key)}:${canonicalAttestationValue(value[key], seen)}`;
          })
          .join(',')}}`;
      } finally {
        seen.delete(value);
      }
    }
    default:
      fail('EVAVO_ESTATE_ROUTING_ATTESTATION_VALUE', typeof value);
  }
}

function publicKeyDigest(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return Object.freeze({
    sha256: sha256Bytes(der),
    keyId: `evavo-github-estate-snapshot:${sha256Bytes(der).slice(0, 24)}`,
  });
}

function validateTrustBundle(value) {
  exactKeys(
    value,
    [
      'schemaVersion',
      'keyId',
      'systemId',
      'publicKeyPemEnv',
      'activeFrom',
      'activeUntil',
      'publicKeySha256',
      'publicKeyPem',
      'privateKeyReturned',
      'secretPathReturned',
      'authorityGranted',
    ],
    [],
    'EVAVO_ESTATE_ROUTING_TRUST',
  );
  assert(
    value.schemaVersion === ESTATE_SNAPSHOT_ATTESTATION_TRUST_SCHEMA,
    'EVAVO_ESTATE_ROUTING_TRUST_SCHEMA',
  );
  assert(
    value.systemId === ESTATE_SNAPSHOT_ATTESTOR_SYSTEM_ID,
    'EVAVO_ESTATE_ROUTING_TRUST_SYSTEM',
  );
  text(value.keyId, 'EVAVO_ESTATE_ROUTING_TRUST_KEY_ID', {
    maximum: 192,
    pattern: KEY_ID_PATTERN,
  });
  assert(
    value.publicKeyPemEnv === 'EVAVO_GITHUB_ESTATE_SNAPSHOT_PUBLIC_KEY_PEM',
    'EVAVO_ESTATE_ROUTING_TRUST_PUBLIC_KEY_ENV',
  );
  const activeFrom = canonicalInstant(
    value.activeFrom,
    'EVAVO_ESTATE_ROUTING_TRUST_ACTIVE_FROM',
  );
  const activeUntil = canonicalInstant(
    value.activeUntil,
    'EVAVO_ESTATE_ROUTING_TRUST_ACTIVE_UNTIL',
  );
  assert(activeFrom.milliseconds < activeUntil.milliseconds, 'EVAVO_ESTATE_ROUTING_TRUST_WINDOW');
  text(value.publicKeySha256, 'EVAVO_ESTATE_ROUTING_TRUST_PUBLIC_KEY_SHA256', {
    maximum: 64,
    pattern: SHA256_PATTERN,
  });
  pemText(value.publicKeyPem, 'EVAVO_ESTATE_ROUTING_TRUST_PUBLIC_KEY_PEM');
  assert(
    value.privateKeyReturned === false &&
      value.secretPathReturned === false &&
      value.authorityGranted === false,
    'EVAVO_ESTATE_ROUTING_TRUST_NEGATIVE_AUTHORITY',
  );
  const publicKey = createPublicKey(value.publicKeyPem);
  assert(publicKey.asymmetricKeyType === 'ed25519', 'EVAVO_ESTATE_ROUTING_TRUST_KEY_TYPE');
  const identity = publicKeyDigest(publicKey);
  assert(identity.keyId === value.keyId, 'EVAVO_ESTATE_ROUTING_TRUST_KEY_ID_MISMATCH');
  assert(identity.sha256 === value.publicKeySha256, 'EVAVO_ESTATE_ROUTING_TRUST_KEY_DIGEST');
  return Object.freeze({ value, publicKey, activeFrom, activeUntil });
}

function validateAttestationPayload(value) {
  exactKeys(
    value,
    [
      'schemaVersion',
      'systemId',
      'repository',
      'repositoryHeadSha',
      'manifestBlobSha',
      'snapshotAt',
      'snapshotDigest',
      'indexDigest',
      'selectionIntent',
      'snapshotDirectoryName',
      'attestedAt',
      'authority',
    ],
    [],
    'EVAVO_ESTATE_ROUTING_ATTESTATION_PAYLOAD',
  );
  assert(
    value.schemaVersion === ESTATE_SNAPSHOT_ATTESTATION_SCHEMA,
    'EVAVO_ESTATE_ROUTING_ATTESTATION_SCHEMA',
  );
  assert(
    value.systemId === ESTATE_SNAPSHOT_ATTESTOR_SYSTEM_ID,
    'EVAVO_ESTATE_ROUTING_ATTESTATION_SYSTEM',
  );
  assert(
    value.repository === ESTATE_SNAPSHOT_SOURCE_REPOSITORY,
    'EVAVO_ESTATE_ROUTING_ATTESTATION_REPOSITORY',
  );
  text(value.repositoryHeadSha, 'EVAVO_ESTATE_ROUTING_ATTESTATION_HEAD', {
    maximum: 40,
    pattern: SHA1_PATTERN,
  });
  text(value.manifestBlobSha, 'EVAVO_ESTATE_ROUTING_ATTESTATION_MANIFEST', {
    maximum: 40,
    pattern: SHA1_PATTERN,
  });
  const snapshotAt = canonicalInstant(value.snapshotAt, 'EVAVO_ESTATE_ROUTING_ATTESTATION_SNAPSHOT_AT');
  const attestedAt = canonicalInstant(value.attestedAt, 'EVAVO_ESTATE_ROUTING_ATTESTATION_ATTESTED_AT');
  assert(
    attestedAt.milliseconds >= snapshotAt.milliseconds &&
      attestedAt.milliseconds - snapshotAt.milliseconds <= MAX_ATTESTATION_LAG_MS,
    'EVAVO_ESTATE_ROUTING_ATTESTATION_LAG',
  );
  text(value.snapshotDigest, 'EVAVO_ESTATE_ROUTING_ATTESTATION_SNAPSHOT_DIGEST', {
    maximum: 71,
    pattern: PREFIXED_SHA256_PATTERN,
  });
  text(value.indexDigest, 'EVAVO_ESTATE_ROUTING_ATTESTATION_INDEX_DIGEST', {
    maximum: 71,
    pattern: PREFIXED_SHA256_PATTERN,
  });
  assert(SNAPSHOT_INTENTS.has(value.selectionIntent), 'EVAVO_ESTATE_ROUTING_ATTESTATION_INTENT');
  text(value.snapshotDirectoryName, 'EVAVO_ESTATE_ROUTING_ATTESTATION_DIRECTORY', {
    maximum: 128,
    pattern: DIRECTORY_PATTERN,
  });
  const expectedName = `estate-${value.snapshotAt.replace(/[-:.]/gu, '')}-${value.snapshotDigest.slice('sha256:'.length, 'sha256:'.length + 20)}`;
  assert(
    value.snapshotDirectoryName === expectedName,
    'EVAVO_ESTATE_ROUTING_ATTESTATION_DIRECTORY_BINDING',
  );
  falseAuthority(value.authority, 'EVAVO_ESTATE_ROUTING_ATTESTATION_AUTHORITY');
  return Object.freeze({ value, snapshotAt, attestedAt });
}

export function verifyEstateSnapshotAttestation({ attestation, trustBundle, now }) {
  exactKeys(
    attestation,
    ['payload', 'keyId', 'signatureBase64'],
    [],
    'EVAVO_ESTATE_ROUTING_ATTESTATION',
  );
  const trust = validateTrustBundle(trustBundle);
  assert(attestation.keyId === trust.value.keyId, 'EVAVO_ESTATE_ROUTING_ATTESTATION_KEY_ID');
  text(attestation.signatureBase64, 'EVAVO_ESTATE_ROUTING_ATTESTATION_SIGNATURE', {
    maximum: 128,
    pattern: /^[A-Za-z0-9+/]{86}==$/u,
  });
  const signature = Buffer.from(attestation.signatureBase64, 'base64');
  assert(signature.length === 64, 'EVAVO_ESTATE_ROUTING_ATTESTATION_SIGNATURE_LENGTH');
  const payload = validateAttestationPayload(attestation.payload);
  const verified = verifySignature(
    null,
    Buffer.from(
      `${ESTATE_SNAPSHOT_ATTESTATION_SIGNING_DOMAIN}${canonicalAttestationValue(payload.value)}`,
      'utf8',
    ),
    trust.publicKey,
    signature,
  );
  assert(verified, 'EVAVO_ESTATE_ROUTING_ATTESTATION_SIGNATURE_INVALID');
  assert(
    payload.attestedAt.milliseconds >= trust.activeFrom.milliseconds &&
      payload.attestedAt.milliseconds <= trust.activeUntil.milliseconds,
    'EVAVO_ESTATE_ROUTING_ATTESTATION_KEY_WINDOW',
  );
  const current = canonicalInstant(now, 'EVAVO_ESTATE_ROUTING_NOW');
  assert(
    current.milliseconds + MAX_CLOCK_SKEW_MS >= payload.attestedAt.milliseconds,
    'EVAVO_ESTATE_ROUTING_ATTESTATION_FUTURE',
  );
  return Object.freeze({
    keyId: trust.value.keyId,
    sourceRevision: payload.value.repositoryHeadSha,
    manifestBlobSha: payload.value.manifestBlobSha,
    snapshotAt: payload.snapshotAt.text,
    snapshotAtMilliseconds: payload.snapshotAt.milliseconds,
    attestedAt: payload.attestedAt.text,
    attestedAtMilliseconds: payload.attestedAt.milliseconds,
    snapshotDigest: payload.value.snapshotDigest,
    indexDigest: payload.value.indexDigest,
    selectionIntent: payload.value.selectionIntent,
    snapshotDirectoryName: payload.value.snapshotDirectoryName,
    signatureSha256: sha256Bytes(signature),
  });
}

