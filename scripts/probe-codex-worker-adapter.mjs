#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const config = JSON.parse(fs.readFileSync("config/codex-worker-adapter-v1.json", "utf8"));

function run(args) {
  const result = spawnSync(config.executable, args, {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout: 30_000,
  });
  return {
    status: result.status,
    error: result.error?.message ?? null,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

const version = run(config.probe.versionArgv);
const help = run(config.probe.helpArgv);
const helpText = `${help.stdout}\n${help.stderr}`;
const findFlag = (flags) => (flags ?? []).find((flag) => helpText.includes(flag)) ?? null;
const jsonFlag = findFlag(config.probe.acceptedJsonFlags);
const modelFlag = findFlag(config.probe.acceptedModelFlags);
const sandboxFlag = findFlag(config.probe.acceptedSandboxFlags);
const approvalFlag = findFlag(config.probe.acceptedApprovalFlags);
const available =
  version.status === 0 &&
  help.status === 0 &&
  Boolean(jsonFlag) &&
  Boolean(modelFlag) &&
  Boolean(sandboxFlag) &&
  Boolean(approvalFlag);

const receipt = {
  schemaVersion: 1,
  kind: "evavo-codex-worker-capability-probe-v1",
  observedAt: new Date().toISOString(),
  executable: config.executable,
  versionExitCode: version.status,
  helpExitCode: help.status,
  version: version.stdout.trim() || version.stderr.trim() || null,
  capabilities: {
    nonInteractiveExec: help.status === 0,
    structuredJsonOutput: Boolean(jsonFlag),
    explicitModelSelection: Boolean(modelFlag),
    explicitSandboxSelection: Boolean(sandboxFlag),
    explicitApprovalSelection: Boolean(approvalFlag),
    jsonFlag,
    modelFlag,
    sandboxFlag,
    approvalFlag,
  },
  eligibleForWorkerDispatch: available,
  modelTurnPerformed: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
  error: version.error ?? help.error,
  truthBoundary: "This receipt proves only local Codex CLI presence and supported command-line capabilities. It does not prove ChatGPT authentication, Spark availability, remaining usage, sandbox effectiveness on this machine, or a successful model turn.",
};

console.log(JSON.stringify(receipt, null, 2));
process.exit(available ? 0 : 1);
