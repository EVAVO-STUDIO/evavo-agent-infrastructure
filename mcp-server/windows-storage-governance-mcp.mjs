import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { win32 as path } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

import { classifyReceiptTruth } from "./control-policy-core.mjs";

const SERVER_NAME = "evavo-windows-storage-governance-mcp";
const SERVER_VERSION = "1.3.0";
const STORAGE_ROOT = process.env.EVAVO_LOCAL_STORAGE_ROOT || "C:\\GitRepos\\evavo-local-storage";
const LOCAL_COMPUTE_ROOT = process.env.EVAVO_LOCAL_COMPUTE_ROOT || "C:\\GitRepos\\evavo-local-compute";
const STATUS = path.join(STORAGE_ROOT, "scripts", "Get-EvavoStorageEstateStatus.ps1");
const ESTATE_ACTIVATE = path.join(STORAGE_ROOT, "scripts", "Invoke-EvavoStorageEstateRestExecutor.ps1");
const GOOGLE_TASK_INSTALL = path.join(STORAGE_ROOT, "scripts", "Install-GoogleStoragePressureTaskCurrent.ps1");
const STORAGE_RECOVERY_CURRENT = path.join(LOCAL_COMPUTE_ROOT, "RECOVER-EVAVO-STORAGE-CURRENT.ps1");
const EXECUTION_CONTROL_STATUS = path.join(LOCAL_COMPUTE_ROOT, "scripts", "Get-EvavoStorageExecutionControlPlaneStatus.ps1");

