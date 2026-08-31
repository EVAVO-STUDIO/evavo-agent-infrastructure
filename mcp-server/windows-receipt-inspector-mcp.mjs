#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';

import { normalizeReceiptTruth } from './control-policy-core.mjs';

const SERVER_NAME = 'evavo-windows-receipt-inspector-mcp';
const SERVER_VERSION = '1.1.0';
const RECEIPT_ID = /^pschild-[0-9]{10,16}-[0-9]{1,12}-[0-9a-f]{12}$/u;
const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_DISCOVERY_FILES = 5000;

function receiptRoot() {
  const configured = String(process.env.EVAVO_POWERSHELL_CHILD_RECEIPT_ROOT || '').trim();
  return configured
    ? path.resolve(configured.replace(/^%LOCALAPPDATA%/iu, process.env.LOCALAPPDATA || ''))
    : path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'EVAVO', 'PowerShellChildReceipts');
}

function admittedReceiptPath(receiptId) {
  if (!RECEIPT_ID.test(receiptId)) throw new Error('receiptId is invalid');
  const root = receiptRoot();
  const candidate = path.join(root, `${receiptId}.json`);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('receipt path escaped managed root');
  return { root, candidate };
}

function readReceipt(receiptId) {
  const { candidate } = admittedReceiptPath(receiptId);
  let stat;
  try { stat = fs.lstatSync(candidate); } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        schemaVersion: 1,
        kind: 'evavo-windows-physical-receipt-status-v1',
        found: false,
        receiptId,
        retryUnderlyingAction: false,
        reconciliationRequired: true,
        reason: 'receipt-not-found-is-not-proof-that-the-physical-action-did-not-run',
        physicalPathsReturned: false,
      };
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_RECEIPT_BYTES) {
    throw new Error('receipt failed regular-file admission');
  }
  const document = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('receipt must be a JSON object');
  if (document.kind !== 'evavo-powershell-child-execution-receipt-v1' || document.invocationId !== receiptId) {
    throw new Error('receipt identity/kind mismatch');
  }
  const normalized = normalizeReceiptTruth(document);
  return {
    schemaVersion: 1,
    kind: 'evavo-windows-physical-receipt-status-v1',
    found: true,
    receiptId,
    sourceKind: document.kind,
    status: String(document.status || ''),
    startedAt: document.startedAt || null,
    completedAt: document.completedAt || null,
    targetName: document.targetName || null,
    targetSha256: document.targetSha256 || null,
    parametersSha256: document.parametersSha256 || null,
    executionAttempted: document.executionAttempted === true,
    targetDispatched: document.targetDispatched === true,
    terminalReceiptPersisted: document.terminalReceiptPersisted === true,
    receiptPersistence: document.receiptPersistence || null,
    writeRaisedButVerified: document.writeRaisedButVerified === true,
    exitCode: Number.isInteger(document.exitCode) ? document.exitCode : null,
    normalized,
    retryUnderlyingAction: normalized.retryUnderlyingAction === true,
    reconciliationRequired: normalized.reconciliationRequired === true,
    physicalPathsReturned: false,
    credentialValuesReturned: false,
    execute: false,
  };
}

