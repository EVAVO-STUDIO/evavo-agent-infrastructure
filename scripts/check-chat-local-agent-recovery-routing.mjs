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
]) {
  if (!source.includes(needle)) throw new Error(`CHAT_LOCAL_AGENT_RECOVERY_ROUTING_MISSING:${needle}`);
}
if (!source.includes("$BaseArguments = @('-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden'")) {
  throw new Error('CHAT_LOCAL_AGENT_HIDDEN_CHILD_POWERSHELL_MISSING');
}
if (source.includes("ok=[bool]($Final.ok -and $Status.ok)")) {
  throw new Error('CHAT_LOCAL_AGENT_WORKER_HEALTH_REINTRODUCED_AS_ADMISSION_GATE');
}

console.log(JSON.stringify({
  schemaVersion: 1,
  kind: 'evavo-chat-local-agent-recovery-routing-contract-check-v1',
  ok: true,
  canonicalRestRepairFirst: true,
  canonicalMcpEstablishmentFirst: true,
  workerRecoverySecondaryOnly: true,
  workerHealthAdmissionGate: false,
  expectedRestRuntimeHost: 'pythonw.exe',
  directConsolePythonTaskAllowed: false,
  focusStealAllowed: false,
  desktopCommanderRequired: false,
}));
