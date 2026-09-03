import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { win32 as path } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";

const SERVER_NAME = "evavo-windows-physical-control-status";
const SERVER_VERSION = "1.4.0";
const LOCAL_COMPUTE_ROOT = process.env.EVAVO_LOCAL_COMPUTE_ROOT || "C:\\GitRepos\\evavo-local-compute";
const LOCAL_STORAGE_ROOT = process.env.EVAVO_LOCAL_STORAGE_ROOT || "C:\\GitRepos\\evavo-local-storage";
const PHYSICAL_SCRIPT = path.join(LOCAL_COMPUTE_ROOT, "scripts", "Get-EvavoWindowsPhysicalControlStatusCurrentV3.ps1");
const AUTOMATION_SCRIPT = path.join(LOCAL_STORAGE_ROOT, "scripts", "Get-EvavoZeroCostWorkerAutomationStatusV4.ps1");

const PHYSICAL_TOOL = Object.freeze({
  name: "evavo_windows_physical_control_status",
  description: "Read one non-mutating status receipt for the canonical same-user Python queue resident, its non-consuming watchdog, Workstation Manager heavy-work admission, legacy compatibility lanes, singleton-gateway evidence and latest terminal job physical truth. Terminal outcome claims require canonical digest validation; task presence and process exit alone are never outcome proof.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      queueFreshSeconds: { type: "integer", minimum: 30, maximum: 3600, default: 300 },
      controlFreshSeconds: { type: "integer", minimum: 30, maximum: 3600, default: 300 },
      supervisorFreshSeconds: { type: "integer", minimum: 60, maximum: 7200, default: 600 },
      ingressFreshSeconds: { type: "integer", minimum: 60, maximum: 7200, default: 900 },
      gatewayFreshSeconds: { type: "integer", minimum: 60, maximum: 14400, default: 1800 },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: {
    "io.evavo/effects": ["read"],
    "io.evavo/arbitraryCommandTextAccepted": false,
    "io.evavo/inlineCodeAccepted": false,
    "io.evavo/canonicalQueueAuthority": "hkcu_run_python",
    "io.evavo/watchdogConsumesQueue": false,
    "io.evavo/taskPresenceIsNotLivenessProof": true,
    "io.evavo/processSuccessIsNotPhysicalPostconditionProof": true,
    "io.evavo/terminalReceiptDigestValidationRequired": true,
    "io.evavo/githubActionsRequired": false,
    "io.evavo/vercelRequired": false,
    "io.evavo/paidComputeRequired": false,
  },
});

const AUTOMATION_TOOL = Object.freeze({
  name: "evavo_zero_cost_automation_status",
  description: "Read the non-mutating zero-cost worker automation status, joining scheduled recovery/updater evidence with fresh canonical Local Compute physical status, a freshness-bounded persisted recovery receipt, and a freshness-bounded updater fallback. Task presence and stale receipts never prove liveness.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      recoveryReceiptFreshSeconds: { type: "integer", minimum: 60, maximum: 1800, default: 600 },
      updaterFallbackFreshSeconds: { type: "integer", minimum: 60, maximum: 1800, default: 300 },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: {
    "io.evavo/effects": ["read"],
    "io.evavo/arbitraryCommandTextAccepted": false,
    "io.evavo/inlineCodeAccepted": false,
    "io.evavo/canonicalQueueAuthority": "hkcu_run_python",
    "io.evavo/taskPresenceIsNotLivenessProof": true,
    "io.evavo/staleRecoveryReceiptCannotProveLiveness": true,
    "io.evavo/staleUpdaterReceiptCannotProveLiveness": true,
    "io.evavo/githubActionsRequired": false,
    "io.evavo/vercelRequired": false,
    "io.evavo/paidComputeRequired": false,
  },
});

