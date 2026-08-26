import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { win32 as path } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const SERVER_NAME = "evavo-windows-chat-execution-mcp";
const SERVER_VERSION = "1.0.0";
const BASE_URL = (process.env.EVAVO_WINDOWS_CHAT_EXECUTOR_URL || "http://127.0.0.1:5000").replace(/\/+$/u, "");
const STORAGE_ROOT = process.env.EVAVO_LOCAL_STORAGE_ROOT || "C:\\GitRepos\\evavo-local-storage";
const SERVICE_ROOT = process.env.EVAVO_SERVICE_CONTROL_PLANE_ROOT || "C:\\GitRepos\\evavo-service-control-plane";
const ATTEST = path.join(STORAGE_ROOT, "scripts", "Test-EvavoAcceptedRestExecutorSource.ps1");
const INSTALLER = path.join(SERVICE_ROOT, "packages", "rest-executor", "Install-RestExecutorV5Task.ps1");
const ENABLED = /^(1|true|enabled|yes)$/iu.test(process.env.EVAVO_WINDOWS_CHAT_EXECUTION_ENABLED || "");
const AUTO_RECOVER = !/^(0|false|disabled|no)$/iu.test(process.env.EVAVO_WINDOWS_CHAT_EXECUTION_AUTO_RECOVER || "enabled");
const SHELLS = Object.freeze(["powershell", "cmd", "bash", "python"]);
const MAX_COMMAND_LENGTH = 18_000;
const MAX_BATCH = 50;

function configuredRoots() {
  const raw = (process.env.EVAVO_WINDOWS_CHAT_ALLOWED_ROOTS || "C:\\GitRepos;%LOCALAPPDATA%\\EVAVO;%USERPROFILE%\\Downloads").split(";");
  const expand = (value) => value
    .replace(/%USERPROFILE%/giu, process.env.USERPROFILE || homedir())
    .replace(/%LOCALAPPDATA%/giu, process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local"));
  return raw.map((entry) => entry.trim()).filter(Boolean).map((entry) => path.resolve(expand(entry)));
}

function isContained(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveCwd(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const resolved = path.resolve(String(value));
  if (!configuredRoots().some((root) => isContained(resolved, root))) {
    throw new Error("cwd is outside EVAVO Windows chat execution roots");
  }
  return resolved;
}

function validateShell(value) {
  const shell = String(value || "powershell").toLowerCase();
  if (!SHELLS.includes(shell)) throw new Error(`unsupported shell: ${shell}`);
  return shell;
}

function validateCommand(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("command must be a non-empty string");
  if (value.length > MAX_COMMAND_LENGTH) throw new Error(`command exceeds ${MAX_COMMAND_LENGTH} characters`);
  return value;
}

function validateTimeout(value) {
  const number = value === undefined ? 300 : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 300) throw new Error("timeoutSeconds must be an integer from 1 to 300");
  return number;
}

function psLiteral(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}

function bashLiteral(value) {
  return `'${String(value).replace(/'/gu, `'"'"'`)}'`;
}

function bashPath(windowsPath) {
  const match = /^([A-Za-z]):\\(.*)$/u.exec(windowsPath);
  if (!match) return windowsPath.replace(/\\/gu, "/");
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/gu, "/")}`;
}

function withCwd(command, shell, cwd) {
  if (!cwd) return command;
  if (shell === "powershell") return `Set-Location -LiteralPath ${psLiteral(cwd)}; ${command}`;
  if (shell === "cmd") return `cd /d "${cwd.replace(/"/gu, '""')}" && ${command}`;
  if (shell === "bash") return `cd ${bashLiteral(bashPath(cwd))} && ${command}`;
  return `import os\nos.chdir(${JSON.stringify(cwd)})\n${command}`;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function runPowerShell(script, args = [], timeout = 90_000) {
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(-4000);
    throw new Error(detail || `PowerShell helper failed: ${script}`);
  }
  return String(result.stdout || "").trim();
}

function attestAcceptedSource() {
  const text = runPowerShell(ATTEST, ["-RuntimeRepository", SERVICE_ROOT], 60_000);
  let receipt;
  try { receipt = JSON.parse(text); } catch { throw new Error("REST Executor accepted-source attestation returned invalid JSON"); }
  if (receipt.ok !== true || receipt.acceptedSource !== true || receipt.executorVersion !== "5.0.0" || Number(receipt.apiRevision) < 2) {
    throw new Error("REST Executor source is not the physically accepted v5/API2 runtime");
  }
  return receipt;
}

