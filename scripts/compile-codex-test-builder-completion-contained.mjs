#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bindContainedCompletion,
  requireZeroIgnoredWorkspace,
} from "./codex-ignored-workspace-boundary-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
if (argv.length !== 4 || argv.some((value) => typeof value !== "string" || !value)) {
  console.error("Usage: node scripts/compile-codex-test-builder-completion-contained.mjs <leased-work.json> <route-plan.json> <contained-dispatch-plan.json> <contained-run-receipt.json>");
  process.exit(2);
}

function readJsonBytes(value, label) {
  const requested = path.resolve(value);
  const stat = fs.lstatSync(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  const resolved = fs.realpathSync.native(requested);
  const bytes = fs.readFileSync(resolved);
  if (bytes.length < 2 || bytes.length > 8 * 1024 * 1024) throw new Error(`${label} is outside the bounded 8 MiB evidence limit.`);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) throw new Error(`${label} must contain a JSON object.`);
  return { resolved, bytes, document };
}

function safeError(value) {
  let text = String(value ?? "Contained Test Builder completion compilation failed");
  text = text.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  text = text.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  text = text.replace(/(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi, "credential=<redacted>");
  return text.slice(0, 1500);
}

try {
  const [, , dispatchInput, runInput] = argv;
  const dispatch = readJsonBytes(dispatchInput, "contained Codex dispatch plan");
  const run = readJsonBytes(runInput, "contained Codex run receipt");
  if (dispatch.document.containedDispatchBindingVersion !== 1 || run.document.containedRunBindingVersion !== 1) {
    throw new Error("Contained completion requires contained dispatch and run receipts.");
  }
  const ignoredBefore = requireZeroIgnoredWorkspace({
    workingDirectory: dispatch.document.workingDirectory,
    sourceRevision: dispatch.document.sourceRevision,
  });

  const baseCompiler = path.join(ROOT, "scripts", "compile-codex-test-builder-completion.mjs");
  const stat = fs.lstatSync(baseCompiler);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Exact-bound Test Builder completion compiler is unavailable or unsafe.");
  const result = spawnSync(process.execPath, [baseCompiler, ...argv], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "exact-bound completion compiler rejected the request").trim();
    throw new Error(`Exact-bound Test Builder completion compiler rejected the request: ${detail.slice(0, 1500)}`);
  }
  const baseText = String(result.stdout ?? "").trim();
  let baseCompletion;
  try {
    baseCompletion = JSON.parse(baseText);
  } catch {
    throw new Error("Exact-bound Test Builder completion compiler did not return one valid JSON object.");
  }
  const ignoredAfter = requireZeroIgnoredWorkspace({
    workingDirectory: dispatch.document.workingDirectory,
    sourceRevision: dispatch.document.sourceRevision,
  });
  const contained = bindContainedCompletion({
    dispatchPlan: dispatch.document,
    dispatchPlanBytes: dispatch.bytes,
    runReceipt: run.document,
    runReceiptBytes: run.bytes,
    baseCompletion,
    baseCompletionBytes: Buffer.from(`${baseText}\n`, "utf8"),
    ignoredBefore,
    ignoredBeforeBytes: Buffer.from(`${JSON.stringify(ignoredBefore)}\n`, "utf8"),
    ignoredAfter,
    ignoredAfterBytes: Buffer.from(`${JSON.stringify(ignoredAfter)}\n`, "utf8"),
  });
  process.stdout.write(`${JSON.stringify(contained, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-test-builder-contained-completion-error-v1",
    ok: false,
    errors: [safeError(error?.message ?? error)],
    ignoredWorkspaceBoundaryAccepted: false,
    ignoredPathsReturned: false,
    physicalPathsReturned: false,
    credentialValuesReturned: false,
    deterministicValidationPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 2;
}
