import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const localAppData = (process.env.LOCALAPPDATA ?? "").trim();
const configured = (process.env.EVAVO_LOCAL_STORAGE_REPO ?? "").trim();
const managed = localAppData
  ? join(localAppData, "EVAVO", "WorkerControlPlane", "zero-cost-updater", "runtime", "evavo-local-storage")
  : "";
const development = "C:\\GitRepos\\evavo-local-storage";

let selected = configured;
let source = configured ? "explicit-environment" : "";
if (!selected && managed && existsSync(join(managed, "scripts", "manage-autonomous-node.ps1"))) {
  selected = managed;
  source = "zero-cost-managed-checkout";
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
