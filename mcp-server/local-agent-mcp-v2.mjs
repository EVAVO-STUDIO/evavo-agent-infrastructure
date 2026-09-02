import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { createInterface } from "node:readline";

const LOCAL_COMPUTE_REPO = "EVAVO-STUDIO/evavo-local-compute";
const PROTOCOL_VERSION = "2024-11-05";
const MAX_REQUEST_BYTES = 256 * 1024;
const RUNTIMES = Object.freeze(["python", "powershell", "bash", "cmd", "node"]);
const ROUTES = Object.freeze({
  background: "EVAVO-STUDIO/evavo-local-compute",
  cli: "EVAVO-STUDIO/evavo-local-compute",
  git: "EVAVO-STUDIO/evavo-local-compute",
  build: "EVAVO-STUDIO/evavo-local-compute",
  test: "EVAVO-STUDIO/evavo-local-compute",
  file: "EVAVO-STUDIO/evavo-local-compute",
  modelExecution: "EVAVO-STUDIO/evavo-local-compute",
  gui: "EVAVO-STUDIO/evavo-computer-agent",
  preboot: "EVAVO-STUDIO/evavo-local-ai-agent-gateway",
  physicalConsole: "EVAVO-STUDIO/evavo-local-ai-agent-gateway",
  cometRecovery: "EVAVO-STUDIO/evavo-out-of-band-control",
  network: "EVAVO-STUDIO/network-studio",
  modelGovernance: "EVAVO-STUDIO/evavo-model-lab",
  publication: "EVAVO-STUDIO/evavo-development-studio",
});

const TOOLS = Object.freeze([
  {
    name: "evavo_workstation_fabric_status",
    description: "Return the canonical EVAVO Windows execution, handoff, receipt, concurrency and safety contract. Performs no execution.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "evavo_workstation_route_task",
    description: "Resolve one task class to the canonical EVAVO authority before execution or handoff.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskClass"],
      properties: { taskClass: { enum: Object.keys(ROUTES) } },
    },
  },
  {
    name: "evavo_workstation_submit_and_wait",
    description: "Submit one structured Local Compute execution request, wait for its authoritative terminal receipt, and return normalized stdout/stderr/exit/timeout/source evidence. Raw shell text is not accepted by this tool.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: {
        request: { type: "object" },
        waitSeconds: { type: "integer", minimum: 30, maximum: 1200 },
        pollSeconds: { type: "integer", minimum: 2, maximum: 30 },
      },
    },
  },
  {
    name: "evavo_workstation_job_status",
    description: "Read one previously submitted EVAVO local execution issue and normalize its latest authoritative terminal receipt without causing execution.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["issueNumber"],
      properties: { issueNumber: { type: "integer", minimum: 1 } },
    },
  },
]);

function asObject(value, label = "value") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function boundedString(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function boundedStringArray(value, label, maximumItems = 128, maximumLength = 8192) {
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error(`${label} must be a bounded string array`);
  return value.map((item, index) => boundedString(item, `${label}[${index}]`, maximumLength));
}

function validateAuthorities(value) {
  const raw = asObject(value, "request.authorities");
  const keys = ["execute", "network", "scriptExecution", "repositoryCode", "filesystemWrite", "gitMutation", "containers", "archive"];
  const result = {};
  for (const key of keys) {
    if (typeof raw[key] !== "boolean") throw new Error(`request.authorities.${key} must be boolean`);
    result[key] = raw[key];
  }
  return result;
}

function validateRequest(rawRequest) {
  const request = structuredClone(asObject(rawRequest, "request"));
  if (request.operation !== "tool" && request.operation !== "script") throw new Error("request.operation must be tool or script");
  request.cwd = boundedString(request.cwd, "request.cwd");
  if (!Number.isInteger(request.timeoutSeconds) || request.timeoutSeconds < 1 || request.timeoutSeconds > 900) {
    throw new Error("request.timeoutSeconds must be an integer from 1 to 900");
  }
  if (!new Set(["disabled", "reviewed"]).has(request.network)) throw new Error("request.network must be disabled or reviewed");
  request.authorities = validateAuthorities(request.authorities);
  if (request.network === "disabled" && request.authorities.network) throw new Error("disabled network conflicts with network authority");
  if (request.network === "reviewed" && !request.authorities.network) throw new Error("reviewed network requires network authority");
  delete request.command;
  delete request.shell;
  delete request.inlineCode;
  if (request.operation === "tool") {
    const tool = asObject(request.tool, "request.tool");
    request.tool = {
      id: boundedString(tool.id, "request.tool.id", 128),
      arguments: boundedStringArray(tool.arguments ?? [], "request.tool.arguments"),
    };
    delete request.script;
  } else {
    const script = asObject(request.script, "request.script");
    if (!RUNTIMES.includes(script.runtime)) throw new Error("request.script.runtime is unsupported");
    if (!/^[0-9]+(?:\.[0-9]+){0,2}$/.test(String(script.runtimeVersion ?? ""))) throw new Error("request.script.runtimeVersion is invalid");
    if (!/^[a-f0-9]{64}$/.test(String(script.sha256 ?? ""))) throw new Error("request.script.sha256 must be exact SHA-256");
    request.script = {
      runtime: script.runtime,
      runtimeVersion: String(script.runtimeVersion),
      path: boundedString(script.path, "request.script.path"),
      sha256: String(script.sha256),
      arguments: boundedStringArray(script.arguments ?? [], "request.script.arguments"),
      requires: boundedStringArray(script.requires ?? [], "request.script.requires", 16, 128),
    };
    delete request.tool;
  }
  return request;
}

function runGh(args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    execFile("gh", args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`gh failed: ${String(stderr || stdout || error.message).trim().slice(0, 3000)}`));
        return;
      }
      resolve(String(stdout || ""));
    });
  });
}

