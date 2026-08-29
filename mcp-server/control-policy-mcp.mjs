#!/usr/bin/env node

import process from 'node:process';
import {
  callControlPolicyTool,
  controlPolicyMcpContract,
  controlPolicyTools,
} from './control-policy-core.mjs';

const PROTOCOL_VERSION = '2025-06-18';
const MESSAGE_LIMIT = 256 * 1024;
let initialized = false;
let buffer = '';
let chain = Promise.resolve();
let closed = false;

const send = (message) => { if (!closed) process.stdout.write(`${JSON.stringify(message)}\n`); };
const response = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }

async function handle(raw) {
  if (!object(raw) || raw.jsonrpc !== '2.0' || typeof raw.method !== 'string') throw new Error('invalid MCP request');
  const notification = !Object.hasOwn(raw, 'id');
  const id = notification ? null : raw.id;
  if (raw.method === 'initialize') {
    if (notification) return;
    initialized = true;
    const requested = raw.params?.protocolVersion;
    send(response(id, {
      protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: controlPolicyMcpContract.serverName, version: controlPolicyMcpContract.serverVersion },
      instructions: 'Read-only least-disruptive workstation control planning and health policy. This server cannot execute, mutate, send HID, control Comet, change network state or approve recovery.',
    }));
    return;
  }
  if (raw.method === 'notifications/initialized') { initialized = true; return; }
  if (raw.method === 'notifications/cancelled') return;
  if (raw.method === 'ping') { if (!notification) send(response(id, {})); return; }
  if (!initialized) { if (!notification) send(rpcError(id, -32002, 'MCP server has not been initialized.')); return; }
  if (raw.method === 'tools/list') { if (!notification) send(response(id, { tools: controlPolicyTools })); return; }
  if (raw.method === 'tools/call') {
    if (notification) return;
    const params = object(raw.params) ? raw.params : {};
    if (typeof params.name !== 'string') { send(rpcError(id, -32602, 'tool name is required')); return; }
    try {
      const result = await callControlPolicyTool(params.name, object(params.arguments) ? params.arguments : {});
      send(response(id, { content: [{ type: 'text', text: `${JSON.stringify(result)}\n` }], structuredContent: result }));
    } catch (error) {
      send(response(id, { content: [{ type: 'text', text: `${error instanceof Error ? error.message : String(error)}\n` }], isError: true }));
    }
    return;
  }
  if (!notification) send(rpcError(id, -32601, `Method not found: ${raw.method}`));
}

function processLine(raw) {
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  if (!line.trim()) return;
  if (Buffer.byteLength(line, 'utf8') > MESSAGE_LIMIT) { send(rpcError(null, -32600, 'MCP request exceeds message limit.')); return; }
  let message;
  try { message = JSON.parse(line); }
  catch { send(rpcError(null, -32700, 'Invalid JSON.')); return; }
  chain = chain.then(() => handle(message)).catch((error) => send(rpcError(message?.id ?? null, -32602, error instanceof Error ? error.message : String(error))));
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  if (Buffer.byteLength(buffer, 'utf8') > MESSAGE_LIMIT && !buffer.includes('\n')) {
    send(rpcError(null, -32600, 'MCP input buffer exceeds message limit.'));
    buffer = '';
    return;
  }
  for (;;) {
    const delimiter = buffer.indexOf('\n');
    if (delimiter < 0) break;
    processLine(buffer.slice(0, delimiter));
    buffer = buffer.slice(delimiter + 1);
  }
});
process.stdin.on('end', () => { if (buffer.trim()) processLine(buffer); chain.finally(() => { closed = true; }); });
process.stdin.on('error', () => { process.exitCode = 1; });
process.on('SIGINT', () => { closed = true; process.exit(0); });
process.on('SIGTERM', () => { closed = true; process.exit(0); });
