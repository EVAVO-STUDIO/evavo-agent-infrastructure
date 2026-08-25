import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import process from "node:process";
import { createInterface } from "node:readline";

const COMPUTE_ROOT = "C:\\GitRepos\\evavo-local-compute";
const GLASSES_ROOT = "C:\\GitRepos\\evavo-glasses";
const PYTHON = `${COMPUTE_ROOT}\\.venv\\Scripts\\python.exe`;
const HELPER = `${COMPUTE_ROOT}\\scripts\\execute-prepared-local-request.py`;
const TEMPLATE = `${GLASSES_ROOT}\\config\\local-execution\\godmode-android-tab-a.prepare.json`;
const MAX_OUTPUT = 1024 * 1024;
const TIMEOUT_MS = 55 * 60 * 1000;

const TOOLS = Object.freeze([
  {
    name: "evavo_glasses_tab_a_acceptance",
    description: "Run the durable clean-main EVAVO Glasses Android 0.6.4 physical acceptance on exactly one authorised connected Android device: build/unit-test/AAPT2 verify, install/update, launch, evidence and crash/ANR health gate. The reviewed script additionally requires API 26+, BLE and the Android Bridge glasses compatibility gate.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
]);

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("arguments must be an object");
  return value;
}

async function requireFile(path, maximumBytes = 1024 * 1024) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximumBytes) {
    throw new Error("reviewed durable execution file failed admission");
  }
  return stat;
}

