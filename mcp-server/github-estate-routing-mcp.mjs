#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { assert, exactKeys, isRecord, parseStrictJson, text } from '../scripts/github-estate-routing-common.mjs';
import {
  callGitHubEstateRoutingTool,
  githubEstateRoutingMcpContract,
  githubEstateRoutingTools,
} from './github-estate-routing-core.mjs';

export {
  callGitHubEstateRoutingTool,
  githubEstateRoutingMcpContract,
  githubEstateRoutingTools,
} from './github-estate-routing-core.mjs';

const SERVER_NAME = githubEstateRoutingMcpContract.serverName;
const SERVER_VERSION = githubEstateRoutingMcpContract.serverVersion;
const PROTOCOL_VERSION = '2025-06-18';
const MESSAGE_LIMIT = 1024 * 1024;

let initialized = false;
let buffer = '';
let chain = Promise.resolve();
let closed = false;
const send = (message) => { if (!closed) process.stdout.write(`${JSON.stringify(message)}\n`); };
const response = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(raw) {
  exactKeys(raw, ['jsonrpc', 'method'], ['id', 'params'], 'EVAVO_GITHUB_ESTATE_MCP_REQUEST');
  assert(raw.jsonrpc === '2.0', 'EVAVO_GITHUB_ESTATE_MCP_JSONRPC');
  const method = text(raw.method, 'EVAVO_GITHUB_ESTATE_MCP_METHOD', { maximum: 128 });
  const notification = !Object.hasOwn(raw, 'id');
  const id = notification ? null : raw.id;
  if (!notification) assert(typeof id === 'string' || Number.isSafeInteger(id), 'EVAVO_GITHUB_ESTATE_MCP_ID');
  if (Object.hasOwn(raw, 'params')) assert(isRecord(raw.params), 'EVAVO_GITHUB_ESTATE_MCP_PARAMS');
  if (method === 'initialize') {
    if (notification) return;
    initialized = true;
    const requested = raw.params?.protocolVersion;
    send(response(id, {
      protocolVersion: typeof requested === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(requested) ? requested : PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: 'Read-only verification and deterministic planning from fixed signed GitHub estate evidence. No caller-selected path, command, mutation, publication or credential access is exposed.',
    }));
    return;
  }
  if (method === 'notifications/initialized') { initialized = true; return; }
  if (method === 'notifications/cancelled') return;
  if (method === 'ping') { if (!notification) send(response(id, {})); return; }
  if (!initialized) { if (!notification) send(rpcError(id, -32002, 'MCP server has not been initialized.')); return; }
  if (method === 'tools/list') { if (!notification) send(response(id, { tools: githubEstateRoutingTools })); return; }
  if (method === 'tools/call') {
    if (notification) return;
    const params = raw.params ?? {};
    exactKeys(params, ['name'], ['arguments'], 'EVAVO_GITHUB_ESTATE_MCP_TOOL_CALL');
    try {
      send(response(id, await callGitHubEstateRoutingTool(params.name, params.arguments ?? {})));
    } catch (error) {
      send(response(id, { content: [{ type: 'text', text: `${error instanceof Error ? error.message : String(error)}\n` }], isError: true }));
    }
    return;
  }
  if (!notification) send(rpcError(id, -32601, `Method not found: ${method}`));
}

function processLine(raw) {
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  if (!line.trim()) return;
  if (Buffer.byteLength(line, 'utf8') > MESSAGE_LIMIT) { send(rpcError(null, -32600, 'MCP request exceeds the message limit.')); return; }
  let message;
  try { message = parseStrictJson(line, MESSAGE_LIMIT); }
  catch (error) { send(rpcError(null, -32700, error instanceof Error ? error.message : 'Invalid JSON.')); return; }
  chain = chain.then(() => handle(message)).catch((error) => {
    send(rpcError(isRecord(message) && Object.hasOwn(message, 'id') ? message.id : null, -32602, error instanceof Error ? error.message : String(error)));
  });
}

export function startGitHubEstateRoutingMcp() {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer, 'utf8') > MESSAGE_LIMIT && !buffer.includes('\n')) {
      send(rpcError(null, -32600, 'MCP input buffer exceeds the message limit.'));
      buffer = '';
      return;
    }
    for (;;) {
      const delimiter = buffer.indexOf('\n');
      if (delimiter < 0) break;
      const line = buffer.slice(0, delimiter);
      buffer = buffer.slice(delimiter + 1);
      processLine(line);
    }
  });
  process.stdin.on('end', () => {
    if (buffer.trim()) processLine(buffer);
    chain.finally(() => { closed = true; });
  });
  process.stdin.on('error', () => { process.exitCode = 1; });
  process.on('SIGINT', () => { closed = true; process.exit(0); });
  process.on('SIGTERM', () => { closed = true; process.exit(0); });
}

const entrypoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (entrypoint) startGitHubEstateRoutingMcp();