function parseJsonReceiptText(text) {
  if (typeof text !== "string") return null;
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/giu)];
  const candidates = fenced.length ? fenced.map((match) => match[1]) : [text];
  for (const candidate of candidates.reverse()) {
    try {
      const value = JSON.parse(candidate.trim());
      if (value && typeof value === "object" && !Array.isArray(value) && value.terminal === true && value.receiptIsOutcomeAuthority === true) return value;
    } catch {}
  }
  return null;
}

function normalizeReceipt(receipt, issueNumber) {
  const execution = receipt && typeof receipt.execution === "object" && receipt.execution ? receipt.execution : {};
  return {
    schemaVersion: 2,
    kind: "evavo-mcp-workstation-session-result-v2",
    ok: receipt?.ok === true && receipt?.status === "completed",
    issueNumber,
    jobId: receipt?.jobId ?? null,
    terminal: receipt?.terminal === true,
    status: receipt?.status ?? null,
    outcome: receipt?.outcome ?? null,
    executionAttempted: receipt?.executionAttempted ?? null,
    exitCode: execution.exitCode ?? null,
    timedOut: execution.timedOut ?? null,
    stdoutBytes: execution.stdoutBytes ?? null,
    stderrBytes: execution.stderrBytes ?? null,
    output: typeof receipt?.output === "string" ? receipt.output : "",
    managedSource: receipt?.managedSource ?? null,
    postconditionVerified: receipt?.postconditionVerified ?? null,
    reconciliationRequired: receipt?.reconciliationRequired ?? null,
    safeAutomaticReplay: receipt?.safeAutomaticReplay ?? null,
    sideEffectMayHaveCommitted: receipt?.sideEffectMayHaveCommitted ?? null,
    failureClass: classifyReceipt(receipt),
    rawReceipt: receipt,
  };
}

function classifyReceipt(receipt) {
  if (!receipt) return "receipt-missing";
  if (receipt.executionAttempted === false) return receipt.outcome === "blocked" ? "admission-or-policy" : "pre-execution";
  if (receipt.execution?.timedOut === true) return "timeout";
  if (Number.isInteger(receipt.execution?.exitCode) && receipt.execution.exitCode !== 0) return "process-exit";
  if (receipt.reconciliationRequired === true && receipt.sideEffectMayHaveCommitted === true) return "reconciliation-required";
  if (receipt.ok === true && receipt.status === "completed") return "none";
  return "unknown";
}

async function readIssue(issueNumber) {
  const output = await runGh(["issue", "view", String(issueNumber), "--repo", LOCAL_COMPUTE_REPO, "--json", "number,state,stateReason,comments"], 30000);
  const issue = JSON.parse(output);
  const comments = Array.isArray(issue.comments) ? issue.comments : [];
  let receipt = null;
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    receipt = parseJsonReceiptText(comments[index]?.body ?? "");
    if (receipt) break;
  }
  return { issue, receipt };
}

