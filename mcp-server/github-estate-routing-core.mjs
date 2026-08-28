#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  assert,
  canonicalInstant,
  exactKeys,
  isRecord,
  parseStrictJson,
  sha256Bytes,
  text,
} from '../scripts/github-estate-routing-common.mjs';

const SERVER_NAME = 'evavo-github-estate-routing';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2025-06-18';
const MESSAGE_LIMIT = 1024 * 1024;
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const CLIENTS = Object.freeze(['chatgpt-pro', 'claude-code', 'codex', 'api-agent']);
const CLIENT_SET = new Set(CLIENTS);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const READINESS = 'evavo_github_estate_routing_readiness';
const STATUS = 'evavo_github_estate_routing_status';
const PLAN = 'evavo_github_estate_routing_plan';

function fail(code) {
  throw new Error(code);
}

function absoluteEnv(name, fallback = null) {
  const raw = process.env[name];
  if (!raw) return fallback === null ? null : path.resolve(fallback);
  if (typeof raw !== 'string' || raw.length > 8192 || !path.isAbsolute(raw)) {
    fail(`EVAVO_GITHUB_ESTATE_MCP_ENV_${name}`);
  }
  return path.resolve(raw);
}

function timeoutMs() {
  const raw = process.env.EVAVO_GITHUB_ESTATE_ROUTING_TIMEOUT_MS;
  if (!raw) return 30_000;
  if (!/^\d+$/u.test(raw)) fail('EVAVO_GITHUB_ESTATE_MCP_TIMEOUT');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1000 || value > 120_000) {
    fail('EVAVO_GITHUB_ESTATE_MCP_TIMEOUT');
  }
  return value;
}

const config = Object.freeze({
  snapshotRoot: absoluteEnv('EVAVO_GITHUB_ESTATE_SNAPSHOT_ROOT'),
  trustBundle: absoluteEnv('EVAVO_GITHUB_ESTATE_TRUST_BUNDLE'),
  routeCli: absoluteEnv(
    'EVAVO_GITHUB_ESTATE_ROUTING_CLI',
    path.join(ROOT, 'scripts', 'route-github-estate-snapshot.mjs'),
  ),
  routingConfig: absoluteEnv(
    'EVAVO_GITHUB_ESTATE_ROUTING_CONFIG',
    path.join(ROOT, 'config', 'agent-capability-routing-v1.json'),
  ),
  timeoutMs: timeoutMs(),
});

async function inspectFile(filePath) {
  if (filePath === null) return Object.freeze({ status: 'unconfigured' });
  try {
    const state = await fsp.lstat(filePath);
    if (state.isSymbolicLink()) return Object.freeze({ status: 'invalid-symlink' });
    if (!state.isFile() || state.size < 1) return Object.freeze({ status: 'invalid-file' });
    const bytes = await fsp.readFile(filePath);
    return Object.freeze({ status: 'ready', bytes: bytes.length, sha256: sha256Bytes(bytes) });
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ status: 'missing' });
    fail('EVAVO_GITHUB_ESTATE_MCP_FILE_INSPECTION');
  }
}

async function inspectRoot(root) {
  if (root === null) return Object.freeze({ status: 'unconfigured', candidateCount: 0 });
  try {
    const state = await fsp.lstat(root);
    if (state.isSymbolicLink()) return Object.freeze({ status: 'invalid-symlink', candidateCount: 0 });
    if (!state.isDirectory()) return Object.freeze({ status: 'invalid-directory', candidateCount: 0 });
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const candidateCount = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).length;
    return Object.freeze({ status: candidateCount > 0 ? 'ready' : 'empty', candidateCount });
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ status: 'missing', candidateCount: 0 });
    fail('EVAVO_GITHUB_ESTATE_MCP_ROOT_INSPECTION');
  }
}

function authority() {
  return Object.freeze({
    execution: false,
    sourceMutation: false,
    repositoryWrite: false,
    publication: false,
    providerMutation: false,
    credentialAccess: false,
    genericCommandExecution: false,
  });
}

async function readiness() {
  const [snapshotRoot, trustBundle, routeCli, routingConfig] = await Promise.all([
    inspectRoot(config.snapshotRoot),
    inspectFile(config.trustBundle),
    inspectFile(config.routeCli),
    inspectFile(config.routingConfig),
  ]);
  const configured = [snapshotRoot, trustBundle, routeCli, routingConfig]
    .every((entry) => entry.status === 'ready');
  return Object.freeze({
    schemaVersion: 1,
    kind: 'evavo-github-estate-routing-readiness-v1',
    status: configured ? 'configured' : 'blocked',
    checks: Object.freeze({ snapshotRoot, trustBundle, routeCli, routingConfig }),
    supportedClients: CLIENTS,
    runtimeVerificationPerformed: false,
    mayClaimEvidenceValid: false,
    authority: authority(),
  });
}