function localExecutionEnvironment() {
  const env = {};
  for (const key of ["PATH", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "PROGRAMFILES", "ProgramFiles", "ProgramFiles(x86)", "SYSTEMROOT", "WINDIR", "COMSPEC", "USERNAME", "FNM_DIR", "COREPACK_HOME", "PNPM_HOME", "NPM_CONFIG_CACHE", "npm_config_cache", "ANDROID_SDK_ROOT", "ANDROID_HOME", "JAVA_HOME"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  env.PYTHONPATH = `${COMPUTE_ROOT}\\src`;
  env.EVAVO_LOCAL_EXECUTION_PREPARE_ENABLED = "enabled";
  env.EVAVO_LOCAL_EXECUTION_MCP_ENABLED = "enabled";
  env.EVAVO_LOCAL_EXECUTION_ENABLED = "enabled";
  env.EVAVO_LOCAL_NETWORK_ENABLED = "enabled";
  env.EVAVO_LOCAL_SCRIPT_EXECUTION_ENABLED = "enabled";
  env.EVAVO_LOCAL_REPOSITORY_CODE_ENABLED = "enabled";
  env.EVAVO_LOCAL_FILESYSTEM_WRITE_ENABLED = "enabled";
  env.EVAVO_LOCAL_GIT_MUTATION_ENABLED = "disabled";
  env.EVAVO_LOCAL_CONTAINER_ENABLED = "disabled";
  env.EVAVO_LOCAL_ARCHIVE_ENABLED = "disabled";
  env.EVAVO_LOCAL_EXECUTION_ALLOWED_ROOTS = ["C:\\GitRepos", process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\EVAVO` : null, process.env.USERPROFILE ? `${process.env.USERPROFILE}\\Downloads` : null].filter(Boolean).join(";");
  env.EVAVO_COMPUTE_ALLOWED_ROOTS = env.EVAVO_LOCAL_EXECUTION_ALLOWED_ROOTS;
  return env;
}

async function runDurableAcceptance() {
  if (process.platform !== "win32") throw new Error("Galaxy Tab A physical acceptance requires Windows");
  await Promise.all([requireFile(PYTHON, 64 * 1024 * 1024), requireFile(HELPER), requireFile(TEMPLATE)]);
  const templateBytes = await readFile(TEMPLATE);
  const templateSha256 = createHash("sha256").update(templateBytes).digest("hex");

  const child = spawn(PYTHON, [HELPER, "--document", TEMPLATE, "--expected-document-sha256", templateSha256], {
    cwd: COMPUTE_ROOT,
    env: localExecutionEnvironment(),
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderrBytes = 0;
  let stdoutBytes = 0;
  const append = (chunk, kind) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    const bytes = Buffer.byteLength(text);
    if (kind === "stdout") {
      stdoutBytes += bytes;
      if (stdoutBytes <= MAX_OUTPUT) stdout += text;
    } else {
      stderrBytes += bytes;
    }
  };
  child.stdout.on("data", (chunk) => append(chunk, "stdout"));
  child.stderr.on("data", (chunk) => append(chunk, "stderr"));

  const outcome = await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error("durable Galaxy Tab A acceptance exceeded the reviewed 55-minute outer bound"));
    }, TIMEOUT_MS);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  if (stdoutBytes > MAX_OUTPUT) throw new Error("durable Galaxy Tab A acceptance output exceeded the reviewed MCP bound");
  let value;
  try { value = asObject(JSON.parse(stdout.trim())); } catch { throw new Error("durable Galaxy Tab A acceptance returned invalid JSON"); }
  if (outcome.code !== 0 || value.ok !== true) throw new Error("durable Galaxy Tab A acceptance failed on the workstation");
  if (value.kind !== "evavo-prepared-local-execution-run-v1" || value.receiptPathsReturned !== false || value.runtimePathsReturned !== false || value.rawProcessOutputReturned !== false) {
    throw new Error("durable local execution receipt privacy contract mismatch");
  }
  const acceptance = asObject(value.acceptance);
  if (acceptance.schema !== "evavo_glasses_android_tab_a_acceptance_v1" || acceptance.ok !== true || acceptance.physicalDeviceExecutionClaimed !== true) {
    throw new Error("Galaxy Tab A acceptance identity or physical-execution truth mismatch");
  }
  if (acceptance.systemPackageMutationAllowed !== false || acceptance.arbitraryAdbShellUsed !== false || acceptance.bluetoothUsedAsAdbTransport !== false) {
    throw new Error("Galaxy Tab A acceptance authority boundary mismatch");
  }
  if (acceptance.runtimeDiagnostics?.analysis?.crashedOrAnrObserved === true || acceptance.runtimeDiagnostics?.running !== true) {
    throw new Error("Galaxy Tab A acceptance did not finish with a healthy running app");
  }
  return {
    ...value,
    stderrBytes,
    executor: {
      schema: "evavo.glasses-tab-a-durable-mcp.v1",
      durableLocalExecution: true,
      reviewedTemplateSha256: templateSha256,
      exactSingleAuthorisedDeviceRequired: true,
      callerSuppliedTargetRefAccepted: false,
      callerSuppliedCommandAccepted: false,
      callerSuppliedPackageAccepted: false,
      callerSuppliedApkAccepted: false,
      systemPackageMutationAllowed: false,
      arbitraryAdbShellAccepted: false,
      bluetoothUsedAsAdbTransport: false,
      physicalWorkstationPathsReturned: false,
    },
  };
}

async function callTool(name, raw) {
  const args = raw === undefined ? {} : asObject(raw);
  if (Object.keys(args).length) throw new Error("Galaxy Tab A acceptance does not accept caller-supplied arguments");
  if (name === "evavo_glasses_tab_a_acceptance") return runDurableAcceptance();
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
    else if (request.method === "initialize") write(result(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "evavo-glasses-tab-a-mcp", version: "1.0.0" } }));
    else if (request.method === "tools/list") write(result(request.id, { tools: TOOLS }));
    else if (request.method === "tools/call") {
      const params = asObject(request.params);
      const value = await callTool(String(params.name ?? ""), params.arguments);
      write(result(request.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: false }));
    } else write(error(request.id, -32601, "Method not found"));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown error";
    write(result(request.id, { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message, physicalPathsReturned: false, arbitraryCommandAccepted: false }) }], isError: true }));
  }
}
