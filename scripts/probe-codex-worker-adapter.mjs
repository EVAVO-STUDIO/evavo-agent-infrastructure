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
const jsonFlag = (config.probe.acceptedJsonFlags ?? []).find((flag) => helpText.includes(flag)) ?? null;
const modelFlag = (config.probe.acceptedModelFlags ?? []).find((flag) => helpText.includes(flag)) ?? null;
const available = version.status === 0 && help.status === 0 && Boolean(jsonFlag) && Boolean(modelFlag);

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
    jsonFlag,
    modelFlag,
  },
  eligibleForWorkerDispatch: available,
  modelTurnPerformed: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
  error: version.error ?? help.error,
  truthBoundary: "This receipt proves only local Codex CLI presence and supported command-line capabilities. It does not prove ChatGPT authentication, Spark availability, remaining usage, or a successful model turn.",
};

console.log(JSON.stringify(receipt, null, 2));
process.exit(available ? 0 : 1);
