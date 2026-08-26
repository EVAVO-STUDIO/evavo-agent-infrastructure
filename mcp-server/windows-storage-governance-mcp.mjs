import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { win32 as path } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const SERVER_NAME = "evavo-windows-storage-governance-mcp";
const SERVER_VERSION = "1.0.1";
const STORAGE_ROOT = process.env.EVAVO_LOCAL_STORAGE_ROOT || "C:\\GitRepos\\evavo-local-storage";
const STATUS = path.join(STORAGE_ROOT, "scripts", "Get-EvavoStorageEstateStatus.ps1");
const ESTATE_ACTIVATE = path.join(STORAGE_ROOT, "scripts", "Invoke-EvavoStorageEstateRestExecutor.ps1");
const GOOGLE_TASK_INSTALL = path.join(STORAGE_ROOT, "scripts", "Install-GoogleStoragePressureTaskCurrent.ps1");

const TOOLS = Object.freeze([
  {
    name: "evavo_storage_governance_doctor",
    description: "Verify the fixed EVAVO Windows storage-governance scripts are present. Performs no scan, move, delete or provider mutation.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { "io.evavo/effects": ["read"], "io.evavo/arbitraryCommandTextAccepted": false },
  },
  {
    name: "evavo_storage_governance_status",
    description: "Read retained storage-estate and Google-pressure receipts plus Task Scheduler state. Performs no storage mutation.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { maximumInventoryAgeHours: { type: "integer", minimum: 1, maximum: 168, default: 12 } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { "io.evavo/effects": ["read"], "io.evavo/arbitraryCommandTextAccepted": false },
  },
  {
    name: "evavo_storage_estate_activate",
    description: "Use the accepted REST Executor v5 facade to install and start the V5 storage-estate scheduled runtime. The long scan/reclaim remains owned by Task Scheduler.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    _meta: { "io.evavo/effects": ["execute", "write", "device-control"], "io.evavo/arbitraryCommandTextAccepted": false },
  },
  {
    name: "evavo_google_storage_pressure_activate",
    description: "Install and start the fixed 85/90/75 Google storage-pressure CycleOnly task. Provider work runs asynchronously under the governed six-hour task budget.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    _meta: { "io.evavo/effects": ["execute", "write", "network", "provider-mutation"], "io.evavo/arbitraryCommandTextAccepted": false },
  },
]);

function asObject(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("arguments must be an object");
  return value;
}

function lastJson(text) {
  const lines = String(text || "").split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].trimStart().startsWith("{")) continue;
    const candidate = lines.slice(index).join("\n").trim();
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch { /* continue */ }
  }
  throw new Error("PowerShell helper returned no JSON receipt");
}