function latestReceipt() {
  const root = receiptRoot();
  let names;
  try { names = fs.readdirSync(root); } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        schemaVersion: 1,
        kind: 'evavo-windows-latest-physical-receipt-v1',
        found: false,
        receiptId: null,
        retryUnderlyingAction: false,
        reconciliationRequired: false,
        physicalPathsReturned: false,
      };
    }
    throw error;
  }
  if (names.length > MAX_DISCOVERY_FILES) throw new Error('managed receipt directory exceeds bounded discovery limit');
  const candidates = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const receiptId = name.slice(0, -5);
    if (!RECEIPT_ID.test(receiptId)) continue;
    const { candidate } = admittedReceiptPath(receiptId);
    try {
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_RECEIPT_BYTES) continue;
      candidates.push({ receiptId, mtimeMs: stat.mtimeMs });
    } catch { /* ignore inadmissible candidate */ }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.receiptId.localeCompare(a.receiptId));
  for (const candidate of candidates) {
    try {
      const status = readReceipt(candidate.receiptId);
      if (status.found === true) {
        return {
          schemaVersion: 1,
          kind: 'evavo-windows-latest-physical-receipt-v1',
          found: true,
          receiptId: candidate.receiptId,
          status,
          retryUnderlyingAction: status.retryUnderlyingAction === true,
          reconciliationRequired: status.reconciliationRequired === true,
          physicalPathsReturned: false,
          credentialValuesReturned: false,
          execute: false,
        };
      }
    } catch { /* inspect next admitted candidate */ }
  }
  return {
    schemaVersion: 1,
    kind: 'evavo-windows-latest-physical-receipt-v1',
    found: false,
    receiptId: null,
    retryUnderlyingAction: false,
    reconciliationRequired: false,
    physicalPathsReturned: false,
  };
}

const TOOLS = Object.freeze([
  {
    name: 'evavo_windows_receipt_status',
    description: 'Read one managed PowerShell child physical receipt by its safe receipt ID and return normalized retry/reconciliation truth. Read-only; no caller-selected paths are accepted.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['receiptId'],
      properties: {
        receiptId: { type: 'string', pattern: '^pschild-[0-9]{10,16}-[0-9]{1,12}-[0-9a-f]{12}$' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: {
      'io.evavo/effects': ['read'],
      'io.evavo/arbitraryCommandTextAccepted': false,
      'io.evavo/callerSelectedPathAccepted': false,
    },
  },
  {
    name: 'evavo_windows_latest_receipt',
    description: 'Return the newest admissible managed PowerShell child physical receipt and normalized truth. Read-only; scans only the fixed managed receipt directory and returns no physical paths.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: {
      'io.evavo/effects': ['read'],
      'io.evavo/arbitraryCommandTextAccepted': false,
      'io.evavo/callerSelectedPathAccepted': false,
    },
  },
]);

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}
function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return; }
  const id = request.id;
  try {
    if (request.method === 'initialize') {
      send(id, {
        protocolVersion: request.params?.protocolVersion || '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: 'Read-only physical receipt inspection. Receipt absence is never interpreted as proof that an effect did not occur.',
      });
      return;
    }
    if (request.method === 'notifications/initialized') return;
    if (request.method === 'ping') { send(id, {}); return; }
    if (request.method === 'tools/list') { send(id, { tools: TOOLS }); return; }
    if (request.method === 'tools/call') {
      const name = String(request.params?.name || '');
      const args = request.params?.arguments || {};
      if (name === 'evavo_windows_receipt_status') {
        const extra = Object.keys(args).filter((key) => key !== 'receiptId');
        if (extra.length) throw new Error(`unsupported fields: ${extra.join(',')}`);
        const value = readReceipt(String(args.receiptId || ''));
        send(id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false });
        return;
      }
      if (name === 'evavo_windows_latest_receipt') {
        if (Object.keys(args).length) throw new Error('latest receipt does not accept arguments');
        const value = latestReceipt();
        send(id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false });
        return;
      }
      throw new Error(`unknown tool: ${name}`);
    }
    sendError(id, -32601, `method not found: ${String(request.method || '')}`);
  } catch (error) {
    if (request.method === 'tools/call') {
      const value = {
        schemaVersion: 1,
        kind: 'evavo-windows-physical-receipt-inspector-error-v1',
        ok: false,
        error: String(error?.message || error).slice(0, 2000),
        retryUnderlyingAction: false,
        reconciliationRequired: true,
        physicalPathsReturned: false,
        credentialValuesReturned: false,
      };
      send(id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: true });
    } else {
      sendError(id, -32000, String(error?.message || error).slice(0, 2000));
    }
  }
});