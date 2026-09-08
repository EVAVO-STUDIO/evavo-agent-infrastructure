#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

const forbiddenMachineScripts = new Set([
  "test:windows-chat-mcp",
  "test:windows-chat-physical",
  "test:chatgpt-windows-execution-tunnel-contract",
  "test:android-mcps",
  "test:physical-device-contract",
  "test:chatgpt-android-observer-contract",
  "test:chatgpt-workstation-observer-contract",
  "test:remote-access-install-contract",
  "test:provider-credential-readiness",
  "test:android-physical",
  "test:local-agent-mcp",
  "test:storage-governance-mcp",
  "physical-device:install",
  "physical-device:doctor",
  "chatgpt:android-observer-tunnel",
  "chatgpt:workstation-observer-tunnel",
  "chatgpt:windows-execution-tunnel",
  "remote-access:install",
  "remote-access:install-with-execution",
  "remote-access:install-with-execution-and-cloudflare",
  "remote-access:install-with-cloudflare",
  "remote-access:doctor",
  "remote-mcp-relay:deploy",
  "remote-mcp-relay:deploy-v1",
  "provider-credentials:status",
  "provider-credentials:doctor"
]);

const sourceScripts = [
  "check:capability-manifest",
  "test:spark-governance",
  "test:capability-routing",
  "test:github-estate-routing",
  "check:capability-routing",
  "lint",
  "type-check",
  "test",
  "test:vercel-control-mcp",
  "test:remote-mcp-relay-contract",
  "build"
];

for (const name of sourceScripts) {
  if (!manifest.scripts?.[name]) {
    throw new Error(`Required source-verification script is missing: ${name}`);
  }
  if (forbiddenMachineScripts.has(name)) {
    throw new Error(`Machine/environment script entered source verification: ${name}`);
  }
}

function runScript(name) {
  process.stdout.write(`==> pnpm ${name}\n`);
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(command, [name], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${name} failed with exit code ${result.status}`);
  }
}

for (const name of sourceScripts) runScript(name);

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    gate: "evavo_agent_infrastructure_source_verification_v1",
    repositoryVersion: manifest.version,
    scriptsExecuted: sourceScripts,
    windowsMachineIntegrationIncluded: false,
    physicalDeviceAcceptanceIncluded: false,
    providerCredentialReadinessIncluded: false,
    tunnelInstallationIncluded: false,
    deploymentPerformed: false,
    sourceMutationPerformed: false
  })}\n`
);
