import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeReceiptTruth } from '../mcp-server/control-policy-core.mjs';

test('PowerShell child preflight failure is normalized as no physical effect', () => {
  const result = normalizeReceiptTruth({
    kind: 'evavo-powershell-child-execution-receipt-v1',
    status: 'failed-preflight',
    terminalReceiptPersisted: true,
  });
  assert.equal(result.recognized, true);
  assert.equal(result.facts.physicalEffectState, 'not_attempted');
  assert.equal(result.facts.sideEffectMayHaveCommitted, false);
  assert.equal(result.advice.disposition, 'retry-safe-no-effect');
  assert.equal(result.advice.retryUnderlyingAction, true);
});

test('PowerShell target-dispatched receipt blocks replay even without terminal receipt', () => {
  const result = normalizeReceiptTruth({
    kind: 'evavo-powershell-child-execution-receipt-v1',
    status: 'target-dispatched',
    terminalReceiptPersisted: false,
  });
  assert.equal(result.recognized, true);
  assert.equal(result.facts.physicalEffectState, 'unknown_after_dispatch');
  assert.equal(result.facts.sideEffectMayHaveCommitted, true);
  assert.equal(result.advice.disposition, 'reconcile-before-retry');
  assert.equal(result.advice.retryUnderlyingAction, false);
  assert.equal(result.reconciliationRequired, true);
});

test('PowerShell child normal return is execution-complete but postcondition-unverified', () => {
  const result = normalizeReceiptTruth({
    kind: 'evavo-powershell-child-execution-receipt-v1',
    status: 'returned',
    terminalReceiptPersisted: true,
  });
  assert.equal(result.facts.physicalEffectState, 'completed_unverified');
  assert.equal(result.facts.postconditionVerified, false);
  assert.equal(result.advice.retryUnderlyingAction, false);
  assert.equal(result.advice.reconciliationRequired, true);
});

test('canonical Local Storage verified commit remains complete', () => {
  const result = normalizeReceiptTruth({
    kind: 'evavo-local-storage-operation-v3',
    physicalEffectState: 'verified_committed',
    sideEffectMayHaveCommitted: true,
    postconditionVerified: true,
    intentPersisted: true,
    terminalReceiptPersisted: true,
    reconciliationRequired: false,
  });
  assert.equal(result.recognized, true);
  assert.equal(result.advice.disposition, 'complete');
  assert.equal(result.advice.operationSucceeded, true);
  assert.equal(result.advice.retryUnderlyingAction, false);
});

test('gateway nested receipt fields are normalized without inventing postcondition proof', () => {
  const result = normalizeReceiptTruth({
    physicalEffectState: 'completed_unverified',
    sideEffectMayHaveCommitted: true,
    postconditionVerified: false,
    reconciliationRequired: true,
    receipt: {
      intentPersisted: true,
      terminalReceiptPersisted: false,
    },
  });
  assert.equal(result.recognized, true);
  assert.equal(result.facts.intentPersisted, true);
  assert.equal(result.facts.terminalReceiptPersisted, false);
  assert.equal(result.advice.disposition, 'reconcile-before-retry');
  assert.equal(result.advice.retryUnderlyingAction, false);
});

test('unknown receipt shapes fail closed', () => {
  const result = normalizeReceiptTruth({ kind: 'mystery-provider-receipt-v9', ok: false });
  assert.equal(result.recognized, false);
  assert.equal(result.retryUnderlyingAction, false);
  assert.equal(result.reconciliationRequired, true);
});
