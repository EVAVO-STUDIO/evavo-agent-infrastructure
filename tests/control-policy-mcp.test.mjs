import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  callControlPolicyTool,
  chooseControlRoute,
  classifyReceiptTruth,
  controlPolicyMcpContract,
  controlPolicyTools,
} from '../mcp-server/control-policy-core.mjs';

test('control policy MCP has no execution authority', () => {
  assert.equal(controlPolicyMcpContract.readOnly, true);
  assert.equal(controlPolicyMcpContract.executionAuthority, false);
  assert.equal(controlPolicyMcpContract.focusDisruptionExpected, false);
  assert.deepEqual(controlPolicyTools.map((tool) => tool.name), [
    'evavo_control_path_policy',
    'evavo_control_health_policy',
    'evavo_control_route_advice',
    'evavo_control_receipt_advice',
  ]);
});

test('route advice prefers typed API then singleton gateway before generic local routes', () => {
  assert.equal(chooseControlRoute({ typedApiCapable: true, singletonGatewayCapable: true, backgroundCapable: true }).routeClass, 'typed-api-or-connector');
  assert.equal(chooseControlRoute({ singletonGatewayCapable: true, backgroundCapable: true, localMcpCapable: true }).routeClass, 'singleton-agent-gateway');
  assert.equal(chooseControlRoute({ backgroundCapable: true, nativeDesktopRequired: true }).routeClass, 'local-compute-background');
  assert.equal(chooseControlRoute({ localMcpCapable: true, physicalConsoleRequired: true }).routeClass, 'local-mcp');
  assert.equal(chooseControlRoute({ isolatedBrowserCapable: true, nativeDesktopRequired: true }).routeClass, 'isolated-browser');
});

test('foreground and recovery route advice is truthful about focus disruption', () => {
  const desktop = chooseControlRoute({ nativeDesktopRequired: true });
  const physical = chooseControlRoute({ physicalConsoleRequired: true });
  const recovery = chooseControlRoute({ outOfBandRecoveryRequired: true });
  assert.equal(desktop.focusDisruptionExpected, true);
  assert.equal(physical.disruption, 'physical-console');
  assert.equal(recovery.disruption, 'recovery-impact');
  assert.equal(recovery.execute, false);
});

test('verified committed mutation with durable terminal receipt is complete but physical action is never replay-safe', () => {
  const result = classifyReceiptTruth({
    physicalEffectState: 'verified_committed',
    sideEffectMayHaveCommitted: true,
    postconditionVerified: true,
    intentPersisted: true,
    terminalReceiptPersisted: true,
    reconciliationRequired: false,
  });
  assert.equal(result.kind, 'evavo-control-receipt-advice-v2');
  assert.equal(result.disposition, 'complete');
  assert.equal(result.operationSucceeded, true);
  assert.equal(result.retryUnderlyingAction, false);
  assert.equal(result.requestReplaySafe, false);
  assert.equal(result.receiptReplaySafe, true);
  assert.equal(result.reconciliationRequired, false);
});

test('verified physical success with degraded terminal receipt remains success and neither action nor receipt may replay', () => {
  const result = classifyReceiptTruth({
    physicalEffectState: 'verified_committed',
    sideEffectMayHaveCommitted: true,
    postconditionVerified: true,
    intentPersisted: true,
    terminalReceiptPersisted: false,
    reconciliationRequired: true,
  });
  assert.equal(result.disposition, 'success-receipt-degraded');
  assert.equal(result.operationSucceeded, true);
  assert.equal(result.retryUnderlyingAction, false);
  assert.equal(result.requestReplaySafe, false);
  assert.equal(result.receiptReplaySafe, false);
  assert.equal(result.reconciliationRequired, true);
});

test('unknown physical effect after callback failure always requires reconciliation', () => {
  const result = classifyReceiptTruth({
    physicalEffectState: 'unknown_after_callback_error',
    sideEffectMayHaveCommitted: true,
    postconditionVerified: false,
    intentPersisted: true,
    terminalReceiptPersisted: true,
    reconciliationRequired: true,
  });
  assert.equal(result.disposition, 'reconcile-before-retry');
  assert.equal(result.operationSucceeded, false);
  assert.equal(result.retryUnderlyingAction, false);
  assert.equal(result.requestReplaySafe, false);
  assert.equal(result.receiptReplaySafe, false);
  assert.equal(result.reconciliationRequired, true);
});

test('a proven not-attempted operation is the only normal retry-safe error disposition', () => {
  const result = classifyReceiptTruth({
    physicalEffectState: 'not_attempted',
    sideEffectMayHaveCommitted: false,
    postconditionVerified: false,
    intentPersisted: false,
    terminalReceiptPersisted: false,
    reconciliationRequired: false,
  });
  assert.equal(result.disposition, 'retry-safe-no-effect');
  assert.equal(result.operationSucceeded, false);
  assert.equal(result.retryUnderlyingAction, true);
  assert.equal(result.requestReplaySafe, true);
  assert.equal(result.receiptReplaySafe, false);
  assert.equal(result.reconciliationRequired, false);
});

test('contradictory receipt facts fail closed rather than granting retry', () => {
  const result = classifyReceiptTruth({
    physicalEffectState: 'not_attempted',
    sideEffectMayHaveCommitted: true,
    postconditionVerified: false,
    intentPersisted: true,
    terminalReceiptPersisted: false,
    reconciliationRequired: false,
  });
  assert.equal(result.disposition, 'reconcile-before-retry');
  assert.equal(result.retryUnderlyingAction, false);
  assert.equal(result.requestReplaySafe, false);
  assert.equal(result.receiptReplaySafe, false);
});

test('policy tools return canonical sibling contracts', async () => {
  const policy = await callControlPolicyTool('evavo_control_path_policy', {});
  const health = await callControlPolicyTool('evavo_control_health_policy', {});
  const receiptAdvice = await callControlPolicyTool('evavo_control_receipt_advice', {
    physicalEffectState: 'verified_committed',
    sideEffectMayHaveCommitted: true,
    postconditionVerified: true,
    intentPersisted: true,
    terminalReceiptPersisted: true,
    reconciliationRequired: false,
  });
  assert.equal(policy.kind, 'evavo-control-path-policy-v1');
  assert.equal(policy.executionAuthority, false);
  assert.equal(health.kind, 'evavo-workstation-control-health-v1');
  assert.equal(health.executionAuthority, false);
  assert.equal(receiptAdvice.kind, 'evavo-control-receipt-advice-v2');
  assert.equal(receiptAdvice.execute, false);
});

test('central MCP bundle registers policy and hardware gateway without embedded gateway token', () => {
  const text = fs.readFileSync('.mcp.json', 'utf8');
  const config = JSON.parse(text);
  assert.equal(config.mcpServers['evavo-control-policy'].args[0], './mcp-server/control-policy-mcp.mjs');
  assert.match(config.mcpServers['evavo-hardware-gateway'].args.join(' '), /start-mcp\.ps1/u);
  assert.doesNotMatch(text, /EVAVO_GATEWAY_TOKEN/u);
});
