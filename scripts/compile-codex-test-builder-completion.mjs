#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import { observeCodexCandidateChanges } from "./codex-candidate-change-observer.mjs";
import { bindCodexTestBuilderCompletion } from "./codex-test-builder-boundary-core.mjs";
import { compileCodexTestBuilderCompletion } from "./codex-test-builder-completion-core.mjs";

const args = process.argv.slice(2);
if (args.length !== 4 || args.some((value) => typeof value !== "string" || !value)) {
  console.error("Usage: node scripts/compile-codex-test-builder-completion.mjs <leased-work.json> <route-plan.json> <dispatch-plan.json> <run-receipt.json>");
  process.exit(2);
}

function readEvidence(value, label) {
  const requested = path.resolve(value);
  const requestedStat = fs.lstatSync(requested);
  if (!requestedStat.isFile() || requestedStat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  const resolved = fs.realpathSync.native(requested);
  const bytes = fs.readFileSync(resolved);
  if (bytes.length < 2 || bytes.length > 8 * 1024 * 1024) {
    throw new Error(`${label} is outside the bounded 8 MiB evidence limit.`);
  }
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return { bytes, document };
}

function safeError(value) {
  let text = String(value ?? "Test Builder completion compilation failed");
  text = text.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  text = text.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  text = text.replace(/(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi, "credential=<redacted>");
  return text.slice(0, 1500);
}

try {
  const [workInput, routeInput, dispatchInput, runInput] = args;
  const workItem = readEvidence(workInput, "leased work item");
  const routePlan = readEvidence(routeInput, "worker route plan");
  const dispatchPlan = readEvidence(dispatchInput, "bound Codex dispatch plan");
  const runReceipt = readEvidence(runInput, "Codex run receipt");
  const candidateObservation = observeCodexCandidateChanges({
    dispatchPlan: dispatchPlan.document,
    runReceipt: runReceipt.document,
  });
  const candidateObservationBytes = Buffer.from(`${JSON.stringify(candidateObservation)}\n`, "utf8");
  const baseCompletion = compileCodexTestBuilderCompletion({
    workItem: workItem.document,
    workItemBytes: workItem.bytes,
    routePlan: routePlan.document,
    routePlanBytes: routePlan.bytes,
    dispatchPlan: dispatchPlan.document,
    dispatchPlanBytes: dispatchPlan.bytes,
    runReceipt: runReceipt.document,
    runReceiptBytes: runReceipt.bytes,
    candidateObservation,
    candidateObservationBytes,
  });
  const completion = bindCodexTestBuilderCompletion({
    workItem: workItem.document,
    workItemBytes: workItem.bytes,
    routePlan: routePlan.document,
    routePlanBytes: routePlan.bytes,
    dispatchPlan: dispatchPlan.document,
    dispatchPlanBytes: dispatchPlan.bytes,
    runReceipt: runReceipt.document,
    runReceiptBytes: runReceipt.bytes,
    candidateObservation,
    candidateObservationBytes,
    baseCompletion,
  });
  process.stdout.write(`${JSON.stringify(completion, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-test-builder-completion-error-v1",
    ok: false,
    errorType: error?.constructor?.name ?? "Error",
    errorMessage: safeError(error?.message ?? error),
    physicalPathsReturned: false,
    credentialValuesReturned: false,
    deterministicValidationPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 2;
}
