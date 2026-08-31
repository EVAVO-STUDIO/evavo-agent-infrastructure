import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeReceiptTruth } from '../mcp-server/control-policy-core.mjs';

test('verified strict bridge transfer with cleanup reconciliation never authorizes physical replay', () => {
  const normalized = normalizeReceiptTruth({
    receiptModel: 'durable_intent_before_transfer_v4',
    status: 'succeeded',
    physicalEffectState: 'verified_committed',
    sideEffectMayHaveCommitted: true,
    postconditionVerified: true,
    intentPersisted: true,
    terminalReceiptPersisted: true,
    reconciliationRequired: true,
    safeAutomaticReplay: false,
    physicalActionReplaySafe: false,
    receiptReplaySafe: false,
    transferPostconditionVerified: true,
    cleanupReconciliationRequired: true,
  });

  assert.equal(normalized.recognized, true);
  assert.equal(normalized.facts.sourceKind, 'canonical-fields');
  assert.equal(normalized.advice.operationSucceeded, true);
  assert.equal(normalized.advice.disposition, 'success-receipt-degraded');
  assert.equal(normalized.advice.retryUnderlyingAction, false);
  assert.equal(normalized.advice.requestReplaySafe, false);
  assert.equal(normalized.advice.receiptReplaySafe, false);
  assert.equal(normalized.advice.reconciliationRequired, true);
});

test('verified strict bridge terminal receipt is replayable as evidence but never re-executes transfer', () => {
  const normalized = normalizeReceiptTruth({
    receiptModel: 'durable_intent_before_transfer_v4',
    status: 'succeeded',
    physicalEffectState: 'verified_committed',
    sideEffectMayHaveCommitted: true,
    postconditionVerified: true,
    intentPersisted: true,
    terminalReceiptPersisted: true,
    reconciliationRequired: false,
    safeAutomaticReplay: false,
    physicalActionReplaySafe: false,
    receiptReplaySafe: true,
  });

  assert.equal(normalized.advice.disposition, 'complete');
  assert.equal(normalized.advice.operationSucceeded, true);
  assert.equal(normalized.advice.retryUnderlyingAction, false);
  assert.equal(normalized.advice.requestReplaySafe, false);
  assert.equal(normalized.advice.receiptReplaySafe, true);
  assert.equal(normalized.advice.reconciliationRequired, false);
});
