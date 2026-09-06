import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'Ensure-EvavoChatLocalAgent.ps1'), 'utf8');

for (const needle of [
  "Get-EvavoLocalAgentRestStartupDiagnosis043.ps1",
  "REPAIR-EVAVO-LOCAL-AGENT-REST-043.ps1",
  "START-EVAVO-LOCAL-AGENT-MCP-043.ps1",
  "workerRecoveryIsSecondaryFallback=$true",
  "workerAutomationHealthIsNotLocalAgentAdmissionGate=$true",
  "workerRepairAloneCanProveLocalAgentReady=$false",
  "restRuntimeExpectedHost='pythonw.exe'",
  "directConsolePythonTaskAllowed=$false",
  "childPowerShellHidden=$true",
  "focusStealAllowed=$false",
  "desktopCommanderRequired=$false",
  "githubActionsRequired=$false",
  "selfHostedActionsRunnerRequired=$false",
]) {
  if (!source.includes(needle)) throw new Error(`CHAT_LOCAL_AGENT_RECOVERY_ROUTING_MISSING:${needle}`);
}

for (const needle of [
  "step='rest-diagnosis'",
  "step='rest-repair'",
  "step='rest-loopback-wait'",
  "step='mcp-establishment'",
  "step='acceptance-after-canonical-local-repair'",
  "step='worker-diagnose-fallback'",
  "step='worker-repair-fallback'",
  "step='rest-repair-after-worker-fallback'",
  "step='mcp-establishment-after-worker-fallback'",
  "step='acceptance-after-worker-fallback'",
  "authority='local-storage-local-agent-rest'",
  "authority='local-storage-local-agent-mcp'",
  "authority='local-storage-zero-cost-worker-fabric'",
]) {
  if (!source.includes(needle)) throw new Error(`CHAT_LOCAL_AGENT_RECOVERY_SEQUENCE_MISSING:${needle}`);
}

if (!source.includes("$BaseArguments = @('-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden'")) {
  throw new Error('CHAT_LOCAL_AGENT_HIDDEN_CHILD_POWERSHELL_MISSING');
}
if (source.includes("ok=[bool]($Final.ok -and $Status.ok)")) {
  throw new Error('CHAT_LOCAL_AGENT_WORKER_HEALTH_REINTRODUCED_AS_ADMISSION_GATE');
}

const repairAfterWorker = source.indexOf("step='rest-repair-after-worker-fallback'");
const workerRepair = source.indexOf("step='worker-repair-fallback'");
const acceptanceAfterWorker = source.indexOf("step='acceptance-after-worker-fallback'");
if (!(workerRepair >= 0 && repairAfterWorker > workerRepair && acceptanceAfterWorker > repairAfterWorker)) {
  throw new Error('CHAT_LOCAL_AGENT_CANONICAL_REPAIR_MUST_FOLLOW_WORKER_FALLBACK');
}

console.log(JSON.stringify({
  schemaVersion: 2,
  kind: 'evavo-chat-local-agent-recovery-routing-contract-check-v1',
  ok: true,
  canonicalRestRepairFirst: true,
  canonicalMcpEstablishmentFirst: true,
  workerRecoverySecondaryOnly: true,
  canonicalRestRepairRequiredAfterWorkerFallback: true,
  canonicalMcpEstablishmentRequiredAfterWorkerFallback: true,
  localAgentAcceptanceRequiredAfterWorkerFallback: true,
  workerHealthAdmissionGate: false,
  expectedRestRuntimeHost: 'pythonw.exe',
  directConsolePythonTaskAllowed: false,
  focusStealAllowed: false,
  desktopCommanderRequired: false,
  githubActionsRequired: false,
  selfHostedActionsRunnerRequired: false,
}));
