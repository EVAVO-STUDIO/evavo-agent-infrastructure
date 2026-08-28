import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ESTATE_ROUTING_VERIFICATION_KIND,
  canonicalJson,
  createEstateRoutingStatus,
  selectLatestEstateSnapshotDirectory,
  verifyEstateRoutingEvidence,
  verifyEstateSnapshotDirectory,
} from '../scripts/github-estate-routing-evidence.mjs';
import {
  NOW,
  NOW_MS,
  createSnapshotDirectory,
  keyFixture,
  withTemporaryDirectory,
} from './github-estate-routing-fixture.mjs';

test('valid signed estate snapshot becomes deterministic completed routing evidence', async () => {
  await withTemporaryDirectory(async (root) => {
    const fixture = await createSnapshotDirectory(root);
    const first = verifyEstateRoutingEvidence({
      snapshotDirectory: fixture.directory,
      trustBundle: fixture.key.trustBundle,
      now: NOW,
    });
    const second = verifyEstateRoutingEvidence({
      snapshotDirectory: fixture.directory,
      trustBundle: fixture.key.trustBundle,
      now: NOW,
    });
    assert.deepEqual(first, second);
    assert.equal(first.kind, ESTATE_ROUTING_VERIFICATION_KIND);
    assert.equal(first.sourceRevision, 'c'.repeat(40));
    assert.equal(first.sourceBinding, 'signed-snapshot-sidecar-v1');
    assert.equal(first.snapshotDigest, fixture.snapshotDigest);
    assert.match(first.receiptId, /^evavo-estate-routing:sha256:[0-9a-f]{64}$/u);
    assert.equal(first.authority.execution, false);

    const status = createEstateRoutingStatus({ verification: first, client: 'chatgpt-pro' });
    assert.equal(status.evidence[0].state, 'completed');
    assert.equal(status.evidence[0].observedAt, NOW);
    assert.equal(status.evidence[0].sourceRevision, 'c'.repeat(40));
    assert.equal(status.evidence[0].receiptId, first.receiptId);
  });
});

test('component corruption, non-canonical content and extra files fail closed', async () => {
  await withTemporaryDirectory(async (root) => {
    const fixture = await createSnapshotDirectory(root);
    const inventoryPath = path.join(fixture.directory, 'inventory.json');
    await fsp.writeFile(inventoryPath, '{}\n', 'utf8');
    assert.throws(
      () => verifyEstateSnapshotDirectory(fixture.directory),
      /COMPONENT_(?:BYTES|HASH)|INVENTORY/u,
    );
  });
  await withTemporaryDirectory(async (root) => {
    const fixture = await createSnapshotDirectory(root);
    const indexPath = path.join(fixture.directory, 'snapshot-index.json');
    const index = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
    await fsp.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    assert.throws(
      () => verifyEstateSnapshotDirectory(fixture.directory),
      /INDEX_FILE_NON_CANONICAL/u,
    );
  });
  await withTemporaryDirectory(async (root) => {
    const fixture = await createSnapshotDirectory(root);
    await fsp.writeFile(path.join(fixture.directory, 'unexpected.txt'), 'x', 'utf8');
    assert.throws(
      () => verifyEstateSnapshotDirectory(fixture.directory),
      /DIRECTORY_FILES/u,
    );
  });
});

test('sidecar signature and signed binding cannot be altered', async () => {
  await withTemporaryDirectory(async (root) => {
    const fixture = await createSnapshotDirectory(root);
    const sidecarPath = path.join(fixture.directory, 'snapshot-attestation.json');
    const sidecar = JSON.parse(await fsp.readFile(sidecarPath, 'utf8'));
    sidecar.payload.repositoryHeadSha = 'e'.repeat(40);
    await fsp.writeFile(sidecarPath, canonicalJson(sidecar), 'utf8');
    assert.throws(
      () => verifyEstateRoutingEvidence({
        snapshotDirectory: fixture.directory,
        trustBundle: fixture.key.trustBundle,
        now: NOW,
      }),
      /SIGNATURE_INVALID/u,
    );
  });
  await withTemporaryDirectory(async (root) => {
    const fixture = await createSnapshotDirectory(root);
    const otherKey = keyFixture();
    assert.throws(
      () => verifyEstateRoutingEvidence({
        snapshotDirectory: fixture.directory,
        trustBundle: otherKey.trustBundle,
        now: NOW,
      }),
      /ATTESTATION_KEY_ID/u,
    );
  });
});

test('newest corrupt snapshot blocks root selection instead of falling back', async () => {
  await withTemporaryDirectory(async (root) => {
    await createSnapshotDirectory(root, {
      snapshotAt: new Date(NOW_MS - 60_000).toISOString(),
      attestedAt: new Date(NOW_MS - 60_000).toISOString(),
    });
    const newest = await createSnapshotDirectory(root, {
      snapshotAt: NOW,
      attestedAt: NOW,
    });
    await fsp.writeFile(path.join(newest.directory, 'provider-audit.json'), '{}\n', 'utf8');
    assert.throws(
      () => selectLatestEstateSnapshotDirectory(root),
      /COMPONENT_(?:BYTES|HASH)|PROVIDER_AUDIT/u,
    );
  });
});

