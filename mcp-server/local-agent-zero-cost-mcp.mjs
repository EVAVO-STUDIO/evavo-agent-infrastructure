import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const localAppData = (process.env.LOCALAPPDATA ?? "").trim();
const configured = (process.env.EVAVO_LOCAL_STORAGE_REPO ?? "").trim();
const updaterManaged = localAppData
  ? join(localAppData, "EVAVO", "WorkerControlPlane", "zero-cost-updater", "runtime", "evavo-local-storage")
  : "";
const recoveryManaged = localAppData
  ? join(localAppData, "EVAVO", "WorkerControlPlane", "zero-cost-recovery", "runtime", "evavo-local-storage")
  : "";
const development = "C:\\GitRepos\\evavo-local-storage";

function usable(root) {
  return Boolean(root) && existsSync(join(root, "scripts", "manage-autonomous-node.ps1"));
}

let selected = configured;
let source = configured ? "explicit-environment" : "";
if (!selected && usable(updaterManaged)) {
  selected = updaterManaged;
  source = "zero-cost-updater-managed-checkout";
}
if (!selected && usable(recoveryManaged)) {
  selected = recoveryManaged;
  source = "zero-cost-recovery-managed-checkout";
}
if (!selected) {
  selected = development;
  source = "development-checkout-compatibility-fallback";
}

process.env.EVAVO_LOCAL_STORAGE_REPO = selected;
process.env.EVAVO_LOCAL_AGENT_RECOVERY_MODE = "zero-cost-scheduled-tasks";
process.env.EVAVO_LOCAL_AGENT_RECOVERY_TASK = "EVAVO Zero Cost Worker Recovery";
process.env.EVAVO_LOCAL_AGENT_UPDATER_TASK = "EVAVO Zero Cost Trusted Updater";
process.env.EVAVO_LOCAL_AGENT_RECOVERY_SOURCE = source;

await import("./local-agent-mcp.mjs");
