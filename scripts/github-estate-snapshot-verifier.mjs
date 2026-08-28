import fs from 'node:fs';
import path from 'node:path';

import {
  DIRECTORY_PATTERN,
  ESTATE_SNAPSHOT_INDEX_KIND,
  ESTATE_SNAPSHOT_KIND,
  EXPECTED_DIRECTORY_FILES,
  EXPECTED_FILES,
  MAX_INDEX_BYTES,
  MAX_JSON_BYTES,
  PREFIXED_SHA256_PATTERN,
  SNAPSHOT_INTENTS,
  assert,
  authority,
  canonicalInstant,
  digestJson,
  exactKeys,
  fail,
  falseAuthority,
  integer,
  isRecord,
  readCanonicalJsonFile,
  sha256Bytes,
  text,
} from './github-estate-routing-common.mjs';

function validateIndexFile(value, index) {
  exactKeys(value, ['name', 'bytes', 'sha256'], [], `EVAVO_ESTATE_ROUTING_INDEX_FILE_${index}`);
  const name = text(value.name, 'EVAVO_ESTATE_ROUTING_INDEX_FILE_NAME', {
    maximum: 132,
    pattern: /^[a-z0-9][a-z0-9.-]{0,127}\.json$/u,
  });
  assert(EXPECTED_FILES.includes(name), 'EVAVO_ESTATE_ROUTING_INDEX_FILE_UNKNOWN', name);
  return Object.freeze({
    name,
    bytes: integer(value.bytes, 'EVAVO_ESTATE_ROUTING_INDEX_FILE_BYTES', 1, MAX_JSON_BYTES),
    sha256: text(value.sha256, 'EVAVO_ESTATE_ROUTING_INDEX_FILE_SHA256', {
      maximum: 71,
      pattern: PREFIXED_SHA256_PATTERN,
    }),
  });
}

function validateSnapshotIndex(value) {
  exactKeys(
    value,
    [
      'schemaVersion',
      'kind',
      'snapshotAt',
      'selectionIntent',
      'snapshotDigest',
      'files',
      'authority',
      'indexDigest',
    ],
    [],
    'EVAVO_ESTATE_ROUTING_INDEX',
  );
  assert(value.schemaVersion === 1, 'EVAVO_ESTATE_ROUTING_INDEX_SCHEMA');
  assert(value.kind === ESTATE_SNAPSHOT_INDEX_KIND, 'EVAVO_ESTATE_ROUTING_INDEX_KIND');
  const snapshotAt = canonicalInstant(value.snapshotAt, 'EVAVO_ESTATE_ROUTING_INDEX_AT');
  assert(SNAPSHOT_INTENTS.has(value.selectionIntent), 'EVAVO_ESTATE_ROUTING_INDEX_INTENT');
  text(value.snapshotDigest, 'EVAVO_ESTATE_ROUTING_INDEX_SNAPSHOT_DIGEST', {
    maximum: 71,
    pattern: PREFIXED_SHA256_PATTERN,
  });
  assert(
    Array.isArray(value.files) && value.files.length === EXPECTED_FILES.length,
    'EVAVO_ESTATE_ROUTING_INDEX_FILES',
  );
  const files = value.files.map(validateIndexFile);
  assert(new Set(files.map((entry) => entry.name)).size === files.length, 'EVAVO_ESTATE_ROUTING_INDEX_DUPLICATE');
  assert(EXPECTED_FILES.every((name) => files.some((entry) => entry.name === name)), 'EVAVO_ESTATE_ROUTING_INDEX_MISSING');
  falseAuthority(value.authority, 'EVAVO_ESTATE_ROUTING_INDEX_AUTHORITY');
  text(value.indexDigest, 'EVAVO_ESTATE_ROUTING_INDEX_DIGEST', {
    maximum: 71,
    pattern: PREFIXED_SHA256_PATTERN,
  });
  const { indexDigest, ...unsigned } = value;
  assert(indexDigest === digestJson(unsigned), 'EVAVO_ESTATE_ROUTING_INDEX_DIGEST_MISMATCH');
  return Object.freeze({ ...value, snapshotAtMilliseconds: snapshotAt.milliseconds, files });
}

