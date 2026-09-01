#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bindContainedRunReceipt,
  canonicalJson,
  observeIgnoredWorkspace,
  requireZeroIgnoredWorkspace,
  sha256Bytes,
  verifyZeroIgnoredObservation,
} from "./codex-ignored-workspace-boundary-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [dispatchInput, capabilityInput] = process.argv.slice(2);
if (!dispatchInput || !capabilityInput || process.argv.slice(2).length !== 2) {
  console.error("Usage: node scripts/run-codex-worker-dispatch-contained.mjs <contained-dispatch-plan.json> <codex-capability-receipt.json>");
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
  if (document === null || typeof document !== "object" || Array.isArray(document)) throw new Error(`${label} must contain a JSON object.`);
  return { resolved, bytes, document };
}

function safeError(value) {
  let text = String(value ?? "Contained Codex runner failed");
  text = text.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  text = text.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  text = text.replace(/(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi, "credential=<redacted>");
  return text.slice(0, 1500);
}

function parseSingleJson(primary, secondary) {
  for (const value of [primary, secondary]) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { parsed, text };
    } catch {}
  }
  throw new Error("Base Codex runner did not return one valid JSON receipt.");
}

try {
  const dispatchEvidence = readJsonBytes(dispatchInput, "contained Codex dispatch plan");
  const capabilityEvidence = readJsonBytes(capabilityInput, "Codex capability receipt");
  const plan = dispatchEvidence.document;
  if (plan.kind !== "evavo-codex-worker-dispatch-plan-v1" || plan.containedDispatchBindingVersion !== 1 || plan.eligible !== true) {
    throw new Error("Contained Codex runner requires one eligible contained dispatch plan.");
  }
  const planBody = { ...plan };
  delete planBody.dispatchPlanSha256;
  if (plan.dispatchPlanSha256 !== sha256Bytes(Buffer.from(canonicalJson(planBody), "utf8"))) {
    throw new Error("Contained dispatch-plan SHA-256 does not match its canonical body.");
  }

  const ignoredBefore = requireZeroIgnoredWorkspace({
    workingDirectory: plan.workingDirectory,
    sourceRevision: plan.sourceRevision,
  });
  const verifiedBefore = verifyZeroIgnoredObservation(ignoredBefore, { sourceRevision: plan.sourceRevision });
  if (verifiedBefore.stateSha256 !== plan.ignoredWorkspaceBaselineStateSha256) {
    throw new Error("Pre-turn ignored-workspace state differs from the dispatch-bound baseline.");
  }

  const baseRunner = path.join(ROOT, "scripts", "run-codex-worker-dispatch.mjs");
  const runnerStat = fs.lstatSync(baseRunner);
  if (!runnerStat.isFile() || runnerStat.isSymbolicLink()) throw new Error("Base Codex runner is unavailable or unsafe.");
  const result = spawnSync(process.execPath, [baseRunner, dispatchEvidence.resolved, capabilityEvidence.resolved], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 25 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const base = parseSingleJson(result.stdout, result.stderr);
  const ignoredAfter = observeIgnoredWorkspace({
    workingDirectory: plan.workingDirectory,
    sourceRevision: plan.sourceRevision,
  });
  const afterState = ignoredAfter.ignoredWorkspaceState;
  if (afterState.ignoredPathCount !== 0 || afterState.ignoredFilesPresent !== false || afterState.ignoredPathListByteLength !== 0) {
    const rejectedBody = {
      ...base.parsed,
      containedRunBindingVersion: 1,
      baseRunnerExitCode: result.status,
      codexProtocolModelTurnCompleted: base.parsed.modelTurnCompleted === true,
      codexProtocolStructuredTurnCompleted: base.parsed.structuredTurnCompleted === true,
      modelTurnCompleted: false,
      structuredTurnCompleted: false,
      ignoredWorkspaceBeforeObservationSha256: ignoredBefore.observationSha256,
      ignoredWorkspaceBeforeStateSha256: ignoredBefore.ignoredWorkspaceStateSha256,
      ignoredWorkspaceAfterObservationSha256: ignoredAfter.observationSha256,
      ignoredWorkspaceAfterStateSha256: ignoredAfter.ignoredWorkspaceStateSha256,
      ignoredWorkspacePathCountBefore: 0,
      ignoredWorkspacePathCountAfter: afterState.ignoredPathCount,
      ignoredWorkspacePathListSha256After: afterState.ignoredPathListSha256,
      ignoredWorkspaceBoundaryAccepted: false,
      ignoredWorkspaceFilesAccepted: false,
      ignoredPathsReturned: false,
      physicalPathsReturned: false,
      deterministicValidationPerformed: false,
      publicationPerformed: false,
      truthBoundary: "The Codex process returned, but the isolated candidate contains ignored workspace content. The worker result is rejected before completion; ignored path names and file contents are not returned. Cleanup and reconciliation remain external authorities.",
    };
    process.stdout.write(`${JSON.stringify({
      ...rejectedBody,
      runReceiptSha256: sha256Bytes(Buffer.from(canonicalJson(rejectedBody), "utf8")),
    }, null, 2)}\n`);
    process.exit(1);
  }

  const contained = bindContainedRunReceipt({
    dispatchPlan: plan,
    dispatchPlanBytes: dispatchEvidence.bytes,
    baseRunReceipt: base.parsed,
    baseRunReceiptBytes: Buffer.from(`${base.text}\n`, "utf8"),
    ignoredBefore,
    ignoredBeforeBytes: Buffer.from(`${JSON.stringify(ignoredBefore)}\n`, "utf8"),
    ignoredAfter,
    ignoredAfterBytes: Buffer.from(`${JSON.stringify(ignoredAfter)}\n`, "utf8"),
  });
  process.stdout.write(`${JSON.stringify(contained, null, 2)}\n`);
  process.exit(result.status === 0 && contained.modelTurnCompleted === true && contained.structuredTurnCompleted === true ? 0 : 1);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-worker-contained-run-error-v1",
    started: false,
    errors: [safeError(error?.message ?? error)],
    ignoredWorkspaceBoundaryAccepted: false,
    ignoredPathsReturned: false,
    physicalPathsReturned: false,
    credentialValuesReturned: false,
    modelTurnPerformed: false,
    deterministicValidationPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
    paidFallbackUsed: false,
  }, null, 2)}\n`);
  process.exit(1);
}
