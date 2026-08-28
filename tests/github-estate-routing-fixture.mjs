import {
  createHash,
  generateKeyPairSync,
  sign as signBytes,
} from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ESTATE_SNAPSHOT_ATTESTATION_SCHEMA,
  ESTATE_SNAPSHOT_ATTESTATION_SIGNING_DOMAIN,
  ESTATE_SNAPSHOT_ATTESTATION_TRUST_SCHEMA,
  ESTATE_SNAPSHOT_ATTESTOR_SYSTEM_ID,
  canonicalJson,
} from '../scripts/github-estate-routing-evidence.mjs';

export const NOW_MS = Date.parse('2026-08-28T12:00:00.000Z');
export const NOW = new Date(NOW_MS).toISOString();
const AUTHORITY = Object.freeze({
  providerRead: false,
  providerMutation: false,
  sourceMutation: false,
  repositoryWrite: false,
  publication: false,
  execution: false,
  credentialAccess: false,
});

function digest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceIdentity() {
  return {
    repositoryHeadSha: 'c'.repeat(40),
    manifestBlobSha: 'd'.repeat(40),
  };
}

export function keyFixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeySha256 = sha256(der);
  const keyId = `evavo-github-estate-snapshot:${publicKeySha256.slice(0, 24)}`;
  const trustBundle = {
    schemaVersion: ESTATE_SNAPSHOT_ATTESTATION_TRUST_SCHEMA,
    keyId,
    systemId: ESTATE_SNAPSHOT_ATTESTOR_SYSTEM_ID,
    publicKeyPemEnv: 'EVAVO_GITHUB_ESTATE_SNAPSHOT_PUBLIC_KEY_PEM',
    activeFrom: new Date(NOW_MS - 60_000).toISOString(),
    activeUntil: new Date(NOW_MS + 365 * 24 * 60 * 60_000).toISOString(),
    publicKeySha256,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyReturned: false,
    secretPathReturned: false,
    authorityGranted: false,
  };
  return { privateKey, trustBundle, keyId };
}

function snapshotDocuments(snapshotAt, selectionIntent = 'mutation') {
  const inventory = {
    schemaVersion: 1,
    kind: 'evavo-repository-inventory-v1',
    organization: 'EVAVO-STUDIO',
    capturedAt: snapshotAt,
    repositories: [],
  };
  const manifestBody = {
    schemaVersion: 1,
    kind: 'evavo-repository-estate-manifest-v1',
    organization: 'EVAVO-STUDIO',
    compiledAt: snapshotAt,
    inventoryCapturedAt: snapshotAt,
    policyScope: 'test',
    policyComplete: true,
    status: 'governed',
    summary: {
      inventoryRepositories: 0,
      policyRepositories: 0,
      governed: 0,
      drifted: 0,
      blocked: 0,
      unclassified: 0,
      reviewEligible: 0,
      mutationEligible: 0,
      publicationEligible: 0,
      stalePolicyEntries: 0,
    },
    stalePolicyEntries: [],
    repositories: [],
    authority: AUTHORITY,
  };
  const manifest = { ...manifestBody, manifestDigest: digest(manifestBody) };
  const selectionBody = {
    schemaVersion: 1,
    kind: 'evavo-repository-estate-selection-v1',
    selectedAt: snapshotAt,
    intent: selectionIntent,
    manifestDigest: manifest.manifestDigest,
    selected: [],
    rejected: [],
    authority: AUTHORITY,
  };
  const selection = { ...selectionBody, selectionDigest: digest(selectionBody) };
  const observations = {
    schemaVersion: 1,
    kind: 'evavo-repository-provider-observations-v1',
    capturedAt: snapshotAt,
    repositories: [],
  };
  const auditBody = {
    schemaVersion: 1,
    kind: 'evavo-repository-provider-audit-v1',
    auditedAt: snapshotAt,
    observationsCapturedAt: snapshotAt,
    policyScope: 'test',
    policyComplete: true,
    status: 'compliant',
    summary: {
      policyRepositories: 0,
      observedRepositories: 0,
      compliant: 0,
      drifted: 0,
      blocked: 0,
    },
    entries: [],
    authority: AUTHORITY,
  };
  const audit = { ...auditBody, auditDigest: digest(auditBody) };
  return {
    'inventory.json': inventory,
    'estate-manifest.json': manifest,
    'estate-selection.json': selection,
    'provider-observations.json': observations,
    'provider-audit.json': audit,
  };
}

