#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const SERVER_NAME = "evavo-windows-chat-execution-mcp";
const SERVER_VERSION = "2.1.0";
const PROTOCOL_VERSION = "2026-07-28";
const LEGACY_EXECUTE_TOOLS = new Set([
  "evavo_windows_execute",
  "evavo_windows_execute_batch",
]);
const STATUS_TOOL = "evavo_windows_execution_doctor";
const ROUTE_TOOL = "evavo_windows_execution_route";

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const bridgeStateRoot = path.join(localAppData, "EVAVO", "WindowsWorkstationBridge");
const healthUrlFile = path.join(bridgeStateRoot, "health-url.txt");
const queueReadyFile = path.join(bridgeStateRoot, "queue-ready.json");

function readJsonIfRegular(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function readHealthUrl() {
  try {
    const stat = fs.lstatSync(healthUrlFile);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const value = fs.readFileSync(healthUrlFile, "utf8").trim().replace(/\/+$/u, "");
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/u.test(value)) return null;
    return value;
  } catch {
    return null;
  }
}

async function tunnelReady() {
  const baseUrl = readHealthUrl();
  if (!baseUrl) return { observed: false, ready: false, httpStatus: null };
  try {
    const response = await fetch(`${baseUrl}/readyz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_500),
    });
    return {
      observed: true,
      ready: response.status === 200,
      httpStatus: response.status,
    };
  } catch {
    return { observed: true, ready: false, httpStatus: null };
  }
}

function queueReady() {
  const value = readJsonIfRegular(queueReadyFile);
  return Boolean(
    value &&
      value.ready === true &&
      value.githubAuthenticated === true &&
      value.issuesApiReachable === true,
  );
}

function routeDocument() {
  return {
    schemaVersion: 2,
    kind: "evavo-windows-chat-execution-migration-route-v2",
    legacyServer: SERVER_NAME,
    legacyRawShellExecutionRemoved: true,
    canonical: {
      preferredSharedIngress: "evavo-hardware-gateway",
      preferredSharedIngressRole: "singleton-agent-gateway",
      receiptPolicyTool: "evavo_control_receipt_advice",
      workstationBridge: "evavo-windows-workstation-bridge",
      workstationBridgeRole: "compatibility-direct-fallback",
      workstationStatusTool: "evavo_workstation_bridge_status",
      directChatGptTransport: "openai-secure-mcp-tunnel",
      sameMachineExecutionEngine: "evavo-local-execution",
      effectfulCloudFallback: "github-local-execution-issue-queue",
      localAgentExecutorRole: "local-internal-fallback",
    },
    authority: {
      structuredRequestRequired: true,
      exactScriptSha256RequiredForQueuedScripts: true,
      arbitraryCommandTextAccepted: false,
      inlineCodeAccepted: false,
      currentWindowsUserRawShellAuthorityExposed: false,
      automaticAdministratorElevation: false,
      inboundFirewallPortRequired: false,
      publicLocalEndpointRequired: false,
      receiptPersistenceFailureMayNotInvertPhysicalSuccess: true,
      unknownPostDispatchPhysicalEffectRequiresReconciliation: true,
      blindRetryAfterUnknownPhysicalEffectAllowed: false,
    },
    physicalWindowsReadinessClaimed: false,
  };
}

async function doctor() {
  const tunnel = await tunnelReady();
  const queue = queueReady();
  return {
    schemaVersion: 3,
    kind: "evavo-windows-chat-execution-compatibility-doctor-v3",
    ok: tunnel.ready && queue,
    server: SERVER_NAME,
    version: SERVER_VERSION,
    compatibilityShim: true,
    rawShellExecutionRemoved: true,
    preferredSharedIngress: "evavo-hardware-gateway",
    preferredSharedIngressReadinessObservedHere: false,
    compatibilityBridgeTunnel: tunnel,
    compatibilityGithubIssueQueueReadyObserved: queue,
    route: routeDocument().canonical,
    receiptTruthPolicy: {
      tool: "evavo_control_receipt_advice",
      unknownEffectDisposition: "reconcile-before-retry",
      degradedVerifiedSuccessDisposition: "success-receipt-degraded",
      blindRetryAllowed: false,
    },
    arbitraryCommandTextAccepted: false,
    inlineCodeAccepted: false,
    currentWindowsUserRawShellAuthorityExposed: false,
    credentialValuesReturned: false,
    physicalWindowsReadinessClaimed: false,
  };
}

const TOOLS = Object.freeze([
  {
    name: STATUS_TOOL,
    description:
      "Read-only compatibility doctor for the retired Windows chat shell. Reports sanitized Workstation Bridge fallback readiness and the canonical singleton-gateway replacement route.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: {
      "io.evavo/effects": ["read", "compute"],
      "io.evavo/arbitraryCommandTextAccepted": false,
      "io.evavo/inlineCodeAccepted": false,
      "io.evavo/canonicalExecutionServer": "evavo-local-execution",
      "io.evavo/preferredSharedIngress": "evavo-hardware-gateway",
      "io.evavo/workstationBridgeRole": "compatibility-direct-fallback",
    },
  },
  {
    name: ROUTE_TOOL,
    description:
      "Return the canonical Windows execution/ChatGPT routing contract. Read-only; performs no workstation mutation.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: {
      "io.evavo/effects": ["read"],
      "io.evavo/arbitraryCommandTextAccepted": false,
      "io.evavo/inlineCodeAccepted": false,
      "io.evavo/preferredSharedIngress": "evavo-hardware-gateway",
    },
  },
]);

const success = (id, result) => ({ jsonrpc: "2.0", id: id ?? null, result });
const failure = (id, code, message, data) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) },
});
const toolResult = (value, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
  isError,
});

async function callTool(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("arguments must be an object");
  }
  if (Object.keys(args).length) throw new Error(`${name} accepts no arguments`);
  if (name === STATUS_TOOL) return toolResult(await doctor());
  if (name === ROUTE_TOOL) return toolResult(routeDocument());
  if (LEGACY_EXECUTE_TOOLS.has(name)) {
    return toolResult(
      {
        schemaVersion: 2,
        kind: "evavo-windows-chat-execution-retired-tool-v2",
        ok: false,
        retiredTool: name,
        reason: "raw-chat-shell-authority-retired",
        use: {
          preferredSharedIngress: "evavo-hardware-gateway",
          sameMachineExecution: "evavo-local-execution",
          compatibilityBridge: "evavo-windows-workstation-bridge",
          effectfulCloudFallback: "github-local-execution-issue-queue",
          receiptPolicy: "evavo_control_receipt_advice",
        },
        retryRule: "Never retry an effectful Windows action after dispatch unless receipt evidence proves no physical effect occurred.",
        arbitraryCommandTextAccepted: false,
        inlineCodeAccepted: false,
        executionPerformed: false,
      },
      true,
    );
  }
  throw new Error(`unknown tool: ${name}`);
}

async function dispatch(request) {
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return failure(request?.id, -32600, "Invalid Request");
  }
  const id = request.id;
  if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") return null;
  if (request.method === "ping") return success(id, {});
  if (request.method === "initialize") {
    return success(id, {
      protocolVersion: request.params?.protocolVersion || PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions:
        "Compatibility-only server. Raw caller-supplied Windows shell execution is retired. Prefer the singleton evavo-hardware-gateway for shared Windows/storage control, use evavo-local-execution for structured SHA-bound same-machine execution, keep evavo-windows-workstation-bridge as a compatibility/direct fallback, and use evavo_control_receipt_advice before any retry after an uncertain effect.",
    });
  }
  if (request.method === "server/discover") {
    return success(id, {
      resultType: "complete",
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: true },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      _meta: {
        "io.evavo/compatibilityShim": true,
        "io.evavo/arbitraryCommandTextAccepted": false,
        "io.evavo/inlineCodeAccepted": false,
        "io.evavo/preferredSharedIngress": "evavo-hardware-gateway",
        "io.evavo/workstationBridgeRole": "compatibility-direct-fallback",
        "io.evavo/canonicalExecutionServer": "evavo-local-execution",
        "io.evavo/receiptPolicyTool": "evavo_control_receipt_advice",
      },
    });
  }
  if (request.method === "tools/list") return success(id, { tools: TOOLS });
  if (request.method === "tools/call") {
    try {
      const value = await callTool(String(request.params?.name || ""), request.params?.arguments ?? {});
      return success(id, value);
    } catch (error) {
      return success(
        id,
        toolResult(
          {
            schemaVersion: 2,
            kind: "evavo-windows-chat-execution-compatibility-error-v2",
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            retryUnderlyingAction: false,
            reconciliationRequired: true,
            receiptPolicyTool: "evavo_control_receipt_advice",
            arbitraryCommandTextAccepted: false,
            inlineCodeAccepted: false,
            executionPerformed: false,
          },
          true,
        ),
      );
    }
  }
  return failure(id, -32601, `Method not found: ${request.method}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
for await (const line of lines) {
  if (!line.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    process.stdout.write(`${JSON.stringify(failure(null, -32700, "Parse error"))}\n`);
    continue;
  }
  const response = await dispatch(request);
  if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`);
}