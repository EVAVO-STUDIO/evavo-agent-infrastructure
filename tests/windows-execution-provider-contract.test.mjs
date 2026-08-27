import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Windows execution has one canonical provider', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'config', 'windows-execution-provider-v1.json'), 'utf8'));
  assert.equal(contract.provider.repository, 'EVAVO-STUDIO/evavo-local-compute');
  assert.equal(contract.legacyWindowsChatShim.effectfulExecutionAuthority, false);
  assert.ok(contract.prohibited.includes('raw public Windows shell'));
  assert.ok(contract.prohibited.includes('parallel REST executor'));
  assert.ok(contract.prohibited.includes('GitHub Actions workstation execution'));
});

test('legacy Windows chat server remains a compatibility or diagnostic shim', () => {
  const shim = fs.readFileSync(path.join(root, 'mcp-server', 'windows-chat-execution-mcp.mjs'), 'utf8').toLowerCase();
  assert.match(shim, /retir|compatib|diagnostic|readiness/);
  assert.doesNotMatch(shim, /child_process[^\n]*(exec|spawn)\s*\(/);
});
