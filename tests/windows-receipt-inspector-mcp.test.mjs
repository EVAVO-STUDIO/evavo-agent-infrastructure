import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SERVER = path.resolve('mcp-server/windows-receipt-inspector-mcp.mjs');

function callServer(receiptRoot, receiptId) {
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'evavo_windows_receipt_status', arguments: { receiptId } },
  };
  const result = spawnSync(process.execPath, [SERVER], {
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    env: { ...process.env, EVAVO_POWERSHELL_CHILD_RECEIPT_ROOT: receiptRoot },
  });
  assert.equal(result.status, 0);
  const response = JSON.parse(result.stdout.trim());
  return response.result.structuredContent;
}

test('target-dispatched receipt is found and blocks physical replay', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evavo-receipt-inspector-'));
  try {
    const id = 'pschild-1750000000000-1234-abcdef123456';
    fs.writeFileSync(path.join(root, `${id}.json`), JSON.stringify({
      schemaVersion: 1,
      kind: 'evavo-powershell-child-execution-receipt-v1',
      invocationId: id,
      status: 'target-dispatched',
      startedAt: '2026-08-31T00:00:00Z',
      completedAt: null,
      targetName: 'probe.ps1',
      targetSha256: 'a'.repeat(64),
      parametersSha256: 'b'.repeat(64),
      executionAttempted: true,
      targetDispatched: true,
      sideEffectMayHaveCommitted: true,
      postconditionVerified: false,
      reconciliationRequired: true,
      safeAutomaticReplay: false,
      terminalReceiptPersisted: false,
      receiptPersistence: 'dispatch-intent',
      writeRaisedButVerified: false,
      exitCode: null,
    }) + '\n');

    const value = callServer(root, id);
    assert.equal(value.found, true);
    assert.equal(value.status, 'target-dispatched');
    assert.equal(value.normalized.recognized, true);
    assert.equal(value.normalized.advice.disposition, 'reconcile-before-retry');
    assert.equal(value.retryUnderlyingAction, false);
    assert.equal(value.reconciliationRequired, true);
    assert.equal(value.physicalPathsReturned, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing receipt never grants retry safety', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evavo-receipt-inspector-missing-'));
  try {
    const id = 'pschild-1750000000001-1235-abcdef123457';
    const value = callServer(root, id);
    assert.equal(value.found, false);
    assert.equal(value.retryUnderlyingAction, false);
    assert.equal(value.reconciliationRequired, true);
    assert.match(value.reason, /not-proof/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt identity mismatch fails closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evavo-receipt-inspector-bad-'));
  try {
    const id = 'pschild-1750000000002-1236-abcdef123458';
    fs.writeFileSync(path.join(root, `${id}.json`), JSON.stringify({
      kind: 'evavo-powershell-child-execution-receipt-v1',
      invocationId: 'pschild-1750000000003-1237-abcdef123459',
      status: 'returned',
    }) + '\n');
    const value = callServer(root, id);
    assert.equal(value.kind, 'evavo-windows-physical-receipt-inspector-error-v1');
    assert.equal(value.retryUnderlyingAction, false);
    assert.equal(value.reconciliationRequired, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
