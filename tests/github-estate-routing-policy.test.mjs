import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ESTATE_ROUTING_VERIFICATION_KIND,
  ESTATE_SNAPSHOT_ATTESTATION_TRUST_SCHEMA,
  createEstateRoutingStatus,
  parseStrictJson,
  readEstateRoutingInputFile,
  verifyEstateRoutingEvidence,
  verifyEstateSnapshotDirectory,
} from '../scripts/github-estate-routing-evidence.mjs';
import { parseEstateRoutingCli } from '../scripts/route-github-estate-snapshot.mjs';
import {
  NOW,
  NOW_MS,
  createSnapshotDirectory,
  keyFixture,
  withTemporaryDirectory,
} from './github-estate-routing-fixture.mjs';

test('future attestations and stale snapshots remain distinct truth conditions', async () => {
  await withTemporaryDirectory(async (root) => {
    const futureMs = NOW_MS + 3 * 60_000;
    const future = await createSnapshotDirectory(root, {
      snapshotAt: new Date(futureMs).toISOString(),
      attestedAt: new Date(futureMs).toISOString(),
    });
    assert.throws(
      () => verifyEstateRoutingEvidence({
        snapshotDirectory: future.directory,
        trustBundle: future.key.trustBundle,
        now: NOW,
      }),
      /ATTESTATION_FUTURE/u,
    );
  });
  await withTemporaryDirectory(async (root) => {
    const oldAt = new Date(NOW_MS - 60 * 60_000).toISOString();
    const old = await createSnapshotDirectory(root, {
      snapshotAt: oldAt,
      attestedAt: oldAt,
      key: (() => {
        const key = keyFixture();
        key.trustBundle.activeFrom = new Date(NOW_MS - 2 * 60 * 60_000).toISOString();
        return key;
      })(),
    });
    const verification = verifyEstateRoutingEvidence({
      snapshotDirectory: old.directory,
      trustBundle: old.key.trustBundle,
      now: NOW,
    });
    const status = createEstateRoutingStatus({ verification, client: 'claude-code' });
    assert.equal(status.capturedAt, NOW);
    assert.equal(status.evidence[0].observedAt, oldAt);
  });
});

test('symlinked snapshot components are rejected rather than followed', async (context) => {
  if (process.platform === 'win32') {
    context.skip('Symlink creation commonly requires elevated Windows privileges.');
    return;
  }
  await withTemporaryDirectory(async (root) => {
    const fixture = await createSnapshotDirectory(root);
    const target = path.join(fixture.directory, 'inventory.json');
    const replacement = path.join(root, 'replacement.json');
    await fsp.rename(target, replacement);
    await fsp.symlink(replacement, target);
    assert.throws(
      () => verifyEstateSnapshotDirectory(fixture.directory),
      /COMPONENT_FILE_TYPE/u,
    );
  });
});

test('strict input parsing rejects duplicate or prototype-polluting keys', () => {
  assert.throws(
    () => parseStrictJson('{"kind":"one","kind":"two"}'),
    /JSON_DUPLICATE_KEY/u,
  );
  assert.throws(
    () => parseStrictJson('{"__proto__":{}}'),
    /JSON_PROHIBITED_KEY/u,
  );
});

test('trust files may use ordinary JSON formatting while retaining strict structure', async () => {
  await withTemporaryDirectory(async (root) => {
    const key = keyFixture();
    const trustPath = path.join(root, 'trust.json');
    await fsp.writeFile(trustPath, `${JSON.stringify(key.trustBundle, null, 2)}\n`, 'utf8');
    const parsed = readEstateRoutingInputFile(trustPath, 'trust-bundle');
    assert.equal(parsed.keyId, key.keyId);
    assert.match(parsed.publicKeyPem, /BEGIN PUBLIC KEY/u);

    const duplicatePath = path.join(root, 'duplicate.json');
    await fsp.writeFile(
      duplicatePath,
      `{"schemaVersion":"${ESTATE_SNAPSHOT_ATTESTATION_TRUST_SCHEMA}","schemaVersion":"duplicate"}\n`,
      'utf8',
    );
    assert.throws(
      () => readEstateRoutingInputFile(duplicatePath, 'trust-bundle'),
      /JSON_DUPLICATE_KEY/u,
    );
  });
});

test('unknown clients and unsafe CLI escape routes are denied', () => {
  assert.throws(
    () => createEstateRoutingStatus({
      verification: {
        kind: ESTATE_ROUTING_VERIFICATION_KIND,
      },
      client: 'raw-shell-agent',
    }),
    /VERIFICATION_DIGEST|CLIENT/u,
  );
  assert.throws(
    () => parseEstateRoutingCli(['plan', '--', 'powershell', '-Command', 'whoami']),
    /named options only/u,
  );
  assert.throws(
    () => parseEstateRoutingCli([
      'status',
      '--snapshot-root',
      'snapshots',
      '--trust-bundle',
      'trust.json',
      '--client',
      'raw-shell-agent',
    ]),
    /Unsupported client/u,
  );
  assert.throws(
    () => parseEstateRoutingCli([
      'verify',
      '--snapshot-root',
      'one',
      '--snapshot-directory',
      'two',
      '--trust-bundle',
      'trust.json',
    ]),
    /exactly one/u,
  );
});