function childEnvironment() {
  const output = {};
  for (const name of [
    'SystemRoot', 'WINDIR', 'COMSPEC', 'HOME', 'USERPROFILE', 'LOCALAPPDATA',
    'APPDATA', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
  ]) {
    if (typeof process.env[name] === 'string') output[name] = process.env[name];
  }
  return output;
}

function append(current, chunk, code) {
  const next = current + chunk;
  if (Buffer.byteLength(next, 'utf8') > OUTPUT_LIMIT) fail(code);
  return next;
}

function runRoute(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      cwd: ROOT,
      env: childEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('EVAVO_GITHUB_ESTATE_MCP_ROUTE_TIMEOUT'));
    }, config.timeoutMs);
    child.once('error', () => finish(new Error('EVAVO_GITHUB_ESTATE_MCP_ROUTE_SPAWN_FAILED')));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      try { stdout = append(stdout, chunk, 'EVAVO_GITHUB_ESTATE_MCP_STDOUT_LIMIT'); }
      catch (error) { child.kill('SIGKILL'); finish(error); }
    });
    child.stderr.on('data', (chunk) => {
      try { stderr = append(stderr, chunk, 'EVAVO_GITHUB_ESTATE_MCP_STDERR_LIMIT'); }
      catch (error) { child.kill('SIGKILL'); finish(error); }
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      if (code !== 0 || signal !== null) {
        const bytes = Buffer.from(stderr, 'utf8');
        finish(new Error(
          `EVAVO_GITHUB_ESTATE_MCP_ROUTE_FAILED:exit=${String(code)};signal=${String(signal)};stderrBytes=${String(bytes.length)};stderrSha256=${sha256Bytes(bytes)}`,
        ));
        return;
      }
      if (stderr.trim()) return finish(new Error('EVAVO_GITHUB_ESTATE_MCP_ROUTE_STDERR'));
      try { finish(null, parseStrictJson(stdout.trim(), OUTPUT_LIMIT)); }
      catch (error) { finish(error); }
    });
  });
}

function selectedClient(value) {
  const client = text(value, 'EVAVO_GITHUB_ESTATE_MCP_CLIENT', { maximum: 64 });
  assert(CLIENT_SET.has(client), 'EVAVO_GITHUB_ESTATE_MCP_CLIENT_UNKNOWN');
  return client;
}

function validateStatus(document, client) {
  exactKeys(document, ['schemaVersion', 'kind', 'capturedAt', 'client', 'requestedCapabilities', 'evidence'], [], 'EVAVO_GITHUB_ESTATE_MCP_STATUS_DOCUMENT');
  assert(document.schemaVersion === 1, 'EVAVO_GITHUB_ESTATE_MCP_STATUS_SCHEMA');
  assert(document.kind === 'evavo-agent-capability-status-v1', 'EVAVO_GITHUB_ESTATE_MCP_STATUS_KIND');
  assert(document.client === client, 'EVAVO_GITHUB_ESTATE_MCP_STATUS_CLIENT');
  canonicalInstant(document.capturedAt, 'EVAVO_GITHUB_ESTATE_MCP_STATUS_CAPTURED_AT');
  assert(Array.isArray(document.requestedCapabilities), 'EVAVO_GITHUB_ESTATE_MCP_STATUS_CAPABILITIES');
  assert(Array.isArray(document.evidence), 'EVAVO_GITHUB_ESTATE_MCP_STATUS_EVIDENCE');
  return document;
}

function validatePlan(document, client) {
  exactKeys(document, [
    'schemaVersion', 'kind', 'plannedAt', 'capturedAt', 'client', 'overallStatus',
    'routingDigestSha256', 'statusDigestSha256', 'decisions', 'authority', 'planDigestSha256',
  ], [], 'EVAVO_GITHUB_ESTATE_MCP_PLAN_DOCUMENT');
  assert(document.schemaVersion === 1, 'EVAVO_GITHUB_ESTATE_MCP_PLAN_SCHEMA');
  assert(document.kind === 'evavo-agent-capability-route-plan-v1', 'EVAVO_GITHUB_ESTATE_MCP_PLAN_KIND');
  assert(document.client === client, 'EVAVO_GITHUB_ESTATE_MCP_PLAN_CLIENT');
  canonicalInstant(document.plannedAt, 'EVAVO_GITHUB_ESTATE_MCP_PLAN_PLANNED_AT');
  canonicalInstant(document.capturedAt, 'EVAVO_GITHUB_ESTATE_MCP_PLAN_CAPTURED_AT');
  assert(Array.isArray(document.decisions), 'EVAVO_GITHUB_ESTATE_MCP_PLAN_DECISIONS');
  assert(isRecord(document.authority), 'EVAVO_GITHUB_ESTATE_MCP_PLAN_AUTHORITY');
  assert(Object.values(document.authority).every((value) => value === false), 'EVAVO_GITHUB_ESTATE_MCP_PLAN_AUTHORITY_GRANTED');
  return document;
}

