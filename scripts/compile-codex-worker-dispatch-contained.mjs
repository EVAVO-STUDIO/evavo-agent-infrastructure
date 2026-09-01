#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bindContainedDispatch,
  requireZeroIgnoredWorkspace,
} from "./codex-ignored-workspace-boundary-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
if (argv.length !== 5 || argv.some((value) => typeof value !== "string" || !value)) {
  console.error("Usage: node scripts/compile-codex-worker-dispatch-contained.mjs <leased-work.json> <route-plan.json> <codex-capability.json> <candidate-receipt.json> <worker-id>");
  process.exit(2);
}

function safeError(value) {
  let text = String(value ?? "Contained Codex dispatch compilation failed");
  text = text.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  text = text.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  text = text.replace(/(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi, "credential=<redacted>");
  return text.slice(0, 1500);
}

try {
  const compiler = path.join(ROOT, "scripts", "compile-codex-worker-dispatch-bound.mjs");
  const stat = fs.lstatSync(compiler);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Exact-bound Codex dispatch compiler is unavailable or unsafe.");
  const result = spawnSync(process.execPath, [compiler, ...argv], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "exact-bound dispatch compiler rejected the request").trim();
    throw new Error(`Exact-bound Codex dispatch compiler rejected the request: ${detail.slice(0, 1500)}`);
  }
  const baseText = String(result.stdout ?? "").trim();
  let baseDispatchPlan;
  try {
    baseDispatchPlan = JSON.parse(baseText);
  } catch {
    throw new Error("Exact-bound Codex dispatch compiler did not return one valid JSON object.");
  }
  const ignoredObservation = requireZeroIgnoredWorkspace({
    workingDirectory: baseDispatchPlan.workingDirectory,
    sourceRevision: baseDispatchPlan.sourceRevision,
  });
  const contained = bindContainedDispatch({
    baseDispatchPlan,
    baseDispatchPlanBytes: Buffer.from(`${baseText}\n`, "utf8"),
    ignoredObservation,
    ignoredObservationBytes: Buffer.from(`${JSON.stringify(ignoredObservation)}\n`, "utf8"),
  });
  process.stdout.write(`${JSON.stringify(contained, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-worker-contained-dispatch-error-v1",
    eligible: false,
    errors: [safeError(error?.message ?? error)],
    ignoredWorkspaceBoundaryAccepted: false,
    ignoredPathsReturned: false,
    physicalPathsReturned: false,
    modelTurnPerformed: false,
    deterministicValidationPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
    paidFallbackUsed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