const TOOLS = Object.freeze([
  {
    name: "evavo_storage_governance_doctor",
    description: "Verify the fixed EVAVO Windows storage-governance and execution-control scripts are present. Performs no scan, move, delete or provider mutation.",
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
    name: "evavo_storage_execution_status",
    description: "Read the paired local-command and GitHub local-execution consumer state. Consumer readiness requires a fresh startup heartbeat plus a successful scheduled run; task presence alone is never accepted as execution proof.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { maximumHeartbeatAgeSeconds: { type: "integer", minimum: 30, maximum: 3600, default: 300 } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { "io.evavo/effects": ["read"], "io.evavo/arbitraryCommandTextAccepted": false },
  },
  {
    name: "evavo_storage_recovery_current",
    description: "Run the authoritative serialized current storage recovery: repair current local execution persistence, run one governed Google 85/90/75 cycle, then one V5 storage-estate cycle, and require fresh retained receipts. Accepts no caller-selected paths, commands, credentials or thresholds.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    _meta: { "io.evavo/effects": ["execute", "write", "network", "provider-mutation", "device-control"], "io.evavo/arbitraryCommandTextAccepted": false },
  },
  {
    name: "evavo_storage_estate_activate",
    description: "Use the accepted REST Executor v5 facade to install and start the V5 storage-estate scheduled runtime. Prefer evavo_storage_recovery_current for end-to-end recovery because it serializes Google then estate and proves fresh receipts.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    _meta: { "io.evavo/effects": ["execute", "write", "device-control"], "io.evavo/arbitraryCommandTextAccepted": false },
  },
  {
    name: "evavo_google_storage_pressure_activate",
    description: "Install and start the fixed 85/90/75 Google storage-pressure CycleOnly task. Prefer evavo_storage_recovery_current for end-to-end recovery because it serializes Google then estate and proves fresh receipts.",
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
  return null;
}

function explicitNoEffect(receipt) {
  return Boolean(
    receipt &&
    receipt.mutationPerformed === false &&
    receipt.providerMutationPerformed !== true &&
    receipt.executionPerformed !== true &&
    receipt.deviceControlPerformed !== true,
  );
}

function receiptAdvice(receipt, { processMayHaveStarted = true } = {}) {
  const hasCanonicalFacts = Boolean(
    receipt &&
    typeof receipt.physicalEffectState === "string" &&
    typeof receipt.sideEffectMayHaveCommitted === "boolean" &&
    typeof receipt.postconditionVerified === "boolean" &&
    typeof receipt.intentPersisted === "boolean" &&
    typeof receipt.terminalReceiptPersisted === "boolean",
  );
  if (hasCanonicalFacts) {
    return classifyReceiptTruth({
      physicalEffectState: receipt.physicalEffectState,
      sideEffectMayHaveCommitted: receipt.sideEffectMayHaveCommitted,
      postconditionVerified: receipt.postconditionVerified,
      intentPersisted: receipt.intentPersisted,
      terminalReceiptPersisted: receipt.terminalReceiptPersisted,
      reconciliationRequired: receipt.reconciliationRequired === true,
    });
  }
  if (explicitNoEffect(receipt)) {
    return classifyReceiptTruth({
      physicalEffectState: "verified_not_committed",
      sideEffectMayHaveCommitted: false,
      postconditionVerified: false,
      intentPersisted: false,
      terminalReceiptPersisted: Boolean(receipt),
      reconciliationRequired: false,
    });
  }
  return {
    schemaVersion: 1,
    kind: "evavo-control-receipt-advice-v1",
    disposition: processMayHaveStarted ? "reconcile-before-retry" : "retry-safe-no-effect",
    operationSucceeded: false,
    retryUnderlyingAction: !processMayHaveStarted,
    requestReplaySafe: !processMayHaveStarted,
    reconciliationRequired: processMayHaveStarted,
    physicalEffectState: processMayHaveStarted ? "unknown_after_process_dispatch" : "not_attempted",
    sideEffectMayHaveCommitted: processMayHaveStarted,
    postconditionVerified: false,
    intentPersisted: false,
    terminalReceiptPersisted: Boolean(receipt),
    execute: false,
    reason: processMayHaveStarted
      ? "helper-or-transport-failed-after-process-dispatch-without-canonical-effect-proof"
      : "process-was-proven-not-started",
    rule: "Never infer physical failure from a helper exit, transport error, or receipt error after execution may have begun.",
  };
}

class ReceiptExecutionError extends Error {
  constructor(message, { receipt = null, exitCode = null, processMayHaveStarted = true, helper = null, detail = null } = {}) {
    super(message);
    this.name = "ReceiptExecutionError";
    this.receipt = receipt;
    this.exitCode = exitCode;
    this.processMayHaveStarted = processMayHaveStarted;
    this.helper = helper;
    this.detail = detail;
    this.receiptAdvice = receiptAdvice(receipt, { processMayHaveStarted });
  }

  asObject() {
    return {
      ok: false,
      kind: "evavo-windows-storage-governance-receipt-error-v1",
      error: this.message.slice(0, 4000),
      helper: this.helper,
      exitCode: this.exitCode,
      processMayHaveStarted: this.processMayHaveStarted,
      receiptObserved: Boolean(this.receipt),
      receipt: this.receipt,
      receiptAdvice: this.receiptAdvice,
      retryUnderlyingAction: this.receiptAdvice.retryUnderlyingAction === true,
      reconciliationRequired: this.receiptAdvice.reconciliationRequired === true,
      arbitraryCommandTextAccepted: false,
    };
  }
}

function runPowerShell(script, args = [], timeout = 180_000) {
  if (!existsSync(script)) {
    throw new ReceiptExecutionError(`fixed storage-governance helper is missing: ${path.basename(script)}`, {
      processMayHaveStarted: false,
      helper: path.basename(script),
    });
  }
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  const receipt = lastJson(result.stdout || "");
  if (result.error) {
    const processMayHaveStarted = result.error?.code !== "ENOENT";
    throw new ReceiptExecutionError(String(result.error.message || result.error), {
      receipt,
      exitCode: result.status,
      processMayHaveStarted,
      helper: path.basename(script),
      detail: `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(-4000),
    });
  }
  if (!receipt) {
    throw new ReceiptExecutionError("PowerShell helper returned no JSON receipt", {
      exitCode: result.status,
      processMayHaveStarted: true,
      helper: path.basename(script),
      detail: `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(-4000),
    });
  }
  if (result.status !== 0) {
    const safeBlocked = receipt.kind === "evavo-storage-estate-snapshot-v5" && receipt.status === "reclaim-blocked-no-safe-archive-destination";
    if (!safeBlocked) {
      const detail = `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(-4000);
      throw new ReceiptExecutionError(detail || `fixed storage-governance helper failed: ${path.basename(script)}`, {
        receipt,
        exitCode: result.status,
        processMayHaveStarted: true,
        helper: path.basename(script),
        detail,
      });
    }
  }
  return receipt;
}

function doctor() {
  const scripts = [STATUS, EXECUTION_CONTROL_STATUS, ESTATE_ACTIVATE, GOOGLE_TASK_INSTALL, STORAGE_RECOVERY_CURRENT];
  return {
    schema: "evavo.windows-storage-governance.doctor.v4",
    ok: scripts.every((item) => existsSync(item)),
    server: SERVER_NAME,
    version: SERVER_VERSION,
    fixedHelpersPresent: scripts.every((item) => existsSync(item)),
    preferredRecoveryTool: "evavo_storage_recovery_current",
    executionStatusTool: "evavo_storage_execution_status",
    tools: TOOLS.map((tool) => tool.name),
    receiptTruthPreservedAcrossNonzeroExit: true,
    unknownPostDispatchEffectRequiresReconciliation: true,
    blindRetryAfterUnknownEffectAllowed: false,
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
    throw new ReceiptExecutionError("storage-governance status receipt failed admission", {
      receipt,
      exitCode: 0,
      processMayHaveStarted: false,
      helper: path.basename(STATUS),
    });
  }
  return { ...receipt, invokedThrough: SERVER_NAME, arbitraryCommandTextAccepted: false };
}

function executionStatus(args) {
  const seconds = args.maximumHeartbeatAgeSeconds === undefined ? 300 : Number(args.maximumHeartbeatAgeSeconds);
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 3600) throw new Error("maximumHeartbeatAgeSeconds must be 30-3600");
  const receipt = runPowerShell(EXECUTION_CONTROL_STATUS, ["-MaximumHeartbeatAgeSeconds", String(seconds)], 30_000);
  if (
    receipt.kind !== "evavo-storage-execution-control-plane-status-v1" ||
    receipt.ok !== true ||
    receipt.taskPresenceIsNotConsumerProof !== true ||
    receipt.freshHeartbeatAndSuccessfulTaskRunRequired !== true ||
    receipt.mutationPerformed !== false ||
    receipt.networkPerformed !== false ||
    receipt.providerMutationPerformed !== false ||
    receipt.githubActionsRequired !== false ||
    receipt.vercelRequired !== false ||
    receipt.mailboxRequired !== false
  ) {
    throw new ReceiptExecutionError("storage execution-control status receipt failed admission", {
      receipt,
      exitCode: 0,
      processMayHaveStarted: false,
      helper: path.basename(EXECUTION_CONTROL_STATUS),
    });
  }
  return { ...receipt, invokedThrough: SERVER_NAME, arbitraryCommandTextAccepted: false };
}

function recoverCurrent() {
  const receipt = runPowerShell(STORAGE_RECOVERY_CURRENT, ["-FleetRoot", "C:\\GitRepos", "-Unattended"], 7_500_000);
  if (
    receipt.kind !== "evavo-storage-current-recovery-v5" ||
    Number(receipt.schemaVersion) !== 5 ||
    receipt.ok !== true ||
    receipt.unattended !== true ||
    receipt.guardianInstallationPerformed !== false ||
    receipt.localCommandQueueRequired !== true ||
    receipt.storageRecoveryCurrentOperationRequired !== true ||
    receipt.currentMainFabricAcceptancePassed !== true ||
    receipt.singleImmediateStorageCycleOwner !== true ||
    receipt.googleCycleCompletedBeforeEstateCycle !== true ||
    receipt.duplicateForceCyclesPerformed !== false ||
    receipt.estateFreshReceiptProven !== true ||
    receipt.googleFreshReceiptProven !== true ||
    receipt.completeQuotaMeasurementRequiredForTargetClaim !== true ||
    receipt.driveLowerBoundMayTriggerReclaim !== true ||
    receipt.driveLowerBoundMayCertifyWholeAccountTarget !== false ||
    Number(receipt.googleCapacityBytes) !== 15_000_000_000 ||
    Number(receipt.downloadsCapacityBytes) !== 150_000_000_000 ||
    Number(receipt.gitReposPlanningCeilingBytes) !== 400_000_000_000 ||
    Number(receipt.beeStationNominalCapacityBytes) !== 4_000_000_000_000 ||
    Number(receipt.beeStationOperationalFullBytes) !== 3_500_000_000_000 ||
    receipt.githubActionsRequired !== false ||
    receipt.vercelRequired !== false ||
    receipt.mailboxRequired !== false
  ) {
    throw new ReceiptExecutionError("serialized current storage recovery receipt failed admission", {
      receipt,
      exitCode: 0,
      processMayHaveStarted: true,
      helper: path.basename(STORAGE_RECOVERY_CURRENT),
    });
  }
  return {
    ...receipt,
    invokedThrough: SERVER_NAME,
    preferredRecoveryPath: true,
    arbitraryCommandTextAccepted: false,
    callerSelectedPathAccepted: false,
    credentialValuesReturned: false,
  };
}

function activateEstate() {
  const receipt = runPowerShell(ESTATE_ACTIVATE, [], 180_000);
  if (receipt.kind !== "evavo-storage-estate-rest-executor-activation-v2" || receipt.ok !== true || receipt.taskInstalled !== true || receipt.taskStarted !== true || receipt.scheduledRuntime !== "v5") {
    throw new ReceiptExecutionError("storage-estate activation receipt failed admission", {
      receipt,
      exitCode: 0,
      processMayHaveStarted: true,
      helper: path.basename(ESTATE_ACTIVATE),
    });
  }
  return { ...receipt, invokedThrough: SERVER_NAME, preferredRecoveryPath: false, arbitraryCommandTextAccepted: false };
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
    throw new ReceiptExecutionError("Google storage-pressure activation receipt failed admission", {
      receipt,
      exitCode: 0,
      processMayHaveStarted: true,
      helper: path.basename(GOOGLE_TASK_INSTALL),
    });
  }
  return { ...receipt, invokedThrough: SERVER_NAME, preferredRecoveryPath: false, arbitraryCommandTextAccepted: false };
}

async function callTool(name, raw) {
  const args = asObject(raw);
  if (name === "evavo_storage_governance_doctor") {
    if (Object.keys(args).length) throw new Error("doctor does not accept arguments");
    return doctor();
  }
  if (name === "evavo_storage_governance_status") return status(args);
  if (name === "evavo_storage_execution_status") return executionStatus(args);
  if (name === "evavo_storage_recovery_current") {
    if (Object.keys(args).length) throw new Error("current storage recovery does not accept arguments");
    return recoverCurrent();
  }
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
      send(id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError: false });
      return;
    }
    sendError(id, -32601, `method not found: ${String(request.method || "")}`);
  } catch (error) {
    if (request.method === "tools/call") {
      const payload = error instanceof ReceiptExecutionError
        ? error.asObject()
        : {
            ok: false,
            kind: "evavo-windows-storage-governance-error-v1",
            error: String(error?.message || error).slice(0, 4000),
            receiptObserved: false,
            retryUnderlyingAction: false,
            reconciliationRequired: true,
            arbitraryCommandTextAccepted: false,
          };
      send(id, {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
        isError: true,
      });
    } else {
      sendError(id, -32000, String(error?.message || error).slice(0, 4000));
    }
  }
});