async function health() {
  const response = await fetch(`${BASE_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`REST Executor health returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.status !== "healthy" || body.version !== "5.0.0" || Number(body.api_revision) < 2) {
    throw new Error("REST Executor live runtime is not accepted v5/API2");
  }
  return body;
}

async function ensureRuntime() {
  if (!ENABLED) throw new Error("EVAVO_WINDOWS_CHAT_EXECUTION_ENABLED=enabled is required");
  const attestation = attestAcceptedSource();
  try {
    const live = await health();
    return { attestation, live, recovered: false };
  } catch (initial) {
    if (!AUTO_RECOVER) throw initial;
    runPowerShell(INSTALLER, ["-StartNow"], 180_000);
    const live = await health();
    return { attestation, live, recovered: true };
  }
}

async function postJson(endpoint, body, timeoutSeconds) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout((timeoutSeconds + 10) * 1000),
  });
  let value;
  try { value = await response.json(); } catch { throw new Error(`REST Executor returned invalid JSON (HTTP ${response.status})`); }
  return { httpStatus: response.status, value };
}

function publicResult(result, command, shell, cwd, runtime) {
  return {
    schema: "evavo.windows-chat-execution.receipt.v1",
    ok: result.status === "success" && Number(result.exit_code) === 0,
    status: result.status,
    shell,
    cwd,
    exitCode: Number(result.exit_code),
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    durationSeconds: Number(result.duration || 0),
    commandSha256: sha256(command),
    commandTextReturned: false,
    arbitraryCommandTextAccepted: true,
    currentWindowsUserAuthority: true,
    executorVersion: runtime.live.version,
    executorApiRevision: Number(runtime.live.api_revision),
    acceptedSourceAttested: true,
    runtimeRecovered: runtime.recovered,
    loopbackOnly: true,
    maximumInteractiveSeconds: 300,
  };
}

async function executeOne(args) {
  const shell = validateShell(args.shell);
  const command = validateCommand(args.command);
  const timeoutSeconds = validateTimeout(args.timeoutSeconds);
  const cwd = resolveCwd(args.cwd);
  const runtime = await ensureRuntime();
  const wrapped = withCwd(command, shell, cwd);
  const { httpStatus, value } = await postJson("/execute", { command: wrapped, shell, timeout: timeoutSeconds }, timeoutSeconds);
  if (httpStatus >= 500) throw new Error(`REST Executor failed with HTTP ${httpStatus}`);
  return publicResult(value, command, shell, cwd, runtime);
}

async function executeBatch(args) {
  if (!Array.isArray(args.commands) || args.commands.length < 1 || args.commands.length > MAX_BATCH) {
    throw new Error(`commands must contain 1-${MAX_BATCH} items`);
  }
  const runtime = await ensureRuntime();
  const normalized = args.commands.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`commands[${index}] must be an object`);
    const shell = validateShell(entry.shell);
    const command = validateCommand(entry.command);
    const timeout = validateTimeout(entry.timeoutSeconds);
    const cwd = resolveCwd(entry.cwd);
    return { shell, command, cwd, timeout, wrapped: withCwd(command, shell, cwd) };
  });
  const maximumTimeout = Math.max(...normalized.map((item) => item.timeout));
  const { httpStatus, value } = await postJson("/execute/batch", {
    commands: normalized.map((item) => ({ command: item.wrapped, shell: item.shell, timeout: item.timeout })),
    stop_on_error: args.stopOnError === true,
  }, Math.min(300, maximumTimeout));
  if (httpStatus >= 500) throw new Error(`REST Executor batch failed with HTTP ${httpStatus}`);
  const results = Array.isArray(value.results) ? value.results : [];
  return {
    schema: "evavo.windows-chat-execution.batch-receipt.v1",
    ok: value.status === "success" && Number(value.failed || 0) === 0,
    status: value.status,
    total: normalized.length,
    executed: Number(value.executed || results.length),
    failed: Number(value.failed || 0),
    stopOnError: args.stopOnError === true,
    results: results.map((result, index) => publicResult(result, normalized[index]?.command || "", normalized[index]?.shell || "unknown", normalized[index]?.cwd || null, runtime)),
    acceptedSourceAttested: true,
    runtimeRecovered: runtime.recovered,
    loopbackOnly: true,
    arbitraryCommandTextAccepted: true,
    currentWindowsUserAuthority: true,
  };
}

