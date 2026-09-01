#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const checks = [
  "scripts/test-codex-spark-capacity-observation.mjs",
  "scripts/test-codex-spark-capacity-status-contract.mjs",
  "scripts/test-codex-spark-admitted-route.mjs",
  "scripts/check-codex-spark-capacity-dispatch-contract.mjs",
  "scripts/test-worker-capacity-routing.mjs",
  "scripts/test-codex-worker-runner-safety.mjs",
  "scripts/test-codex-chatgpt-auth-policy.mjs",
  "scripts/test-codex-spark-safe-certification-contract.mjs",
  "scripts/test-codex-spark-safe-physical-acceptance.mjs",
];
const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const results = [];

for (const script of checks) {
  const startedAt = new Date().toISOString();
  const processResult = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never",
      EVAVO_CODEX_SPARK_EXECUTION_ENABLED: "0",
      EVAVO_CODEX_SPARK_CERTIFICATION_MODE: "0",
    },
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const stdout = String(processResult.stdout ?? "");
  const stderr = String(processResult.stderr ?? "");
  results.push({
    script,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: processResult.status,
    signal: processResult.signal ?? null,
    errorType: processResult.error?.name ?? null,
    stdoutSha256: hash(stdout),
    stderrSha256: hash(stderr),
    stdoutTail: stdout.slice(-4096),
    stderrTail: stderr.slice(-4096),
    ok: processResult.status === 0,
  });
  if (processResult.status !== 0) break;
}

const ok = results.length === checks.length && results.every((result) => result.ok);
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      kind: "evavo-codex-spark-capacity-contract-suite-receipt-v1",
      generatedAt: new Date().toISOString(),
      ok,
      expectedCheckCount: checks.length,
      completedCheckCount: results.length,
      results,
      networkRequired: false,
      modelTurnPerformed: false,
      physicalCertificationPerformed: false,
      repositoryMutationPerformed: false,
      publicationPerformed: false,
      paidFallbackUsed: false,
      truthBoundary:
        "This offline suite validates source contracts for observed capacity, supervised admission, route planning and dispatch continuity. It neither proves workstation/Codex physical readiness nor starts a model turn.",
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