function asInt(value, fallback, min, max, name) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be ${min}-${max}`);
  return number;
}
function lastJson(text) {
  const lines = String(text || "").split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].trimStart().startsWith("{")) continue;
    try {
      const value = JSON.parse(lines.slice(index).join("\n").trim());
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch { /* continue */ }
  }
  return null;
}
function runPowerShell(script, args, label) {
  if (!existsSync(script)) throw new Error(`${label} helper is missing`);
  const child = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args,
  ], { encoding: "utf8", windowsHide: true, shell: false, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  if (child.error) throw new Error(`${label} helper failed to start: ${child.error.message}`);
  const receipt = lastJson(child.stdout || "");
  if (child.status !== 0 || !receipt) throw new Error(`${label} helper returned no admitted receipt`);
  return receipt;
}
function runPhysicalStatus(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("arguments must be an object");
  const allowed = new Set(["queueFreshSeconds", "controlFreshSeconds", "supervisorFreshSeconds", "ingressFreshSeconds", "gatewayFreshSeconds"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`unknown argument: ${key}`);
  const values = {
    queueFreshSeconds: asInt(raw.queueFreshSeconds, 300, 30, 3600, "queueFreshSeconds"),
    controlFreshSeconds: asInt(raw.controlFreshSeconds, 300, 30, 3600, "controlFreshSeconds"),
    supervisorFreshSeconds: asInt(raw.supervisorFreshSeconds, 600, 60, 7200, "supervisorFreshSeconds"),
    ingressFreshSeconds: asInt(raw.ingressFreshSeconds, 900, 60, 7200, "ingressFreshSeconds"),
    gatewayFreshSeconds: asInt(raw.gatewayFreshSeconds, 1800, 60, 14400, "gatewayFreshSeconds"),
  };
  const receipt = runPowerShell(PHYSICAL_SCRIPT, [
    "-QueueFreshSeconds", String(values.queueFreshSeconds),
    "-ControlFreshSeconds", String(values.controlFreshSeconds),
    "-SupervisorFreshSeconds", String(values.supervisorFreshSeconds),
    "-IngressFreshSeconds", String(values.ingressFreshSeconds),
    "-GatewayFreshSeconds", String(values.gatewayFreshSeconds),
    "-Json",
  ], "physical-control status v3");
  if (
    Number(receipt.schemaVersion) !== 3 ||
    receipt.kind !== "evavo-windows-physical-control-status-current-v3" ||
    receipt.ok !== true ||
    receipt.canonicalQueueAuthority !== "hkcu_run_python" ||
    receipt.legacyScheduledQueueConsumersAuthoritative !== false ||
    receipt.singleNormalQueueConsumerRequired !== true ||
    receipt.watchdogConsumesQueue !== false ||
    receipt.routeLivenessSeparatedFromJobOutcome !== true ||
    receipt.terminalJobReceiptRequiredForOutcomeClaim !== true ||
    receipt.terminalReceiptDigestValidationRequired !== true ||
    receipt.processSuccessIsNotPhysicalPostconditionProof !== true ||
    receipt.taskPresenceIsNotLivenessProof !== true ||
    receipt.scheduledTaskStartIsNotOutcomeProof !== true ||
    receipt.freshReceiptRequired !== true ||
    receipt.routeHealthIsObservationNotExecutionAuthority !== true ||
    receipt.verificationHelperReadOnly !== true ||
    receipt.admissionProbeReadOnly !== true ||
    receipt.processExecutionFieldRepresentsEffectfulWork !== true ||
    receipt.mutationPerformed !== false ||
    receipt.providerMutationPerformed !== false ||
    receipt.taskMutationPerformed !== false ||
    receipt.processExecutionPerformed !== false ||
    receipt.networkPerformed !== false ||
    receipt.githubActionsRequired !== false ||
    receipt.selfHostedActionsRunnerRequired !== false ||
    receipt.vercelRequired !== false ||
    receipt.paidComputeRequired !== false ||
    receipt.credentialValuesReturned !== false ||
    receipt.physicalPathsReturned !== false
  ) throw new Error("physical-control status v3 receipt failed admission");
  const resident = receipt.canonicalRoutes?.pythonResident;
  const watchdog = receipt.canonicalRoutes?.watchdog;
  if (!resident || resident.authority !== "canonical-normal-queue-consumer") throw new Error("canonical Python resident status is missing");
  if (!watchdog || watchdog.authority !== "non-consuming-liveness-guard" || watchdog.queueConsumedByWatchdog !== false) throw new Error("canonical watchdog status is missing or unsafe");
  const admission = receipt.heavyWorkAdmission;
  if (!admission || admission.observationOnly !== true || admission.grantsExecutionAuthority !== false || !["allow", "defer", "unknown"].includes(String(admission.disposition || ""))) {
    throw new Error("heavy-work admission projection failed admission");
  }
  const latest = receipt.latestTerminalJob;
  if (latest?.present === true) {
    if (
      latest.structurallyAccepted !== true || latest.outcomeClaimAdmissible !== true || latest.receiptDigestValid !== true ||
      latest.receiptDigestValidation !== "validated-by-canonical-python-verifier" || latest.physicalTruthFieldsPresent !== true ||
      Number(latest.receiptSemanticsVersion) < 2 || latest.automaticRetryAllowed !== false || latest.safeAutomaticReplay !== false ||
      typeof latest.sideEffectMayHaveCommitted !== "boolean" || typeof latest.postconditionVerified !== "boolean" ||
      typeof latest.reconciliationRequired !== "boolean" || typeof latest.physicalEffectState !== "string" || latest.physicalEffectState.length < 1
    ) throw new Error("latest terminal physical-truth receipt failed admission");
  } else if (receipt.latestTerminalOutcomeAdmissible !== false) {
    throw new Error("status claimed an admissible terminal outcome without a terminal receipt");
  }
  return { ...receipt, invokedThrough: SERVER_NAME, arbitraryCommandTextAccepted: false };
}
function runAutomationStatus(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("arguments must be an object");
  const allowed = new Set(["recoveryReceiptFreshSeconds", "updaterFallbackFreshSeconds"]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) throw new Error(`unknown argument: ${key}`);
  const recoveryFresh = asInt(raw.recoveryReceiptFreshSeconds, 600, 60, 1800, "recoveryReceiptFreshSeconds");
  const updaterFresh = asInt(raw.updaterFallbackFreshSeconds, 300, 60, 1800, "updaterFallbackFreshSeconds");
  const receipt = runPowerShell(AUTOMATION_SCRIPT, [
    "-RecoveryReceiptFreshSeconds", String(recoveryFresh),
    "-UpdaterFallbackFreshSeconds", String(updaterFresh),
  ], "zero-cost automation status v4");
  if (
    Number(receipt.schemaVersion) !== 4 ||
    receipt.kind !== "evavo-zero-cost-worker-automation-status-v4" ||
    typeof receipt.ok !== "boolean" ||
    typeof receipt.baseAutomationHealthy !== "boolean" ||
    typeof receipt.canonicalQueueHealthy !== "boolean" ||
    receipt.canonicalQueueAuthority !== "hkcu_run_python" ||
    receipt.taskPresenceIsNotLivenessProof !== true ||
    receipt.persistedRecoveryReceiptIsHistoricalEvidenceOnly !== true ||
    receipt.staleRecoveryReceiptCannotProveLiveness !== true ||
    receipt.latestUpdaterReceiptIsHistoricalEvidenceOnly !== true ||
    receipt.staleUpdaterReceiptCannotProveLiveness !== true ||
    receipt.freshPhysicalStatusPreferred !== true ||
    receipt.processExecutionPerformed !== false ||
    receipt.mutationPerformed !== false ||
    receipt.providerMutationPerformed !== false ||
    receipt.taskMutationPerformed !== false ||
    receipt.networkProbePerformed !== false ||
    receipt.githubActionsRequired !== false ||
    receipt.selfHostedActionsRunnerRequired !== false ||
    receipt.vercelRequired !== false ||
    receipt.netlifyRequired !== false ||
    receipt.paidComputeRequired !== false ||
    receipt.credentialValuesReturned !== false ||
    receipt.physicalPathsReturned !== false ||
    receipt.physicalAcceptanceClaimed !== false
  ) throw new Error("zero-cost automation status v4 receipt failed admission");
  const source = String(receipt.canonicalQueueEvidenceSource || "");
  if (!["fresh-physical-status-v3", "fresh-persisted-canonical-recovery-receipt", "fresh-updater-canonical-queue-preflight", "unavailable"].includes(source)) {
    throw new Error("zero-cost automation evidence source is invalid");
  }
  if (receipt.canonicalQueueHealthy === true) {
    if (source === "unavailable" || receipt.canonicalResidentFresh !== true || receipt.canonicalWatchdogFresh !== true) {
      throw new Error("zero-cost automation claimed queue health without fresh canonical evidence");
    }
  } else if (source !== "unavailable" && receipt.canonicalResidentFresh === true && receipt.canonicalWatchdogFresh === true) {
    throw new Error("zero-cost automation queue-health projection is internally inconsistent");
  }
  if (receipt.ok !== (receipt.baseAutomationHealthy === true && receipt.canonicalQueueHealthy === true)) {
    throw new Error("zero-cost automation overall-health projection is internally inconsistent");
  }
  return { ...receipt, invokedThrough: SERVER_NAME, arbitraryCommandTextAccepted: false };
}
function send(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`); }
function sendError(id, code, message) { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`); }

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return; }
  const id = request.id;
  try {
    if (request.method === "initialize") {
      send(id, { protocolVersion: request.params?.protocolVersion || "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } });
      return;
    }
    if (request.method === "notifications/initialized") return;
    if (request.method === "ping") { send(id, {}); return; }
    if (request.method === "tools/list") { send(id, { tools: [PHYSICAL_TOOL, AUTOMATION_TOOL] }); return; }
    if (request.method === "tools/call") {
      const name = String(request.params?.name || "");
      const value = name === PHYSICAL_TOOL.name
        ? runPhysicalStatus(request.params?.arguments || {})
        : name === AUTOMATION_TOOL.name
          ? runAutomationStatus(request.params?.arguments || {})
          : (() => { throw new Error("unknown tool"); })();
      send(id, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value, isError: false });
      return;
    }
    sendError(id, -32601, `method not found: ${String(request.method || "")}`);
  } catch (error) {
    if (request.method === "tools/call") {
      const payload = {
        ok: false,
        kind: "evavo-windows-control-status-error-v4",
        tool: String(request.params?.name || ""),
        error: String(error?.message || error).slice(0, 2000),
        mutationPerformed: false,
        providerMutationPerformed: false,
        networkPerformed: false,
        retryUnderlyingAction: false,
        reconciliationRequired: false,
      };
      send(id, { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload, isError: true });
    } else sendError(id, -32000, String(error?.message || error).slice(0, 2000));
  }
});