async function doctor() {
  const runtime = await ensureRuntime();
  return {
    schema: "evavo.windows-chat-execution.doctor.v1",
    ok: true,
    server: SERVER_NAME,
    version: SERVER_VERSION,
    enabled: ENABLED,
    autoRecover: AUTO_RECOVER,
    shells: SHELLS,
    allowedCwdRoots: configuredRoots(),
    maximumInteractiveSeconds: 300,
    maximumBatchCommands: MAX_BATCH,
    arbitraryCommandTextAccepted: true,
    currentWindowsUserAuthority: true,
    inlineCodeAccepted: true,
    longJobsUseReviewedLocalExecution: true,
    acceptedSourceAttested: true,
    executorVersion: runtime.live.version,
    executorApiRevision: Number(runtime.live.api_revision),
    runtimeRecovered: runtime.recovered,
    loopbackOnly: true,
  };
}

const TOOLS = Object.freeze([
  {
    name: "evavo_windows_execution_doctor",
    description: "Verify the physically accepted loopback Windows executor is attested, healthy and ready for chat-driven shell execution.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { "io.evavo/effects": ["read", "execute"], "io.evavo/arbitraryCommandTextAccepted": false },
  },
  {
    name: "evavo_windows_execute",
    description: "Execute caller-supplied PowerShell, CMD, Bash or Python on the local Windows workstation with the current user's authority. Interactive calls are bounded to 300 seconds; use evavo-local-execution for durable longer jobs.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["command"],
      properties: {
        shell: { type: "string", enum: SHELLS, default: "powershell" },
        command: { type: "string", minLength: 1, maxLength: MAX_COMMAND_LENGTH },
        cwd: { type: "string", minLength: 1 },
        timeoutSeconds: { type: "integer", minimum: 1, maximum: 300, default: 300 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    _meta: {
      "io.evavo/effects": ["execute", "write", "network", "repository-mutation", "device-control"],
      "io.evavo/arbitraryCommandTextAccepted": true,
      "io.evavo/inlineCodeAccepted": true,
      "io.evavo/currentWindowsUserAuthority": true,
    },
  },
  {
    name: "evavo_windows_execute_batch",
    description: "Execute a sequential mixed-shell batch on the local Windows workstation. Each item may use PowerShell, CMD, Bash or Python and its own bounded timeout/cwd.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["commands"],
      properties: {
        commands: {
          type: "array", minItems: 1, maxItems: MAX_BATCH,
          items: {
            type: "object", additionalProperties: false, required: ["command"],
            properties: {
              shell: { type: "string", enum: SHELLS, default: "powershell" },
              command: { type: "string", minLength: 1, maxLength: MAX_COMMAND_LENGTH },
              cwd: { type: "string", minLength: 1 },
              timeoutSeconds: { type: "integer", minimum: 1, maximum: 300, default: 300 },
            },
          },
        },
        stopOnError: { type: "boolean", default: true },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    _meta: {
      "io.evavo/effects": ["execute", "write", "network", "repository-mutation", "device-control"],
      "io.evavo/arbitraryCommandTextAccepted": true,
      "io.evavo/inlineCodeAccepted": true,
      "io.evavo/currentWindowsUserAuthority": true,
    },
  },
]);

function asObject(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("arguments must be an object");
  return value;
}

async function callTool(name, raw) {
  const args = asObject(raw);
  if (name === "evavo_windows_execution_doctor") {
    if (Object.keys(args).length) throw new Error("doctor does not accept arguments");
    return doctor();
  }
  if (name === "evavo_windows_execute") return executeOne(args);
  if (name === "evavo_windows_execute_batch") return executeBatch(args);
  throw new Error(`unknown tool: ${name}`);
}

const response = (id, result) => ({ jsonrpc: "2.0", id: id ?? null, result });
const failure = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try { request = JSON.parse(line); } catch { write(failure(null, -32700, "Parse error")); continue; }
  try {
    if (request.method === "notifications/initialized") continue;
    if (request.method === "ping") write(response(request.id, {}));
    else if (request.method === "initialize") {
      write(response(request.id, {
        protocolVersion: request.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: "Chat-facing local Windows shell. Arbitrary command text and inline code are intentionally accepted with the current Windows user's authority. PowerShell, CMD, Bash and Python are supported. The accepted REST Executor source is attested before effects and the loopback runtime is auto-recovered when possible. Interactive calls are capped at 300 seconds; use evavo-local-execution for durable reviewed jobs.",
      }));
    } else if (request.method === "tools/list") write(response(request.id, { tools: TOOLS }));
    else if (request.method === "tools/call") {
      const value = await callTool(String(request.params?.name || ""), request.params?.arguments);
      write(response(request.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: value.ok === false }));
    } else write(failure(request.id, -32601, "Method not found"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(response(request.id, { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, commandTextReturned: false }) }], isError: true }));
  }
}
