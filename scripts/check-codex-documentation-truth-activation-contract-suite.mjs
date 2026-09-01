#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const suitePath = "scripts/run-codex-documentation-truth-activation-contract-suite.mjs";
const errors = [];
if (!fs.existsSync(suitePath) || !fs.lstatSync(suitePath).isFile() || fs.lstatSync(suitePath).isSymbolicLink()) {
  errors.push("Aggregate documentation-truth activation suite is missing or unsafe.");
}
const source = errors.length === 0 ? fs.readFileSync(suitePath, "utf8") : "";
for (const token of [
  "check-codex-documentation-truth-physical-acceptance-contract.mjs",
  "check-codex-documentation-truth-dormant-fixture-campaign-contract.mjs",
  "check-worker-capacity-routing-v1.mjs",
  "test-worker-capacity-routing.mjs",
  "test-codex-worker-dispatch-compiler.mjs",
  "test-codex-worker-runner-safety.mjs",
  "check-evavo-capability-manifest.mjs",
  "EVAVO_CODEX_SPARK_EXECUTION_ENABLED: \"0\"",
  "EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED: \"0\"",
  "physicalFixtureCampaignPerformed: false",
  "modelTurnPerformed: false",
  "queueMutationPerformed: false",
  "leaseAcquired: false",
  "repositoryMutationPerformed: false",
  "publicationPerformed: false",
  "paidFallbackUsed: false",
  "shell: false",
]) {
  if (!source.includes(token)) errors.push(`Aggregate documentation-truth activation suite is missing token: ${token}`);
}
for (const token of [
  "run-codex-documentation-truth-dormant-fixture-campaign.mjs --",
  "EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED: \"1\"",
  "EVAVO_CODEX_SPARK_EXECUTION_ENABLED: \"1\"",
  "git push",
  "mainline-publish",
  "shell: true",
]) {
  if (source.includes(token)) errors.push(`Aggregate documentation-truth activation suite contains forbidden token: ${token}`);
}

const syntax = spawnSync(process.execPath, ["--check", suitePath], {
  encoding: "utf8",
  shell: false,
  windowsHide: true,
  timeout: 120_000,
});
if (syntax.status !== 0) errors.push(`Aggregate suite syntax failed: ${String(syntax.stderr || syntax.stdout).trim()}`);

if (errors.length === 0) {
  const completed = spawnSync(process.execPath, [suitePath], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 900_000,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      WINDIR: process.env.WINDIR ?? "",
      HOME: process.env.HOME ?? "",
      USERPROFILE: process.env.USERPROFILE ?? "",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never",
      EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "0",
      EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED: "0",
    },
  });
  let report;
  try { report = JSON.parse(String(completed.stdout ?? "").trim()); }
  catch { errors.push(`Aggregate suite returned invalid JSON: ${String(completed.stderr || completed.stdout).trim().slice(0, 4000)}`); }
  if (completed.status !== 0 || report?.passed !== true) {
    errors.push(`Aggregate suite failed: ${String(completed.stderr || completed.stdout).trim().slice(0, 4000)}`);
  }
  if (
    report?.physicalFixtureCampaignPerformed !== false ||
    report?.modelTurnPerformed !== false ||
    report?.queueMutationPerformed !== false ||
    report?.leaseAcquired !== false ||
    report?.repositoryMutationPerformed !== false ||
    report?.publicationPerformed !== false ||
    report?.paidFallbackUsed !== false
  ) errors.push("Aggregate suite widened its source-check-only authority.");
}

if (errors.length > 0) {
  console.error("Aggregate documentation-truth activation contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Aggregate documentation-truth activation contract passed.");
console.log("- physical acceptance, source-bound fixture, route, dispatch, runner and manifest contracts pass together");
console.log("- real Codex execution and physical campaign activation remain explicitly disabled");
console.log("- no queue, lease, repository, Git, publication or paid-fallback authority is exercised");