function validateComponentDocument(name, value, snapshotAt, selectionIntent) {
  assert(isRecord(value), 'EVAVO_ESTATE_ROUTING_COMPONENT', name);
  if (name === 'inventory.json') {
    exactKeys(
      value,
      ['schemaVersion', 'kind', 'organization', 'capturedAt', 'repositories'],
      [],
      'EVAVO_ESTATE_ROUTING_INVENTORY',
    );
    assert(value.schemaVersion === 1, 'EVAVO_ESTATE_ROUTING_INVENTORY_SCHEMA');
    assert(value.kind === 'evavo-repository-inventory-v1', 'EVAVO_ESTATE_ROUTING_INVENTORY_KIND');
    assert(value.organization === 'EVAVO-STUDIO', 'EVAVO_ESTATE_ROUTING_INVENTORY_ORGANIZATION');
    assert(value.capturedAt === snapshotAt, 'EVAVO_ESTATE_ROUTING_INVENTORY_AT');
    assert(Array.isArray(value.repositories), 'EVAVO_ESTATE_ROUTING_INVENTORY_REPOSITORIES');
    return;
  }
  if (name === 'estate-manifest.json') {
    exactKeys(
      value,
      [
        'schemaVersion',
        'kind',
        'organization',
        'compiledAt',
        'inventoryCapturedAt',
        'policyScope',
        'policyComplete',
        'status',
        'summary',
        'stalePolicyEntries',
        'repositories',
        'authority',
        'manifestDigest',
      ],
      [],
      'EVAVO_ESTATE_ROUTING_MANIFEST',
    );
    assert(value.schemaVersion === 1, 'EVAVO_ESTATE_ROUTING_MANIFEST_SCHEMA');
    assert(value.kind === 'evavo-repository-estate-manifest-v1', 'EVAVO_ESTATE_ROUTING_MANIFEST_KIND');
    assert(value.organization === 'EVAVO-STUDIO', 'EVAVO_ESTATE_ROUTING_MANIFEST_ORGANIZATION');
    assert(value.compiledAt === snapshotAt && value.inventoryCapturedAt === snapshotAt, 'EVAVO_ESTATE_ROUTING_MANIFEST_AT');
    falseAuthority(value.authority, 'EVAVO_ESTATE_ROUTING_MANIFEST_AUTHORITY');
    const { manifestDigest, ...unsigned } = value;
    assert(manifestDigest === digestJson(unsigned), 'EVAVO_ESTATE_ROUTING_MANIFEST_DIGEST');
    return;
  }
  if (name === 'estate-selection.json') {
    exactKeys(
      value,
      [
        'schemaVersion',
        'kind',
        'selectedAt',
        'intent',
        'manifestDigest',
        'selected',
        'rejected',
        'authority',
        'selectionDigest',
      ],
      [],
      'EVAVO_ESTATE_ROUTING_SELECTION',
    );
    assert(value.schemaVersion === 1, 'EVAVO_ESTATE_ROUTING_SELECTION_SCHEMA');
    assert(value.kind === 'evavo-repository-estate-selection-v1', 'EVAVO_ESTATE_ROUTING_SELECTION_KIND');
    assert(value.selectedAt === snapshotAt && value.intent === selectionIntent, 'EVAVO_ESTATE_ROUTING_SELECTION_AT');
    falseAuthority(value.authority, 'EVAVO_ESTATE_ROUTING_SELECTION_AUTHORITY');
    const { selectionDigest, ...unsigned } = value;
    assert(selectionDigest === digestJson(unsigned), 'EVAVO_ESTATE_ROUTING_SELECTION_DIGEST');
    return;
  }
  if (name === 'provider-observations.json') {
    exactKeys(
      value,
      ['schemaVersion', 'kind', 'capturedAt', 'repositories'],
      [],
      'EVAVO_ESTATE_ROUTING_PROVIDER_OBSERVATIONS',
    );
    assert(value.schemaVersion === 1, 'EVAVO_ESTATE_ROUTING_PROVIDER_OBSERVATIONS_SCHEMA');
    assert(value.kind === 'evavo-repository-provider-observations-v1', 'EVAVO_ESTATE_ROUTING_PROVIDER_OBSERVATIONS_KIND');
    assert(value.capturedAt === snapshotAt, 'EVAVO_ESTATE_ROUTING_PROVIDER_OBSERVATIONS_AT');
    assert(Array.isArray(value.repositories), 'EVAVO_ESTATE_ROUTING_PROVIDER_OBSERVATIONS_REPOSITORIES');
    return;
  }
  if (name === 'provider-audit.json') {
    exactKeys(
      value,
      [
        'schemaVersion',
        'kind',
        'auditedAt',
        'observationsCapturedAt',
        'policyScope',
        'policyComplete',
        'status',
        'summary',
        'entries',
        'authority',
        'auditDigest',
      ],
      [],
      'EVAVO_ESTATE_ROUTING_PROVIDER_AUDIT',
    );
    assert(value.schemaVersion === 1, 'EVAVO_ESTATE_ROUTING_PROVIDER_AUDIT_SCHEMA');
    assert(value.kind === 'evavo-repository-provider-audit-v1', 'EVAVO_ESTATE_ROUTING_PROVIDER_AUDIT_KIND');
    assert(value.auditedAt === snapshotAt && value.observationsCapturedAt === snapshotAt, 'EVAVO_ESTATE_ROUTING_PROVIDER_AUDIT_AT');
    falseAuthority(value.authority, 'EVAVO_ESTATE_ROUTING_PROVIDER_AUDIT_AUTHORITY');
    const { auditDigest, ...unsigned } = value;
    assert(auditDigest === digestJson(unsigned), 'EVAVO_ESTATE_ROUTING_PROVIDER_AUDIT_DIGEST');
    return;
  }
  fail('EVAVO_ESTATE_ROUTING_COMPONENT_UNKNOWN', name);
}