async function submitAndWait(rawArgs) {
  const args = asObject(rawArgs, "arguments");
  const request = validateRequest(args.request);
  const nonce = randomUUID().replaceAll("-", "");
  const requestId = `mcp-${Date.now()}-${nonce.slice(0, 12)}`;
  request.schemaVersion = 1;
  request.kind = "evavo-local-execution-request";
  request.requestId = requestId;
  const envelope = { schemaVersion: 1, kind: "evavo-local-execution-queue-job-v1", jobId: requestId, request };
  const body = JSON.stringify(envelope);
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) throw new Error("structured execution request is too large");
  const created = await runGh([
    "api", "-X", "POST", `repos/${LOCAL_COMPUTE_REPO}/issues",
    "-f", `title=[EVAVO LOCAL EXEC] ${requestId}`,
    "-f", `body=${body}`,
    "--jq", ".number",
  ], 30000);
  const issueNumber = Number(created.trim());
  if (!Number.isInteger(issueNumber) || issueNumber < 1) throw new Error("GitHub queue issue creation returned no issue number");
  const waitSeconds = Number.isInteger(args.waitSeconds) ? args.waitSeconds : Math.min(1200, request.timeoutSeconds + 180);
  const pollSeconds = Number.isInteger(args.pollSeconds) ? args.pollSeconds : 5;
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    const { issue, receipt } = await readIssue(issueNumber);
    if (receipt) return normalizeReceipt(receipt, issueNumber);
    if (issue.state === "CLOSED") {
      return { schemaVersion: 2, kind: "evavo-mcp-workstation-session-result-v2", ok: false, issueNumber, terminal: true, failureClass: "closed-without-authoritative-receipt", safeAutomaticReplay: false };
    }
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }
  return { schemaVersion: 2, kind: "evavo-mcp-workstation-session-result-v2", ok: false, issueNumber, terminal: false, failureClass: "mcp-wait-timeout", safeAutomaticReplay: false, note: "The queue job may still be executing; do not submit a duplicate until its authoritative receipt is reconciled." };
}

function fabricStatus() {
  return {
    schemaVersion: 2,
    kind: "evavo-workstation-execution-fabric-mcp-v2",
    ok: true,
    canonicalExecutionAuthority: ROUTES.background,
    authorities: ROUTES,
    canonicalUnattendedResident: "HKCU Run -> Python 3.12 resident",
    scriptRuntimesPhysicallyProven: [...RUNTIMES],
    structuredArgvPreferred: true,
    shaBoundScriptFallback: true,
    rawOpaqueShellIsCanonical: false,
    uncataloguedLegitimateCommandRoute: "reviewed SHA-bound script with explicit argv",
    terminalReceiptRequired: true,
    closedIssueAloneMeansSuccess: false,
    correctedRetryRequiresNewId: true,
    blindReplayAfterPossibleEffect: false,
    maximumConcurrentMutationWritersPerRoot: 1,
    parallelReadOnlyMaySerializeOnGithubFallback: true,
    foregroundHumanExperienceWins: true,
    physicalConsoleInputNeverBlindlyRetried: true,
    githubActionsRequired: false,
    paidComputeRequired: false,
    credentialValuesReturned: false,
  };
}

async function callTool(name, raw) {
  const args = raw === undefined ? {} : asObject(raw, "arguments");
  if (name === "evavo_workstation_fabric_status") return fabricStatus();
  if (name === "evavo_workstation_route_task") {
    const taskClass = boundedString(args.taskClass, "taskClass", 64);
    const authority = ROUTES[taskClass];
    if (!authority) throw new Error("taskClass is unsupported");
    return { schemaVersion: 1, kind: "evavo-workstation-route-v1", ok: true, taskClass, authority, preferBackgroundOverPhysicalHid: true };
  }
  if (name === "evavo_workstation_submit_and_wait") return submitAndWait(args);
  if (name === "evavo_workstation_job_status") {
    if (!Number.isInteger(args.issueNumber) || args.issueNumber < 1) throw new Error("issueNumber is invalid");
    const { issue, receipt } = await readIssue(args.issueNumber);
    if (receipt) return normalizeReceipt(receipt, args.issueNumber);
    return { schemaVersion: 2, kind: "evavo-mcp-workstation-session-result-v2", ok: false, issueNumber: args.issueNumber, terminal: issue.state === "CLOSED", issueState: issue.state, failureClass: issue.state === "CLOSED" ? "closed-without-authoritative-receipt" : "pending" };
  }
  throw new Error(`unknown tool: ${name}`);
}

const result = (id, value) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const error = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try { request = JSON.parse(line); } catch { write(error(null, -32700, "Parse error")); continue; }
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") { write(error(request.id, -32600, "Invalid request")); continue; }
  try {
    if (request.method === "notifications/initialized") continue;
    if (request.method === "ping") write(result(request.id, {}));
    else if (request.method === "initialize") write(result(request.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "evavo-workstation-fabric-mcp", version: "2.0.0" } }));
    else if (request.method === "tools/list") write(result(request.id, { tools: TOOLS }));
    else if (request.method === "tools/call") {
      const params = asObject(request.params, "params");
      const value = await callTool(String(params.name ?? ""), params.arguments);
      write(result(request.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: false }));
    } else write(error(request.id, -32601, "Method not found"));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown error";
    write(result(request.id, { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, credentialValuesReturned: false }) }], isError: true }));
  }
}
