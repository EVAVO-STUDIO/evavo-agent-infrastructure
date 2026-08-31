import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { win32 as path } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';

const SERVER_NAME = 'evavo-gmail-trash-evacuation-mcp';
const SERVER_VERSION = '1.2.0';
const STORAGE_REPOSITORY = process.env.EVAVO_STORAGE_ROOT || 'C:\\GitRepos\\evavo-storage';
const OPERATIONS_CORE_REPOSITORY = process.env.EVAVO_OPERATIONS_CORE_ROOT || 'C:\\GitRepos\\evavo-operations-core';
const INSTALLER = path.join(STORAGE_REPOSITORY, 'scripts', 'Install-GmailTrashEvacuationTaskCurrent.ps1');
const RUNNER = path.join(STORAGE_REPOSITORY, 'scripts', 'Invoke-GmailTrashEvacuationCurrent.ps1');
const FINANCE_ARCHIVE_AUTOMATION = path.join(OPERATIONS_CORE_REPOSITORY, 'scripts', 'Invoke-EvavoFinanceArchiveEvidenceAutomation.ps1');
const SHA256 = /^[0-9a-f]{64}$/;

const TOOLS = Object.freeze([
  {
    name: 'evavo_gmail_trash_evacuation_doctor',
    description: 'Verify the fixed Gmail Trash evacuation and Operations Core archive-evidence consumer surfaces. Performs no provider mutation.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { 'io.evavo/effects': ['read'], 'io.evavo/arbitraryCommandTextAccepted': false },
  },
  {
    name: 'evavo_gmail_trash_evacuation_activate',
    description: 'Install or refresh the finance-evidence consumer and fixed resumable Gmail Trash evacuation task using an externally authorized standing provider policy. This tool cannot create or self-approve permanent-delete authority.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['policyPath', 'policySha256'],
      properties: {
        policyPath: { type: 'string', minLength: 1, maxLength: 4096 },
        policySha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
        startNow: { type: 'boolean', default: true },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    _meta: { 'io.evavo/effects': ['execute', 'write', 'network', 'provider-mutation'], 'io.evavo/arbitraryCommandTextAccepted': false },
  },
  {
    name: 'evavo_gmail_trash_evacuation_cycle',
    description: 'Run one bounded resumable Gmail Trash evacuation cycle using the already-pinned standing provider policy. Business records cannot be provider-deleted until Operations Core has durably accepted their exact verified archive handoffs.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    _meta: { 'io.evavo/effects': ['execute', 'write', 'network', 'provider-mutation'], 'io.evavo/arbitraryCommandTextAccepted': false },
  },
]);

function runPowerShell(script, args = [], timeout = 7_500_000) {
  if (!existsSync(script)) throw new Error(`fixed automation helper is missing: ${path.basename(script)}`);
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
    encoding: 'utf8', windowsHide: true, shell: false, timeout, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const text = String(result.stdout || result.stderr || '').trim();
  let receipt;
  try { receipt = JSON.parse(text); } catch { throw new Error(`automation helper returned invalid JSON: ${path.basename(script)}`); }
  if (result.status !== 0 || receipt?.ok !== true) throw new Error(`automation helper did not report success: ${path.basename(script)}`);
  return receipt;
}

function doctor() {
  const installerPresent = existsSync(INSTALLER);
  const runnerPresent = existsSync(RUNNER);
  const financeConsumerPresent = existsSync(FINANCE_ARCHIVE_AUTOMATION);
  return {
    schemaVersion: 1,
    kind: 'evavo-gmail-trash-evacuation-mcp-doctor-v1',
    ok: installerPresent && runnerPresent && financeConsumerPresent,
    server: SERVER_NAME,
    version: SERVER_VERSION,
    installerPresent,
    runnerPresent,
    financeArchiveEvidenceConsumerPresent: financeConsumerPresent,
    archiveBeforeProviderDeletionRequired: true,
    financeAcceptanceRequiredForBusinessRecords: true,
    standingProviderPolicyRequired: true,
    externalStandingAuthorizationRequired: true,
    selfApprovalAllowed: false,
    localArchiveRetentionUnaffected: true,
    arbitraryCommandTextAccepted: false,
    callerSelectedExecutable: false,
    credentialValuesReturned: false,
  };
}

function activate(args) {
  const policyPath = String(args.policyPath || '').trim();
  const policySha256 = String(args.policySha256 || '').trim().toLowerCase();
  if (!policyPath || policyPath.length > 4096 || !SHA256.test(policySha256)) throw new Error('valid externally-authorized policyPath and policySha256 are required');

  // Install the prerequisite Operations Core consumer first. It reuses the
  // already-DPAPI-protected finance receiver secrets and does not create any
  // accounting, tax or payment posting authority.
  const financeArgs = ['-Mode', 'Install', '-AllowTaskMutation', '-AllowNetwork', '-NoThrow', '-AsJson'];
  if (args.startNow !== false) financeArgs.push('-StartNow');
  const finance = runPowerShell(FINANCE_ARCHIVE_AUTOMATION, financeArgs, 180_000);
  if (
    finance.kind !== 'evavo-finance-archive-evidence-windows-automation-receipt-v1'
    || finance.state !== 'installed'
    || finance.safety?.providerMutations !== 0
    || finance.safety?.archiveMutations !== 0
    || finance.safety?.accountingPosts !== 0
    || finance.safety?.taxActions !== 0
  ) {
    throw new Error('Operations Core archive-evidence consumer failed admission');
  }

  const argv = ['-PolicyPath', policyPath, '-PolicySha256', policySha256];
  if (args.startNow !== false) argv.push('-StartNow');
  const receipt = runPowerShell(INSTALLER, argv, 180_000);
  if (
    receipt.kind !== 'evavo-gmail-trash-evacuation-current-installation-v1'
    || receipt.taskExact !== true
    || receipt.policyPinned !== true
    || receipt.authorizationCreatedByInstaller !== false
    || String(receipt.policySha256 || '').toLowerCase() !== policySha256
  ) {
    throw new Error('Gmail evacuation installation receipt failed admission');
  }
  return {
    ...receipt,
    financeArchiveEvidenceConsumerInstalled: true,
    financeArchiveEvidenceConsumerReceipt: {
      kind: finance.kind,
      state: finance.state,
      taskCount: Array.isArray(finance.tasks) ? finance.tasks.length : 0,
    },
    invokedThrough: SERVER_NAME,
  };
}

function cycle() {
  const receipt = runPowerShell(RUNNER, [], 7_500_000);
  if (
    receipt.kind !== 'evavo-gmail-trash-evacuation-current-receipt-v1'
    || receipt.localArchiveRetentionUnaffected !== true
  ) {
    throw new Error('Gmail evacuation cycle receipt failed admission');
  }
  return { ...receipt, invokedThrough: SERVER_NAME };
}

async function callTool(name, raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('arguments must be an object');
  if (name === 'evavo_gmail_trash_evacuation_doctor') {
    if (Object.keys(raw).length) throw new Error('doctor accepts no arguments');
    return doctor();
  }
  if (name === 'evavo_gmail_trash_evacuation_activate') {
    const extra = Object.keys(raw).filter((key) => !['policyPath', 'policySha256', 'startNow'].includes(key));
    if (extra.length) throw new Error(`unsupported activation arguments: ${extra.join(',')}`);
    return activate(raw);
  }
  if (name === 'evavo_gmail_trash_evacuation_cycle') {
    if (Object.keys(raw).length) throw new Error('cycle accepts no arguments');
    return cycle();
  }
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
