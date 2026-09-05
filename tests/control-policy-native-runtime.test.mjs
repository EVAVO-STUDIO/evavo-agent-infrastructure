import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { callControlPolicyTool, chooseControlRoute, classifyReceiptTruth, normalizeReceiptTruth } from '../mcp-server/control-policy-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const noEffect = { physicalEffectState: 'not_attempted', sideEffectMayHaveCommitted: false,
  postconditionVerified: false, intentPersisted: false, terminalReceiptPersisted: false };
const child = { kind: 'evavo-powershell-child-execution-receipt-v1' };
const malformed = ['true', 'false', 0, 1, null, [], {}];

for (const field of ['typedApiCapable', 'singletonGatewayCapable', 'backgroundCapable', 'localMcpCapable',
  'isolatedBrowserCapable', 'nativeDesktopRequired', 'physicalConsoleRequired', 'outOfBandRecoveryRequired']) {
  test(`invalid ${field} cannot silently escalate to physical recovery`, () => {
    for (const value of malformed) assert.throws(() => chooseControlRoute({ outOfBandRecoveryRequired: true, [field]: value }), /boolean/);
  });
}

test('valid capabilities still select the least disruptive native route', () => {
  assert.equal(chooseControlRoute({ backgroundCapable: true, outOfBandRecoveryRequired: true }).routeClass, 'local-compute-background');
  assert.equal(chooseControlRoute({}).routeClass, 'unresolved');
  assert.equal(chooseControlRoute({ outOfBandRecoveryRequired: true }).execute, false);
});

test('optional reconciliation boolean is validated, not silently ignored', () => {
  for (const value of malformed) assert.throws(() => classifyReceiptTruth({ ...noEffect, reconciliationRequired: value }), /boolean/);
});

test('receipt state is never coerced from an object into permission', () => {
  assert.throws(() => classifyReceiptTruth({ ...noEffect, physicalEffectState: { toString: () => 'not_attempted' } }), /string/);
});

for (const field of ['sideEffectMayHaveCommitted', 'postconditionVerified', 'intentPersisted', 'terminalReceiptPersisted', 'reconciliationRequired']) {
  test(`raw malformed ${field} is blocked before canonical or child adaptation`, () => {
    for (const value of malformed) {
      for (const base of [noEffect, { ...child, status: 'failed-preflight', terminalReceiptPersisted: true }]) {
        const result = normalizeReceiptTruth({ ...base, [field]: value });
        assert.equal(result.retryUnderlyingAction, false);
        assert.equal(result.reconciliationRequired, true);
      }
    }
  });
}

test('nested reconciliation requirement cannot be discarded', () => {
  const result = normalizeReceiptTruth({ ...noEffect, receipt: { reconciliationRequired: true } });
  assert.equal(result.retryUnderlyingAction, false);
  assert.equal(result.reconciliationRequired, true);
});

test('malformed nested receipt cannot supply default no-effect advice', () => {
  for (const receipt of ['no effect', [], { completion_persisted: 'true' }, { intentPersisted: 0 }]) {
    assert.equal(normalizeReceiptTruth({ ...noEffect, receipt }).retryUnderlyingAction, false);
  }
});

for (const status of ['host-started', 'preflight-complete']) {
  test(`live ${status} is not permission to dispatch again`, () => {
    const result = normalizeReceiptTruth({ ...child, status });
    assert.equal(result.retryUnderlyingAction, false);
    assert.equal(result.reconciliationRequired, true);
    assert.equal(result.execute, false);
  });
}

test('failed preflight requires terminal evidence before retry advice', () => {
  for (const terminalReceiptPersisted of [undefined, false]) {
    assert.equal(normalizeReceiptTruth({ ...child, status: 'failed-preflight', ...(terminalReceiptPersisted === undefined ? {} : { terminalReceiptPersisted }) }).retryUnderlyingAction, false);
  }
  assert.equal(normalizeReceiptTruth({ ...child, status: 'failed-preflight', terminalReceiptPersisted: true }).retryUnderlyingAction, true);
});

