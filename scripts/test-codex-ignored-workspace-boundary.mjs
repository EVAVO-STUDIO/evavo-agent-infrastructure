#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  bindContainedCompletion,
  bindContainedDispatch,
  bindContainedRunReceipt,
  canonicalJson,
  observeIgnoredWorkspace,
  requireZeroIgnoredWorkspace,
  sha256Bytes,
  verifyZeroIgnoredObservation,
} from "./codex-ignored-workspace-boundary-core.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-ignored-workspace-boundary-"));
const gitExecutable = process.platform === "win32" ? "git.exe" : "git";
const gitEnvironment = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "Never",
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = (...args) => execFileSync(gitExecutable, args, {
  cwd: root,
  env: gitEnvironment,
  encoding: "utf8",
  shell: false,
  windowsHide: true,
  timeout: 120_000,
  maxBuffer: 4 * 1024 * 1024,
}).trim();
const digest = (value) => sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
const withDigest = (body, field) => ({ ...body, [field]: digest(body) });
const bytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`, "utf8");

try {
  execFileSync(gitExecutable, ["init", "-b", "main", root], {
    env: gitEnvironment,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    stdio: "ignore",
  });
  git("config", "user.name", "EVAVO Ignored Boundary Fixture");
  git("config", "user.email", "ignored-boundary@example.invalid");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, ".gitignore"), "ignored-cache/\n*.secret-cache\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "subject.mjs"), "export const value = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "tests", "subject.test.mjs"), "// baseline\n", "utf8");
  git("add", ".");
  git("commit", "-m", "fixture source");
  const sourceRevision = git("rev-parse", "HEAD").toLowerCase();

  const baseline = requireZeroIgnoredWorkspace({
    workingDirectory: root,
    sourceRevision,
    observedAt: new Date("2026-09-01T05:00:00.000Z"),
  });
  const verified = verifyZeroIgnoredObservation(baseline, { sourceRevision });
  assert.equal(verified.state.ignoredPathCount, 0);
  assert.equal(verified.state.ignoredPathListByteLength, 0);
  assert.equal(verified.state.ignoredFilesPresent, false);
  assert.equal(verified.state.ignoredFilesAccepted, false);
  assert.equal(baseline.ignoredPathsReturned, false);
  assert.equal(JSON.stringify(baseline).includes(root), false);

  fs.mkdirSync(path.join(root, "ignored-cache"), { recursive: true });
  fs.writeFileSync(path.join(root, "ignored-cache", "hidden.json"), "{\"hidden\":true}\n", "utf8");
  const contaminated = observeIgnoredWorkspace({ workingDirectory: root, sourceRevision });
  assert.equal(contaminated.ignoredWorkspaceState.ignoredPathCount, 1);
  assert.equal(contaminated.ignoredWorkspaceState.ignoredFilesPresent, true);
  assert.equal(contaminated.ignoredPathsReturned, false);
  assert.equal(JSON.stringify(contaminated).includes("ignored-cache"), false);
  assert.equal(JSON.stringify(contaminated).includes("hidden.json"), false);
  assert.throws(
    () => requireZeroIgnoredWorkspace({ workingDirectory: root, sourceRevision }),
    /ignored workspace content is not admitted/,
  );
  fs.rmSync(path.join(root, "ignored-cache"), { recursive: true, force: true });

  const zeroBefore = requireZeroIgnoredWorkspace({
    workingDirectory: root,
    sourceRevision,
    observedAt: new Date("2026-09-01T05:01:00.000Z"),
  });
  const baseDispatchBody = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-dispatch-plan-v1",
    eligible: true,
    dispatchBindingVersion: 1,
    workItemId: "work:ignored-boundary-fixture",
    workerId: "spark-ignored-boundary-fixture",
    workerClass: "test-generation",
    repository: "EVAVO-STUDIO/example",
    sourceRevision,
    workingDirectory: root,
    validationAuthority: false,
    publicationAuthority: false,
    paidFallbackUsed: false,
  };
  const baseDispatch = withDigest(baseDispatchBody, "dispatchPlanSha256");
  const containedDispatch = bindContainedDispatch({
    baseDispatchPlan: baseDispatch,
    baseDispatchPlanBytes: bytes(baseDispatch),
    ignoredObservation: zeroBefore,
    ignoredObservationBytes: bytes(zeroBefore),
  });
  assert.equal(containedDispatch.containedDispatchBindingVersion, 1);
  assert.equal(containedDispatch.ignoredWorkspaceBaselinePathCount, 0);
  assert.equal(containedDispatch.ignoredWorkspaceFilesAccepted, false);
  assert.match(containedDispatch.dispatchPlanSha256, /^[0-9a-f]{64}$/);

  const dispatchBytes = bytes(containedDispatch);
  const baseRun = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-run-v1",
    dispatchPlanSha256: containedDispatch.dispatchPlanSha256,
    dispatchPlanBytesSha256: sha256Bytes(dispatchBytes),
    modelTurnCompleted: true,
    structuredTurnCompleted: true,
    deterministicValidationPerformed: false,
    publicationPerformed: false,
    paidFallbackUsed: false,
  };
  const zeroAfter = requireZeroIgnoredWorkspace({
    workingDirectory: root,
    sourceRevision,
    observedAt: new Date("2026-09-01T05:02:00.000Z"),
  });
  const containedRun = bindContainedRunReceipt({
    dispatchPlan: containedDispatch,
    dispatchPlanBytes: dispatchBytes,
    baseRunReceipt: baseRun,
    baseRunReceiptBytes: bytes(baseRun),
    ignoredBefore: zeroBefore,
    ignoredBeforeBytes: bytes(zeroBefore),
    ignoredAfter: zeroAfter,
    ignoredAfterBytes: bytes(zeroAfter),
  });
  assert.equal(containedRun.containedRunBindingVersion, 1);
  assert.equal(containedRun.ignoredWorkspaceBoundaryAccepted, true);
  assert.equal(containedRun.modelTurnCompleted, true);
  assert.equal(containedRun.structuredTurnCompleted, true);
  assert.match(containedRun.runReceiptSha256, /^[0-9a-f]{64}$/);

  const runBytes = bytes(containedRun);
  const baseCompletionBody = {
    schemaVersion: 1,
    kind: "evavo-codex-test-builder-completion-v1",
    workItemId: containedDispatch.workItemId,
    dispatchPlanSha256: containedDispatch.dispatchPlanSha256,
    runReceiptBytesSha256: sha256Bytes(runBytes),
    deterministicValidationPerformed: false,
    publicationPerformed: false,
  };
  const baseCompletion = withDigest(baseCompletionBody, "completionSha256");
  const completion = bindContainedCompletion({
    dispatchPlan: containedDispatch,
    dispatchPlanBytes: dispatchBytes,
    runReceipt: containedRun,
    runReceiptBytes: runBytes,
    baseCompletion,
    baseCompletionBytes: bytes(baseCompletion),
    ignoredBefore: zeroAfter,
    ignoredBeforeBytes: bytes(zeroAfter),
    ignoredAfter: zeroAfter,
    ignoredAfterBytes: bytes(zeroAfter),
  });
  assert.equal(completion.containedCompletionBindingVersion, 1);
  assert.equal(completion.ignoredWorkspaceBoundaryAccepted, true);
  assert.equal(completion.ignoredWorkspacePathCount, 0);
  assert.equal(completion.ignoredWorkspaceFilesAccepted, false);
  assert.match(completion.completionSha256, /^[0-9a-f]{64}$/);

  fs.mkdirSync(path.join(root, "ignored-cache"), { recursive: true });
  fs.writeFileSync(path.join(root, "ignored-cache", "post-turn.bin"), "hidden\n", "utf8");
  const hiddenAfter = observeIgnoredWorkspace({ workingDirectory: root, sourceRevision });
  assert.throws(
    () => bindContainedRunReceipt({
      dispatchPlan: containedDispatch,
      dispatchPlanBytes: dispatchBytes,
      baseRunReceipt: baseRun,
      baseRunReceiptBytes: bytes(baseRun),
      ignoredBefore: zeroBefore,
      ignoredBeforeBytes: bytes(zeroBefore),
      ignoredAfter: hiddenAfter,
      ignoredAfterBytes: bytes(hiddenAfter),
    }),
    /zero-ignored-file state/,
  );

  console.log("Codex ignored-workspace boundary tests passed.");
  console.log("- ignored path names and file contents remain undisclosed while count and digest evidence are retained");
  console.log("- dispatch requires a stable zero-ignored baseline at the exact candidate root and source revision");
  console.log("- run and completion preserve zero-ignored state continuity and fail closed on hidden workspace residue");
  console.log("- model completion remains separate from deterministic validation, commit, push and publication");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