function runPowerShell(script, args = [], timeout = 180_000) {
  if (!existsSync(script)) throw new Error(`fixed storage-governance helper is missing: ${path.basename(script)}`);
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const receipt = lastJson(result.stdout || "");
  if (result.status !== 0) {
    const safeBlocked = receipt.kind === "evavo-storage-estate-snapshot-v5" && receipt.status === "reclaim-blocked-no-safe-archive-destination";
    if (!safeBlocked) {
      const detail = `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(-4000);
      throw new Error(detail || `fixed storage-governance helper failed: ${path.basename(script)}`);
    }
  }
  return receipt;
}

function doctor() {
  const scripts = [STATUS, ESTATE_ACTIVATE, GOOGLE_TASK_INSTALL];
  return {
    schema: "evavo.windows-storage-governance.doctor.v1",
    ok: scripts.every((item) => existsSync(item)),
    server: SERVER_NAME,
    version: SERVER_VERSION,
    fixedHelpersPresent: scripts.every((item) => existsSync(item)),
    tools: TOOLS.map((tool) => tool.name),
    googleCapacityBytes: 15_000_000_000,
    googlePrepareAtBasisPoints: 8500,
    googleTriggerAtBasisPoints: 9000,
    googleTargetBasisPoints: 7500,
    downloadsCapacityBytes: 150_000_000_000,
    downloadsPrepareAtBasisPoints: 8000,
    downloadsTriggerAtBasisPoints: 9000,
    downloadsTargetBasisPoints: 7000,
    gitReposPlanningCeilingBytes: 400_000_000_000,
    beeStationNominalCapacityBytes: 4_000_000_000_000,
    beeStationOperationalFullBytes: 3_500_000_000_000,
    beeStationMinimumReserveBytes: 500_000_000_000,
    arbitraryCommandTextAccepted: false,
    callerSelectedPathAccepted: false,
    credentialValuesReturned: false,
    githubActionsRequired: false,
    vercelRequired: false,
  };
}

function status(args) {
  const hours = args.maximumInventoryAgeHours === undefined ? 12 : Number(args.maximumInventoryAgeHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error("maximumInventoryAgeHours must be 1-168");
  const receipt = runPowerShell(STATUS, ["-MaximumInventoryAgeHours", String(hours)], 45_000);
  if (receipt.kind !== "evavo-storage-estate-status-v5" || receipt.ok !== true || receipt.mutationPerformed !== false) {
    throw new Error("storage-governance status receipt failed admission");
  }
  return { ...receipt, invokedThrough: SERVER_NAME, arbitraryCommandTextAccepted: false };
}

function activateEstate() {
  const receipt = runPowerShell(ESTATE_ACTIVATE, [], 180_000);
  if (receipt.kind !== "evavo-storage-estate-rest-executor-activation-v2" || receipt.ok !== true || receipt.taskInstalled !== true || receipt.taskStarted !== true || receipt.scheduledRuntime !== "v5") {
    throw new Error("storage-estate activation receipt failed admission");
  }
  return { ...receipt, invokedThrough: SERVER_NAME, arbitraryCommandTextAccepted: false };
}

function activateGoogle() {
  const receipt = runPowerShell(GOOGLE_TASK_INSTALL, ["-StartNow"], 90_000);
  if (
    receipt.kind !== "evavo-google-storage-pressure-current-installation-v1" ||
    receipt.ok !== true ||
    receipt.taskExact !== true ||
    receipt.started !== true ||
    receipt.cycleOnlyScheduled !== true ||
    Number(receipt.prepareAtBasisPoints) !== 8500 ||
    Number(receipt.triggerAtBasisPoints) !== 9000 ||
    Number(receipt.targetBasisPoints) !== 7500 ||
    Number(receipt.fallbackQuotaLimitBytes) !== 15_000_000_000 ||
    receipt.overQuotaTriggersReclaim !== true ||
    receipt.archiveBeforeReclaimRequired !== true ||
    receipt.exactAcquisitionRequired !== true ||
    receipt.deepLocalVerificationRequired !== true ||
    receipt.offsiteReplicaRequired !== true ||
    receipt.providerMetadataRereadRequired !== true ||
    receipt.githubActionsRequired !== false
  ) {
    throw new Error("Google storage-pressure activation receipt failed admission");
  }
  return { ...receipt, invokedThrough: SERVER_NAME, arbitraryCommandTextAccepted: false };
}

async function callTool(name, raw) {
  const args = asObject(raw);
  if (name === "evavo_storage_governance_doctor") {
    if (Object.keys(args).length) throw new Error("doctor does not accept arguments");
    return doctor();
  }
  if (name === "evavo_storage_governance_status") return status(args);
  if (name === "evavo_storage_estate_activate") {
    if (Object.keys(args).length) throw new Error("estate activation does not accept arguments");
    return activateEstate();
  }
  if (name === "evavo_google_storage_pressure_activate") {
    if (Object.keys(args).length) throw new Error("Google pressure activation does not accept arguments");
    return activateGoogle();
  }
  throw new Error(`unknown tool: ${name}`);
}

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}
function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return; }
  const id = request.id;
  try {
    if (request.method === "initialize") {
      send(id, {
        protocolVersion: request.params?.protocolVersion || "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    }
    if (request.method === "notifications/initialized") return;
    if (request.method === "ping") { send(id, {}); return; }
    if (request.method === "tools/list") { send(id, { tools: TOOLS }); return; }
    if (request.method === "tools/call") {
      const name = String(request.params?.name || "");
      const value = await callTool(name, request.params?.arguments);
      send(id, { content: [{ type: "text", text: JSON.stringify(value) }], isError: false });
      return;
    }
    sendError(id, -32601, `method not found: ${String(request.method || "")}`);
  } catch (error) {
    if (request.method === "tools/call") {
      send(id, { content: [{ type: "text", text: JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 4000) }) }], isError: true });
    } else {
      sendError(id, -32000, String(error?.message || error).slice(0, 4000));
    }
  }
});
