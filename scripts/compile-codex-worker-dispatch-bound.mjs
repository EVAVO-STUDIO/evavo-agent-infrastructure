#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bindCodexWorkerDispatch } from "./codex-worker-dispatch-binding-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
if (argv.length !== 5 || argv.some((value) => typeof value !== "string" || !value)) {
  console.error("Usage: node scripts/compile-codex-worker-dispatch-bound.mjs <leased-work.json> <route-plan.json> <codex-capability.json> <candidate-receipt.json> <worker-id>");
  process.exit(2);
}

function readJsonBytes(value, label) {
  const requested = path.resolve(value);
  const stat = fs.lstatSync(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  const resolved = fs.realpathSync.native(requested);
  const bytes = fs.readFileSync(resolved);
  if (bytes.length < 2 || bytes.length > 8 * 1024 * 1024) throw new Error(`${label} is outside the bounded 8 MiB limit.`);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return { resolved, bytes, document };
}

function safeError(value) {
  let text = String(value ?? "Bound Codex dispatch compilation failed");
  text = text.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  text = text.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  text = text.replace(/(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi, "credential=<redacted>");
  return text.slice(0, 1500);
}

try {
  const [workInput, routeInput] = argv;
  const work = readJsonBytes(workInput, "leased work item");
  const route = readJsonBytes(routeInput, "worker route plan");
  const legacyCompiler = path.join(ROOT, "scripts", "compile-codex-worker-dispatch.mjs");
  const compilerStat = fs.lstatSync(legacyCompiler);
  if (!compilerStat.isFile() || compilerStat.isSymbolicLink()) {
    throw new Error("Legacy read-only Codex dispatch compiler is unavailable or unsafe.");
  }
  const result = spawnSync(process.execPath, [legacyCompiler, ...argv], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "legacy dispatch compiler rejected the request").trim();
    throw new Error(`Legacy read-only Codex dispatch compiler rejected the request: ${detail.slice(0, 1500)}`);
  }
  let legacyDispatchPlan;
  try {
    legacyDispatchPlan = JSON.parse(String(result.stdout ?? "").trim());
  } catch {
    throw new Error("Legacy read-only Codex dispatch compiler did not return one valid JSON object.");
  }
  const bound = bindCodexWorkerDispatch({
    workItem: work.document,
    workItemBytes: work.bytes,
    routePlan: route.document,
    routePlanBytes: route.bytes,
    legacyDispatchPlan,
  });
  process.stdout.write(`${JSON.stringify(bound, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-worker-dispatch-bound-error-v1",
    eligible: false,
    errors: [safeError(error?.message ?? error)],
    modelTurnPerformed: false,
    deterministicValidationPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
    paidFallbackUsed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
