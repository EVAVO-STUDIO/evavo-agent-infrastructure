import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const MAX_OUTPUT = 2 * 1024 * 1024;
const readonly = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const TOOLS = Object.freeze([
  {
    name: "evavo_workstation_observer_status",
    description: "Read the EVAVO Windows zero-cost automation, recovery profile and accepted REST recovery installation state. No repair or mutation.",
    annotations: readonly,
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "evavo_workstation_observer_relay",
    description: "Read local outbound remote-MCP relay client configuration/task state without returning endpoint tokens or credential values.",
    annotations: readonly,
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "evavo_workstation_observer_rest_health",
    description: "Read the loopback-only REST Executor v5 health endpoint after accepted-source policy checks. No command execution.",
    annotations: readonly,
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
]);

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("value must be an object");
  return value;
}

function localStorageRoots() {
  const local = process.env.LOCALAPPDATA ?? "";
  const git = process.env.EVAVO_GIT_ROOT ?? "C:\\GitRepos";
  return [
    join(local, "EVAVO", "WorkerControlPlane", "zero-cost-updater", "runtime", "evavo-local-storage"),
    join(local, "EVAVO", "WorkerControlPlane", "zero-cost-recovery", "runtime", "evavo-local-storage"),
    join(local, "EVAVO", "WorkerControlPlane", "zero-cost-logon-guardian", "runtime", "evavo-local-storage"),
    join(git, "evavo-local-storage"),
  ];
}

function resolveLocalStorage() {
  for (const root of localStorageRoots()) {
    if (existsSync(join(root, "scripts", "Get-EvavoZeroCostWorkerAutomationStatus.ps1"))) return root;
  }
  throw new Error("EVAVO Local Storage read-only observer source is unavailable");
}

function run(script, args = [], timeout = 90000) {
  const root = resolveLocalStorage();
  const scriptPath = join(root, script);
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout,
    maxBuffer: MAX_OUTPUT,
    env: process.env,
  });
  if (result.error || result.status !== 0) throw new Error("read-only workstation observer command failed");
  const text = String(result.stdout ?? "").trim();
  let value;
  try { value = object(JSON.parse(text)); }
  catch { throw new Error("read-only workstation observer returned invalid JSON"); }
  return {
    ...value,
    observer: {
      schema: "evavo.workstation-observer.v1",
      readOnly: true,
      mutationAuthority: false,
      arbitraryShellAccepted: false,
      credentialValuesReturned: false,
      physicalExecutionClaimed: false,
    },
  };
}

function status() {
  const value = run("scripts\\Get-EvavoZeroCostWorkerAutomationStatus.ps1");
  return {
    schemaVersion: 1,
    kind: "evavo-workstation-observer-status",
    ok: value.ok === true,
    minimumTwoPlaneAutomationHealthy: value.minimumTwoPlaneAutomationHealthy === true,
    threePlaneRecoveryInstalled: value.threePlaneRecoveryInstalled === true,
    recovery: value.recovery ?? null,
    updater: value.updater ?? null,
    restExecutor: value.restExecutor ?? null,
    physicalAcceptanceClaimed: false,
    observer: value.observer,
  };
}

function relay() {
  const local = process.env.LOCALAPPDATA ?? "";
  const base = join(local, "EVAVO", "WorkerControlPlane", "remote-mcp-relay");
  const configPath = join(base, "client.json");
  const launcher = join(base, "run-remote-mcp-relay-client.ps1");
  const token = join(base, "workstation-token.dpapi");
  const root = resolveLocalStorage();
  const policy = join(root, "config", "remote-mcp-relay.json");
  const taskProbe = `Get-ScheduledTask -TaskName 'EVAVO Remote MCP Relay Client' -ErrorAction SilentlyContinue | Select-Object TaskName,State | ConvertTo-Json -Compress`;
  const task = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", taskProbe], { encoding: "utf8", shell: false, windowsHide: true, timeout: 15000, maxBuffer: 65536 });
  let taskState = "NotInstalled";
  if (!task.error && task.status === 0 && String(task.stdout ?? "").trim()) {
    try { taskState = String(object(JSON.parse(String(task.stdout).trim())).State ?? "Unknown"); } catch { taskState = "Unknown"; }
  }
  return {
    schemaVersion: 1,
    kind: "evavo-workstation-observer-relay",
    ok: existsSync(policy),
    policyPresent: existsSync(policy),
    clientConfigured: existsSync(configPath),
    integrityLauncherPresent: existsSync(launcher),
    dpapiTokenPresent: existsSync(token),
    taskState,
    tokenValueReturned: false,
    endpointValueReturned: false,
    cloudConnectionClaimed: false,
    readOnly: true,
    mutationAuthority: false,
  };
}

function restHealth() {
  const root = resolveLocalStorage();
  const script = join(root, "scripts", "Invoke-EvavoRestExecutor.ps1");
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Health", "-BaseUrl", "http://localhost:5000", "-TimeoutSeconds", "10"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 65536,
    env: process.env,
  });
  if (result.error || result.status !== 0) return { schemaVersion: 1, kind: "evavo-workstation-observer-rest-health", ok: false, reachable: false, readOnly: true, mutationAuthority: false };
  const value = object(JSON.parse(String(result.stdout ?? "").trim()));
  return {
    schemaVersion: 1,
    kind: "evavo-workstation-observer-rest-health",
    ok: value.status === "healthy" && value.version === "5.0.0" && Number(value.api_revision ?? 0) >= 2,
    reachable: true,
    status: value.status,
    version: value.version,
    apiRevision: Number(value.api_revision ?? 0),
    loopbackOnly: true,
    commandExecuted: false,
    readOnly: true,
    mutationAuthority: false,
  };
}

async function callTool(name, raw) {
  const args = raw === undefined ? {} : object(raw);
  if (Object.keys(args).length) throw new Error("workstation observer tools accept no arguments");
  if (name === "evavo_workstation_observer_status") return status();
  if (name === "evavo_workstation_observer_relay") return relay();
  if (name === "evavo_workstation_observer_rest_health") return restHealth();
  throw new Error(`unknown tool: ${name}`);
}

const result = (id, value) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const error = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const write = value => process.stdout.write(`${JSON.stringify(value)}\n`);

for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try { request = JSON.parse(line); }
  catch { write(error(null, -32700, "Parse error")); continue; }
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") { write(error(request.id, -32600, "Invalid request")); continue; }
  try {
    if (request.method === "notifications/initialized") continue;
    if (request.method === "ping") write(result(request.id, {}));
    else if (request.method === "initialize") write(result(request.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "evavo-workstation-observer-mcp", version: "1.0.0" },
      instructions: "Read-only EVAVO Windows workstation recovery and relay observer. It cannot repair, bootstrap, execute commands, mutate files, reveal credentials, or assert physical execution without evidence.",
    }));
    else if (request.method === "tools/list") write(result(request.id, { tools: TOOLS }));
    else if (request.method === "tools/call") {
      const params = object(request.params);
      const value = await callTool(String(params.name ?? ""), params.arguments);
      write(result(request.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: false }));
    } else write(error(request.id, -32601, "Method not found"));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown error";
    write(result(request.id, { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, readOnly: true, mutationAuthority: false, credentialValuesReturned: false }) }], isError: true }));
  }
}