test('canonical no-effect fields cannot override a child dispatch or live stage', () => {
  for (const status of ['host-started', 'preflight-complete', 'target-dispatched', 'returned', 'failed-effect-unknown']) {
    assert.equal(normalizeReceiptTruth({ ...child, ...noEffect, status }).retryUnderlyingAction, false);
  }
});

test('invalid normalized output does not become retry-safe when normalized again', () => {
  let result = { ...noEffect, reconciliationRequired: 'true' };
  for (let i = 0; i < 3; i++) {
    result = normalizeReceiptTruth(result);
    assert.equal(result.retryUnderlyingAction, false);
    assert.equal(result.reconciliationRequired, true);
  }
});

test('valid receipt semantics retain no-effect and verified-success boundaries', () => {
  assert.equal(classifyReceiptTruth(noEffect).requestReplaySafe, true);
  const result = classifyReceiptTruth({ ...noEffect, physicalEffectState: 'verified_committed',
    sideEffectMayHaveCommitted: true, postconditionVerified: true, intentPersisted: true, terminalReceiptPersisted: true });
  assert.equal(result.operationSucceeded, true);
  assert.equal(result.requestReplaySafe, false);
  assert.equal(result.receiptReplaySafe, true);
});

test('canonical health read excludes the external fallback and labels archived observations', async () => {
  const result = await callControlPolicyTool('evavo_control_health_policy');
  assert.equal(result.executionPolicy.externalDesktopCommanderEnabled, false);
  assert.equal(result.executionPolicy.externalRemoteDesktopFallbackAllowed, false);
  assert.ok(result.components.every(({ id }) => !/desktop.?commander/i.test(id)));
  assert.ok(result.evaluationOrder.every((id) => !/desktop.?commander/i.test(id)));
  assert.equal(result.observedState.historicalSnapshot, true);
  assert.equal(result.observedState.currentMachineAvailabilityAuthoritative, false);
  assert.equal(result.observedState.observedAt, '2026-09-05T03:11:42Z');
  assert.equal(result.policyOnly, true);
  assert.equal(result.liveRuntimeObserved, false);
  assert.equal(result.localExecutionVerified, false);
});

test('policy calls reject malformed and unexpected arguments', async () => {
  for (const args of [null, [], 'ready', { probe: true }]) {
    await assert.rejects(callControlPolicyTool('evavo_control_health_policy', args));
  }
  await assert.rejects(callControlPolicyTool('evavo_control_receipt_normalize', { receipt: noEffect, replay: true }));
});

