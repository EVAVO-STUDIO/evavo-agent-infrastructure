import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'mcp-server', 'windows-physical-control-status-mcp.mjs'), 'utf8');

test('physical-control MCP exposes one read-only status tool', () => {
  assert.match(source, /evavo_windows_physical_control_status/);
  assert.match(source, /Get-EvavoWindowsPhysicalControlStatusCurrent\.ps1/);
  assert.match(source, /readOnlyHint: true/);
  assert.match(source, /destructiveHint: false/);
  assert.match(source, /taskPresenceIsNotLivenessProof/);
  assert.match(source, /scheduledTaskStartIsNotOutcomeProof/);
  assert.match(source, /routeHealthIsObservationNotExecutionAuthority/);
  assert.match(source, /mutationPerformed !== false/);
  assert.match(source, /providerMutationPerformed !== false/);
  assert.match(source, /taskMutationPerformed !== false/);
  assert.match(source, /processExecutionPerformed !== false/);
  assert.match(source, /networkPerformed !== false/);
  assert.match(source, /githubActionsRequired !== false/);
  assert.match(source, /selfHostedActionsRunnerRequired !== false/);
  assert.match(source, /vercelRequired !== false/);
  assert.match(source, /paidComputeRequired !== false/);
});

test('status MCP never exposes arbitrary command or caller path execution', () => {
  assert.match(source, /arbitraryCommandTextAccepted": false/);
  assert.match(source, /inlineCodeAccepted": false/);
  assert.doesNotMatch(source, /child_process.*exec\(/);
  assert.doesNotMatch(source, /shell:\s*true/);
  assert.doesNotMatch(source, /Start-ScheduledTask/);
});
