#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const checks = [
  {
    id: "physical-acceptance",
    executable: process.execPath,
    args: ["scripts/check-codex-documentation-truth-physical-acceptance-contract.mjs"],
  },
  {
    id: "source-bound-fixture-campaign",
    executable: process.execPath,
    args: ["scripts/check-codex-documentation-truth-dormant-fixture-campaign-contract.mjs"],
  },
  {
    id: "worker-capacity-routing",
    executable: process.execPath,
    args: ["scripts/check-worker-capacity-routing-v1.mjs"],
  },
  {
    id: "worker-routing-regressions",
    executable: process.execPath,
    args: ["scripts/test-worker-capacity-routing.mjs"],
  },
  {
    id: "dispatch-compiler-regressions",
    executable: process.execPath,
    args: ["scripts/test-codex-worker-dispatch-compiler.mjs"],
  },
  {
    id: "runner-safety-regressions",
    executable: process.execPath,
    args: ["scripts/test-codex-worker-runner-safety.mjs"],
  },
  {
    id: "capability-manifest",
    executable: process.execPath,
    args: ["scripts/check-evavo-capability-manifest.mjs"],
  },
];

const schemaFiles = [
  "schemas/codex-documentation-truth-fixture-scenario-v1.schema.json",
  "schemas/codex-documentation-truth-fixture-supervision-v1.schema.json",
  "schemas/codex-documentation-truth-physical-acceptance-v1.schema.json",
  "schemas/codex-documentation-truth-activation-readiness-v1.schema.json",
  "schemas/codex-documentation-truth-source-observation-v1.schema.json",
  "schemas/codex-documentation-truth-dormant-fixture-campaign-v1.schema.json",
  "schemas/codex-documentation-truth-dormant-fixture-scenario-v1.schema.json",
  "schemas/codex-documentation-truth-dormant-fixture-supervision-v1.schema.json",
];

const errors = [];
const results = [];
for (const relativePath of schemaFiles) {
  try {
    const stat = fs.lstatSync(relativePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("must be a regular non-symlink file");
    const schema = JSON.parse(fs.readFileSync(relativePath, "utf8"));
    if (
      schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
      schema.type !== "object" ||
      schema.additionalProperties !== false
    ) throw new Error("must be a closed Draft 2020-12 object schema");
    results.push({ id: `schema:${relativePath}`, passed: true });
  } catch (error) {
    errors.push(`${relativePath}: ${error?.message ?? error}`);
    results.push({ id: `schema:${relativePath}`, passed: false });
  }
}

for (const check of checks) {
  const completed = spawnSync(check.executable, check.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 600_000,
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
  const passed = completed.status === 0;
  results.push({
    id: check.id,
    passed,
    exitCode: completed.status,
    stdout: String(completed.stdout ?? "").slice(0, 16_384),
    stderr: String(completed.stderr ?? "").slice(0, 16_384),
  });
  if (!passed) {
    errors.push(`${check.id}: ${String(completed.stderr || completed.stdout).trim().slice(0, 4000)}`);
  }
}

const report = {
  schemaVersion: 1,
  kind: "evavo-codex-documentation-truth-activation-contract-suite-v1",
  passed: errors.length === 0,
  checkCount: results.length,
  results,
  errors,
  physicalFixtureCampaignPerformed: false,
  modelTurnPerformed: false,
  queueMutationPerformed: false,
  leaseAcquired: false,
  repositoryMutationPerformed: false,
  commitPerformed: false,
  pushPerformed: false,
  publicationPerformed: false,
  deploymentPerformed: false,
  financialActionPerformed: false,
  paidFallbackUsed: false,
  truthBoundary:
    "This aggregate suite validates source contracts and injected fixture behavior only. It explicitly disables real Codex execution and does not prove a supervised Windows physical campaign.",
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