function sidecarPayload({ snapshotAt, snapshotDigest, indexDigest, selectionIntent, directoryName, attestedAt = snapshotAt }) {
  const source = sourceIdentity();
  return {
    schemaVersion: ESTATE_SNAPSHOT_ATTESTATION_SCHEMA,
    systemId: ESTATE_SNAPSHOT_ATTESTOR_SYSTEM_ID,
    repository: 'EVAVO-STUDIO/evavo-github-mcp',
    repositoryHeadSha: source.repositoryHeadSha,
    manifestBlobSha: source.manifestBlobSha,
    snapshotAt,
    snapshotDigest,
    indexDigest,
    selectionIntent,
    snapshotDirectoryName: directoryName,
    attestedAt,
    authority: AUTHORITY,
  };
}

function canonicalAttestationValue(value, seen = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Object.is(value, -0) ? '0' : JSON.stringify(value);
  if (seen.has(value)) throw new Error('cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalAttestationValue(entry, seen)).join(',')}]`;
    }
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalAttestationValue(value[key], seen)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export async function createSnapshotDirectory(root, {
  snapshotAt = NOW,
  selectionIntent = 'mutation',
  key = keyFixture(),
  attestedAt = snapshotAt,
} = {}) {
  const documents = snapshotDocuments(snapshotAt, selectionIntent);
  const snapshotBody = {
    schemaVersion: 1,
    kind: 'evavo-repository-estate-governance-snapshot-v1',
    snapshotAt,
    selectionIntent,
    inventory: documents['inventory.json'],
    estateManifest: documents['estate-manifest.json'],
    estateSelection: documents['estate-selection.json'],
    providerObservations: documents['provider-observations.json'],
    providerAudit: documents['provider-audit.json'],
    authority: AUTHORITY,
  };
  const snapshotDigest = digest(snapshotBody);
  const directoryName = `estate-${snapshotAt.replace(/[-:.]/gu, '')}-${snapshotDigest.slice(7, 27)}`;
  const directory = path.join(root, directoryName);
  await fsp.mkdir(directory, { recursive: false });
  const files = [];
  for (const [name, document] of Object.entries(documents)) {
    const bytes = Buffer.from(canonicalJson(document), 'utf8');
    await fsp.writeFile(path.join(directory, name), bytes);
    files.push({
      name,
      bytes: bytes.length,
      sha256: `sha256:${sha256(bytes)}`,
    });
  }
  const indexBody = {
    schemaVersion: 1,
    kind: 'evavo-repository-estate-governance-snapshot-index-v1',
    snapshotAt,
    selectionIntent,
    snapshotDigest,
    files: files.sort((left, right) => left.name.localeCompare(right.name)),
    authority: AUTHORITY,
  };
  const index = { ...indexBody, indexDigest: digest(indexBody) };
  await fsp.writeFile(path.join(directory, 'snapshot-index.json'), canonicalJson(index));
  const payload = sidecarPayload({
    snapshotAt,
    snapshotDigest,
    indexDigest: index.indexDigest,
    selectionIntent,
    directoryName,
    attestedAt,
  });
  const signature = signBytes(
    null,
    Buffer.from(
      `${ESTATE_SNAPSHOT_ATTESTATION_SIGNING_DOMAIN}${canonicalAttestationValue(payload)}`,
      'utf8',
    ),
    key.privateKey,
  );
  const sidecar = {
    payload,
    keyId: key.keyId,
    signatureBase64: signature.toString('base64'),
  };
  await fsp.writeFile(path.join(directory, 'snapshot-attestation.json'), canonicalJson(sidecar));
  return { directory, key, snapshotDigest, indexDigest: index.indexDigest, sidecar };
}

export async function withTemporaryDirectory(run) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'evavo-estate-routing-test-'));
  try {
    return await run(directory);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
}