// Real MCP stdio child-process tests. Only temporary copies of the production
// policy server/configs are used. No native workstation execution is attempted.
function rpc(t, calls, mutate = () => {}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'evavo-control-policy-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  for (const directory of ['mcp-server', 'config']) fs.mkdirSync(path.join(fixture, directory));
  for (const file of ['control-policy-core.mjs', 'control-policy-mcp.mjs', 'native-control-policy.mjs']) {
    const source = path.join(ROOT, 'mcp-server', file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(fixture, 'mcp-server', file));
  }
  for (const file of ['control-path-policy-v1.json', 'workstation-control-health-v1.json']) {
    fs.copyFileSync(path.join(ROOT, 'config', file), path.join(fixture, 'config', file));
  }
  mutate(fixture);
  const input = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    ...calls.map((params, i) => ({ jsonrpc: '2.0', id: i + 2, method: 'tools/call', params }))]
    .map((message) => JSON.stringify(message)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [path.join(fixture, 'mcp-server/control-policy-mcp.mjs')],
    { input, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const messages = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(messages.length, calls.length + 1);
  return messages.slice(1).map((message) => message.result);
}
function changeConfig(root, health, edit) {
  const file = path.join(root, 'config', health ? 'workstation-control-health-v1.json' : 'control-path-policy-v1.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(value);
  fs.writeFileSync(file, JSON.stringify(value));
}

for (const health of [false, true]) {
  const name = health ? 'evavo_control_health_policy' : 'evavo_control_path_policy';
  test(`${name} returns actual read-only MCP data without workstation proof`, (t) => {
    const [result] = rpc(t, [{ name, arguments: {} }]);
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.executionAuthority, false);
    assert.equal(result.structuredContent.liveRuntimeObserved, false);
    assert.equal(result.structuredContent.policyOnly, true);
  });
  for (const field of ['externalDesktopCommanderEnabled', 'externalRemoteDesktopFallbackAllowed']) {
    test(`${name} rejects drifted ${field} at serve time`, (t) => {
      const [result] = rpc(t, [{ name }], (root) => changeConfig(root, health, (value) => {
        const flags = health ? (value.executionPolicy ??= {}) : value.default;
        flags[field] = true;
      }));
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
    });
  }
  test(`${name} rejects a prohibited adapter even if it is renamed`, (t) => {
    const [result] = rpc(t, [{ name }], (root) => changeConfig(root, health, (value) => {
      (health ? value.components : value.routeOrder)[0].adapter = 'Remote Desktop Commander';
    }));
    assert.equal(result.isError, true);
  });
}

test('health MCP cannot return a static snapshot marked live', (t) => {
  const [result] = rpc(t, [{ name: 'evavo_control_health_policy' }], (root) => changeConfig(root, true,
    (value) => { value.observedState.historicalSnapshot = false; }));
  assert.equal(result.isError, true);
});

test('health evaluation order cannot revive an excluded fallback', (t) => {
  const [result] = rpc(t, [{ name: 'evavo_control_health_policy' }], (root) => changeConfig(root, true,
    (value) => { value.evaluationOrder.push('external-desktop-fallback'); }));
  assert.equal(result.isError, true);
});

test('MCP rejects malformed arguments instead of replacing them with empty facts', (t) => {
  const results = rpc(t, [
    { name: 'evavo_control_path_policy', arguments: null },
    { name: 'evavo_control_route_advice', arguments: [] },
    { name: 'evavo_control_route_advice', arguments: { backgroundCapable: 'true', physicalConsoleRequired: true } },
    { name: 'evavo_control_receipt_advice', arguments: { ...noEffect, reconciliationRequired: 'true' } },
  ]);
  for (const result of results) assert.equal(result.isError, true);
});

test('MCP live-child receipt cannot advise a second dispatch', (t) => {
  const [result] = rpc(t, [{ name: 'evavo_control_receipt_normalize', arguments: { receipt: { ...child, status: 'preflight-complete' } } }]);
  assert.equal(result.structuredContent.retryUnderlyingAction, false);
  assert.equal(result.structuredContent.reconciliationRequired, true);
  assert.equal(result.structuredContent.execute, false);
});

for (const field of ['reconciliationRequired', 'sideEffectMayHaveCommitted', 'postconditionVerified']) {
  test(`explicit ${field} warning cannot be erased by the preflight adapter`, () => {
    for (const nested of [false, true]) {
      const warning = nested ? { receipt: { [field]: true } } : { [field]: true };
      const result = normalizeReceiptTruth({ ...child, status: 'failed-preflight', terminalReceiptPersisted: true, ...warning });
      assert.equal(result.retryUnderlyingAction, false);
      assert.equal(result.reconciliationRequired, true);
    }
  });
}

test('agent and Windows instructions cannot revive the excluded fallback', () => {
  for (const file of ['AGENTS.md', '.github/instructions/windows-workstation-execution.instructions.md']) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(text, /Desktop Commander is excluded entirely, including as a fallback/);
    assert.doesNotMatch(text, /Remote Desktop Commander is external fallback interoperability only/);
    assert.doesNotMatch(text, /it may be used as a bounded fallback transport/);
  }
});

test('control runtime acceptance is wired into the existing MCP test command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp-server/package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /^npm run test:control-policy && /);
  assert.match(pkg.scripts['test:control-policy'], /control-policy-native-runtime\.test\.mjs/);
  for (const name of ['control-policy-core.mjs', 'control-policy-mcp.mjs', 'native-control-policy.mjs']) {
    assert.ok(pkg.scripts['check:local-runtimes'].includes(`node --check ${name}`));
  }
});
