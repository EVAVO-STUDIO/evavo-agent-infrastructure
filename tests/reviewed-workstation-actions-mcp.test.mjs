import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'mcp-server', 'reviewed-workstation-actions-mcp.mjs'), 'utf8');
const localMcp = JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8'));
const unified = JSON.parse(fs.readFileSync(path.join(root, 'config', 'chatgpt-unified-capability-surface.v1.json'), 'utf8'));

test('reviewed workstation MCP exposes only fixed action selection plus receipt lookup', () => {
  for (const action of [
    'resident-status',
    'image-smoke-cel-animation',
    'image-smoke-90s-game-art',
    'image-smoke-realistic',
  ]) assert.match(source, new RegExp(`"${action}"`));

  assert.match(source, /name: "evavo_reviewed_workstation_actions"/);
  assert.match(source, /name: "evavo_reviewed_workstation_submit_and_wait"/);
  assert.match(source, /name: "evavo_reviewed_workstation_job_status"/);
  assert.doesNotMatch(source, /callerScript/);
  assert.doesNotMatch(source, /manifestPath/);
  assert.doesNotMatch(source, /outputPath/);
});

test('request truth is delegated to Local Compute reviewed action author', () => {
  assert.match(source, /evavo-reviewed-workstation-actions\.exe/);
  assert.match(source, /\["plan", "--action", action\]/);
  assert.match(source, /plan\.kind !== "evavo-reviewed-workstation-action-plan-v3"/);
  assert.match(source, /plan\.fixedActionMapping !== true/);
  assert.match(source, /plan\.callerSelectedScript !== false/);
  assert.match(source, /plan\.callerSelectedArguments !== false/);
  assert.match(source, /envelope\.jobId !== plan\.request\?\.requestId/);
  assert.match(source, /envelope\.request\?\.requestId !== envelope\.jobId/);
});

test('publisher sends exact authored title and body and does not mint a replacement request ID', () => {
  assert.match(source, /`title=\$\{exactPlan\.title\}`/);
  assert.match(source, /`body=\$\{exactPlan\.body\}`/);
  assert.doesNotMatch(source, /randomUUID/);
  assert.doesNotMatch(source, /requestId = `mcp-/);
  assert.match(source, /safeAutomaticReplay: false/);
});

test('heavy image jobs have a dedicated wait bound without widening generic fabric execution', () => {
  assert.match(source, /MAX_WAIT_SECONDS = 3900/);
  assert.match(source, /DEFAULT_WAIT_SECONDS = 3600/);
  const generic = fs.readFileSync(path.join(root, 'mcp-server', 'local-agent-mcp-v2.mjs'), 'utf8');
  assert.match(generic, /request\.timeoutSeconds > 900/);
  assert.match(generic, /maximum: 1200/);
});

test('reviewed workstation MCP is registered in local and unified surfaces', () => {
  const local = localMcp.mcpServers['evavo-reviewed-workstation-actions'];
  assert.ok(local);
  assert.deepEqual(local.args, ['./mcp-server/reviewed-workstation-actions-mcp.mjs']);
  assert.equal(local.env.EVAVO_REVIEWED_WORKSTATION_ACTIONS_ROLE, 'fixed-reviewed-actions-only');

  const server = unified.servers.find((item) => item.id === 'evavo-reviewed-workstation-actions');
  assert.ok(server);
  assert.equal(server.directExpose, true);
  assert.equal(server.authority, 'EVAVO-STUDIO/evavo-local-compute');
  assert.deepEqual(server.arguments, ['mcp-server/reviewed-workstation-actions-mcp.mjs']);
});

test('reviewed image route explicitly stays out of Local Storage 4329', () => {
  assert.match(source, /localStorage4329UsedForImageExecution: false/);
  assert.match(source, /callerMaySupplyScript: false/);
  assert.match(source, /callerMaySupplyArguments: false/);
});
