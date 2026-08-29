import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  callControlPolicyTool,
  chooseControlRoute,
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
  ]);
});

test('route advice always prefers background-capable routes over GUI/physical flags', () => {
  assert.equal(chooseControlRoute({ typedApiCapable: true, backgroundCapable: true, physicalConsoleRequired: true }).routeClass, 'typed-api-or-connector');
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

test('policy tools return canonical sibling contracts', async () => {
  const policy = await callControlPolicyTool('evavo_control_path_policy', {});
  const health = await callControlPolicyTool('evavo_control_health_policy', {});
  assert.equal(policy.kind, 'evavo-control-path-policy-v1');
  assert.equal(policy.executionAuthority, false);
  assert.equal(health.kind, 'evavo-workstation-control-health-v1');
  assert.equal(health.executionAuthority, false);
});

test('central MCP bundle registers policy and hardware gateway without embedded gateway token', () => {
  const text = fs.readFileSync('.mcp.json', 'utf8');
  const config = JSON.parse(text);
  assert.equal(config.mcpServers['evavo-control-policy'].args[0], './mcp-server/control-policy-mcp.mjs');
  assert.match(config.mcpServers['evavo-hardware-gateway'].args.join(' '), /start-mcp\.ps1/u);
  assert.doesNotMatch(text, /EVAVO_GATEWAY_TOKEN/u);
});