function expectedDirectoryName(index) {
  return `estate-${index.snapshotAt.replace(/[-:.]/gu, '')}-${index.snapshotDigest.slice('sha256:'.length, 'sha256:'.length + 20)}`;
}

export function verifyEstateSnapshotDirectory(snapshotDirectory) {
  const directory = path.resolve(
    text(snapshotDirectory, 'EVAVO_ESTATE_ROUTING_DIRECTORY', { maximum: 4096 }),
  );
  const directoryStat = fs.lstatSync(directory);
  assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), 'EVAVO_ESTATE_ROUTING_DIRECTORY_TYPE', directory);
  const entries = fs.readdirSync(directory).sort();
  assert(
    entries.length === EXPECTED_DIRECTORY_FILES.length &&
      entries.every((entry, index) => entry === [...EXPECTED_DIRECTORY_FILES].sort()[index]),
    'EVAVO_ESTATE_ROUTING_DIRECTORY_FILES',
    entries.join(','),
  );
  const indexDocument = readCanonicalJsonFile(
    path.join(directory, 'snapshot-index.json'),
    MAX_INDEX_BYTES,
    'EVAVO_ESTATE_ROUTING_INDEX_FILE',
  );
  const index = validateSnapshotIndex(indexDocument.value);
  assert(path.basename(directory) === expectedDirectoryName(index), 'EVAVO_ESTATE_ROUTING_DIRECTORY_NAME');

  const components = {};
  for (const record of index.files) {
    const filePath = path.join(directory, record.name);
    assert(path.dirname(filePath) === directory, 'EVAVO_ESTATE_ROUTING_COMPONENT_PATH', record.name);
    const document = readCanonicalJsonFile(
      filePath,
      MAX_JSON_BYTES,
      'EVAVO_ESTATE_ROUTING_COMPONENT_FILE',
    );
    assert(document.bytes.length === record.bytes, 'EVAVO_ESTATE_ROUTING_COMPONENT_BYTES', record.name);
    assert(`sha256:${sha256Bytes(document.bytes)}` === record.sha256, 'EVAVO_ESTATE_ROUTING_COMPONENT_HASH', record.name);
    validateComponentDocument(
      record.name,
      document.value,
      index.snapshotAt,
      index.selectionIntent,
    );
    components[record.name] = document.value;
  }

  assert(
    components['estate-selection.json'].manifestDigest ===
      components['estate-manifest.json'].manifestDigest,
    'EVAVO_ESTATE_ROUTING_MANIFEST_SELECTION_BINDING',
  );
  assert(
    components['provider-audit.json'].observationsCapturedAt ===
      components['provider-observations.json'].capturedAt,
    'EVAVO_ESTATE_ROUTING_PROVIDER_BINDING',
  );

  const snapshotBody = {
    schemaVersion: 1,
    kind: ESTATE_SNAPSHOT_KIND,
    snapshotAt: index.snapshotAt,
    selectionIntent: index.selectionIntent,
    inventory: components['inventory.json'],
    estateManifest: components['estate-manifest.json'],
    estateSelection: components['estate-selection.json'],
    providerObservations: components['provider-observations.json'],
    providerAudit: components['provider-audit.json'],
    authority: authority(),
  };
  assert(index.snapshotDigest === digestJson(snapshotBody), 'EVAVO_ESTATE_ROUTING_SNAPSHOT_DIGEST');

  return Object.freeze({
    directory,
    snapshotAt: index.snapshotAt,
    snapshotAtMilliseconds: index.snapshotAtMilliseconds,
    selectionIntent: index.selectionIntent,
    snapshotDigest: index.snapshotDigest,
    indexDigest: index.indexDigest,
    inventoryRepositoryCount: components['inventory.json'].repositories.length,
    manifestStatus: components['estate-manifest.json'].status,
    providerAuditStatus: components['provider-audit.json'].status,
    authority: authority(),
  });
}

function candidateDirectoryNames(root) {
  const rootStat = fs.lstatSync(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'EVAVO_ESTATE_ROUTING_ROOT_TYPE', root);
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && DIRECTORY_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

export function selectLatestEstateSnapshotDirectory(snapshotRoot) {
  const root = path.resolve(
    text(snapshotRoot, 'EVAVO_ESTATE_ROUTING_ROOT', { maximum: 4096 }),
  );
  assert(path.parse(root).root !== root, 'EVAVO_ESTATE_ROUTING_ROOT_IS_VOLUME_ROOT');
  const candidates = candidateDirectoryNames(root);
  assert(candidates.length > 0, 'EVAVO_ESTATE_ROUTING_ROOT_EMPTY', root);
  const newest = path.join(root, candidates[0]);
  assert(path.dirname(newest) === root, 'EVAVO_ESTATE_ROUTING_LATEST_PATH');
  verifyEstateSnapshotDirectory(newest);
  return newest;
}