function leaksConfiguredPath(value) {
  if (typeof value !== 'string') return false;
  const normalized = process.platform === 'win32' ? value.toLowerCase() : value;
  return [config.snapshotRoot, config.trustBundle, config.routeCli, config.routingConfig]
    .filter(Boolean)
    .some((candidate) => normalized.includes(process.platform === 'win32' ? candidate.toLowerCase() : candidate));
}

function assertPublic(value, depth = 0) {
  assert(depth <= 64, 'EVAVO_GITHUB_ESTATE_MCP_OUTPUT_DEPTH');
  if (typeof value === 'string') {
    assert(!leaksConfiguredPath(value), 'EVAVO_GITHUB_ESTATE_MCP_OUTPUT_PATH_VALUE');
  } else if (Array.isArray(value)) {
    for (const child of value) assertPublic(child, depth + 1);
  } else if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      assert(!/^(?:path|filePath|directory|snapshotDirectory|snapshotRoot|trustBundle|configPath)$/u.test(key), 'EVAVO_GITHUB_ESTATE_MCP_OUTPUT_PATH_FIELD');
      assertPublic(child, depth + 1);
    }
  }
}

async function route(mode, args) {
  const report = await readiness();
  assert(report.status === 'configured', 'EVAVO_GITHUB_ESTATE_MCP_NOT_CONFIGURED');
  const client = selectedClient(args.client);
  const now = args.now === undefined
    ? new Date().toISOString()
    : canonicalInstant(args.now, 'EVAVO_GITHUB_ESTATE_MCP_NOW').text;
  const argv = [
    config.routeCli, mode, '--snapshot-root', config.snapshotRoot, '--trust-bundle',
    config.trustBundle, '--client', client, '--now', now, '--compact',
  ];
  if (mode === 'plan') argv.push('--config', config.routingConfig);
  const document = await runRoute(argv);
  const validated = mode === 'status' ? validateStatus(document, client) : validatePlan(document, client);
  assertPublic(validated);
  return validated;
}

const schema = (properties, required = []) => Object.freeze({
  type: 'object', properties: Object.freeze(properties), required: Object.freeze(required), additionalProperties: false,
});
const clientSchema = Object.freeze({ type: 'string', enum: CLIENTS });
const nowSchema = Object.freeze({ type: 'string', format: 'date-time' });
const annotations = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

export const githubEstateRoutingTools = Object.freeze([
  Object.freeze({
    name: READINESS,
    title: 'Inspect signed GitHub estate routing readiness',
    description: 'Inspect fixed local snapshot, trust, verifier and routing configuration readiness without verifying evidence, exposing paths, creating keys, executing work or mutating a repository or provider.',
    inputSchema: schema({}),
    annotations,
  }),
  Object.freeze({
    name: STATUS,
    title: 'Verify signed GitHub estate routing status',
    description: 'Verify the newest fixed signed estate snapshot and return bounded capability status for one supported client. No caller-selected path, command or endpoint is accepted.',
    inputSchema: schema({ client: clientSchema, now: nowSchema }, ['client']),
    annotations,
  }),
  Object.freeze({
    name: PLAN,
    title: 'Plan from signed GitHub estate routing evidence',
    description: 'Verify the newest fixed signed estate snapshot and compile a deterministic all-false-authority route plan. The plan cannot execute, mutate, publish or grant credentials.',
    inputSchema: schema({ client: clientSchema, now: nowSchema }, ['client']),
    annotations,
  }),
]);

function toolResult(value) {
  return Object.freeze({
    content: Object.freeze([{ type: 'text', text: `${JSON.stringify(value)}\n` }]),
    structuredContent: value,
    isError: false,
  });
}

export async function callGitHubEstateRoutingTool(name, args = {}) {
  const selected = text(name, 'EVAVO_GITHUB_ESTATE_MCP_TOOL_NAME', { maximum: 128 });
  if (selected === READINESS) {
    exactKeys(args, [], [], 'EVAVO_GITHUB_ESTATE_MCP_READINESS_ARGUMENTS');
    return toolResult(await readiness());
  }
  if (selected === STATUS || selected === PLAN) {
    exactKeys(args, ['client'], ['now'], 'EVAVO_GITHUB_ESTATE_MCP_ROUTE_ARGUMENTS');
    return toolResult(await route(selected === STATUS ? 'status' : 'plan', args));
  }
  fail('EVAVO_GITHUB_ESTATE_MCP_UNKNOWN_TOOL');
}

export const githubEstateRoutingMcpContract = Object.freeze({
  serverName: SERVER_NAME,
  serverVersion: SERVER_VERSION,
  tools: Object.freeze([READINESS, STATUS, PLAN]),
  supportedClients: CLIENTS,
});

