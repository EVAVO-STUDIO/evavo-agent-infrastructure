import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doctor = fs.readFileSync(path.join(root, 'scripts', 'Ensure-EvavoChatLocalAgent.ps1'), 'utf8');
const architecture = fs.readFileSync(path.join(root, 'docs', 'CHATGPT_LOCAL_EXECUTION_ARCHITECTURE.md'), 'utf8');

const requiredDoctor = [
  "@('-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass')",
  "Invoke-NodeManager -Action diagnose",
  "Invoke-NodeManager -Action repair",
  "Invoke-NodeManager -Action restart",
  "ConnectAsync('127.0.0.1',4329)",
  "automaticRetryCount=$(if($Initial.ok){0}else{1})",
  "permanentDeleteAuthorityAdded=$false",
  "childPowerShellHidden=$true",
  "focusStealAllowed=$false",
  "desktopCommanderRequired=$false",
];
for (const needle of requiredDoctor) {
  if (!doctor.includes(needle)) throw new Error(`CHAT_LOCAL_AGENT_FOCUS_CONTRACT_MISSING:${needle}`);
}

const requiredArchitecture = [
  'authenticated loopback Local Agent REST on `127.0.0.1:4329`',
  'Owner: `evavo-local-storage`',
  'Entry point: `scripts/manage-autonomous-node.ps1`',
  'Existing scheduled updater, heartbeat, watchdog and daily recovery remain the only persistent lifecycle owner.',
  'The command performs one bounded automatic repair attempt.',
  'No infinite repair loop.',
  'No second persistent local shell service.',
];
for (const needle of requiredArchitecture) {
  if (!architecture.includes(needle)) throw new Error(`CHAT_LOCAL_AGENT_ARCHITECTURE_CONTRACT_MISSING:${needle}`);
}

if (doctor.includes('Desktop Commander')) {
  throw new Error('CHAT_LOCAL_AGENT_DESKTOP_COMMANDER_REFERENCE_FORBIDDEN');
}

console.log(JSON.stringify({
  schemaVersion: 1,
  kind: 'evavo-chat-local-agent-startup-focus-contract-check-v1',
  ok: true,
  canonicalLoopbackPort: 4329,
  lifecycleOwner: 'evavo-local-storage',
  boundedRepairAttempts: 1,
  childPowerShellHidden: true,
  permanentDeleteAuthorityAdded: false,
  secondPersistentShellAdded: false,
  focusStealAllowed: false,
  desktopCommanderRequired: false,
}));
