import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../mcp-server/windows-workstation-operator-compatibility.mjs', import.meta.url),
  'utf8',
);

test('compatibility adapter launches only the canonical local-compute MCP server', () => {
  assert.match(source, /windows-workstation-operator-mcp\.py/);
  assert.match(source, /windows_workstation_operator\.py/);
  assert.match(source, /EVAVO_LOCAL_COMPUTE_ROOT/);
  assert.match(source, /EVAVO_GIT_REPOS_ROOT/);
  assert.match(source, /PYTHONDONTWRITEBYTECODE/);
});

test('compatibility adapter does not restore a raw shell or network bridge', () => {
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /shell: true/);
  assert.doesNotMatch(source, /exec\(/);
  assert.doesNotMatch(source, /powershell.*-Command/i);
  assert.doesNotMatch(source, /bash.*-c/i);
  assert.doesNotMatch(source, /localhost:5000/);
  assert.doesNotMatch(source, /CONTROL_PLANE_TUNNEL_ID/);
  assert.doesNotMatch(source, /cloudflared/i);
});

test('compatibility adapter keeps credentials and physical paths out of errors', () => {
  assert.match(source, /credentialValuesReturned: false/);
  assert.match(source, /physicalPathsReturned: false/);
});
