import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { win32 as path } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';

const SERVER_NAME = 'evavo-gmail-trash-evacuation-mcp';
const SERVER_VERSION = '1.0.0';
const STORAGE_REPOSITORY = process.env.EVAVO_STORAGE_ROOT || 'C:\\GitRepos\\evavo-storage';
const INSTALLER = path.join(STORAGE_REPOSITORY, 'scripts', 'Install-GmailTrashEvacuationTaskCurrent.ps1');
const RUNNER = path.join(STORAGE_REPOSITORY, 'scripts', 'Invoke-GmailTrashEvacuationCurrent.ps1');

const TOOLS = Object.freeze([
  {
    name: 'evavo_gmail_trash_evacuation_doctor',
    description: 'Verify that the fixed Gmail Trash evacuation installer and cycle runner are present. Performs no provider mutation.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { 'io.evavo/effects': ['read'], 'io.evavo/arbitraryCommandTextAccepted': false },
  },
  {
    name: 'evavo_gmail_trash_evacuation_activate',
    description: 'Install or refresh the fixed resumable Gmail Trash evacuation scheduled task. The task can permanently delete Gmail messages only under the pre-existing sealed standing provider-evacuation policy after complete archive verification.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    _meta: { 'io.evavo/effects': ['execute', 'write', 'network', 'provider-mutation'], 'io.evavo/arbitraryCommandTextAccepted': false },
  },
  {
    name: 'evavo_gmail_trash_evacuation_cycle',
    description: 'Run one bounded resumable Gmail Trash evacuation cycle using the already-pinned standing provider policy. Inventory/archive phases are non-destructive; provider deletion occurs only after exact archive verification and policy admission.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    _meta: { 'io.evavo/effects': ['execute', 'write', 'network', 'provider-mutation'], 'io.evavo/arbitraryCommandTextAccepted': false },
  },
]);

function runPowerShell(script, args = [], timeout = 7_500_000) {
  if (!existsSync(script)) throw new Error(`fixed Gmail evacuation helper is missing: ${path.basename(script)}`);
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
    encoding: 'utf8', windowsHide: true, shell: false, timeout, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const text = String(result.stdout || result.stderr || '').trim();
  let receipt;
  try { receipt = JSON.parse(text); } catch { throw new Error('Gmail evacuation helper returned invalid JSON'); }
  if (result.status !== 0 || receipt?.ok !== true) throw new Error('Gmail evacuation helper did not report success');
  return receipt;
}

function doctor() {
  return {
    schemaVersion: 1,
    kind: 'evavo-gmail-trash-evacuation-mcp-doctor-v1',
    ok: existsSync(INSTALLER) && existsSync(RUNNER),
    server: SERVER_NAME,
    version: SERVER_VERSION,
    installerPresent: existsSync(INSTALLER),
    runnerPresent: existsSync(RUNNER),
    archiveBeforeProviderDeletionRequired: true,
    standingProviderPolicyRequired: true,
    localArchiveRetentionUnaffected: true,
    arbitraryCommandTextAccepted: false,
    callerSelectedPathAccepted: false,
    credentialValuesReturned: false,
  };
}

function activate() {
  const receipt = runPowerShell(INSTALLER, ['-StartNow'], 180_000);
  if (receipt.kind !== 'evavo-gmail-trash-evacuation-installation-v1' || receipt.taskExact !== true || receipt.policyPinned !== true) {
    throw new Error('Gmail evacuation installation receipt failed admission');
  }
  return { ...receipt, invokedThrough: SERVER_NAME };
}

function cycle() {
  const receipt = runPowerShell(RUNNER, [], 7_500_000);
  if (receipt.kind !== 'evavo-gmail-trash-evacuation-current-receipt-v1' || receipt.localArchiveRetentionUnaffected !== true) {
    throw new Error('Gmail evacuation cycle receipt failed admission');
  }
  return { ...receipt, invokedThrough: SERVER_NAME };
}

async function callTool(name, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error('tool accepts no arguments');
  if (name === 'evavo_gmail_trash_evacuation_doctor') return doctor();
  if (name === 'evavo_gmail_trash_evacuation_activate') return activate();
  if (name === 'evavo_gmail_trash_evacuation_cycle') return cycle();
  throw new Error(`unknown tool: ${name}`);
}

function send(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function sendError(id, code, message) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`); }

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return; }
  const id = request.id;
  try {
    if (request.method === 'initialize') {
      send(id, { protocolVersion: request.params?.protocolVersion || '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } });
    } else if (request.method === 'tools/list') {
      send(id, { tools: TOOLS });
    } else if (request.method === 'tools/call') {
      const value = await callTool(String(request.params?.name || ''), request.params?.arguments || {});
      send(id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: false });
    } else if (request.method === 'notifications/initialized') {
      return;
    } else if (request.method === 'ping') {
      send(id, {});
    } else {
      sendError(id, -32601, `Method not found: ${String(request.method)}`);
    }
  } catch (error) {
    sendError(id, -32000, error instanceof Error ? error.message : String(error));
  }
});
