#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { observeCodexCandidateChanges } from "./codex-candidate-change-observer.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-codex-candidate-observer-"));
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

try {
  execFileSync(gitExecutable, ["init", "-b", "main", root], {
    env: gitEnvironment,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    stdio: "ignore",
  });
  git("config", "user.name", "EVAVO Candidate Observer Fixture");
  git("config", "user.email", "candidate-observer@example.invalid");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "subject.mjs"), "export const value = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "tests", "existing.test.mjs"), "// existing\n", "utf8");
  git("add", ".");
  git("commit", "-m", "fixture source");
  const sourceRevision = git("rev-parse", "HEAD").toLowerCase();

  const dispatchPlan = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-dispatch-plan-v1",
    eligible: true,
    workItemId: "work:candidate-observer-fixture",
    workerId: "spark-candidate-observer-fixture",
    workerClass: "test-generation",
    repository: "EVAVO-STUDIO/_candidate-observer-fixture",
    sourceRevision,
    workingDirectory: root,
  };
  const runReceipt = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-run-v1",
    workItemId: dispatchPlan.workItemId,
    workerId: dispatchPlan.workerId,
    repository: dispatchPlan.repository,
    sourceRevision,
    exitCode: 0,
    modelTurnCompleted: true,
    structuredTurnCompleted: true,
    candidateHeadAfter: sourceRevision,
    candidateHeadChanged: false,
    candidateDirtyAfter: true,
  };

  fs.writeFileSync(path.join(root, "tests", "existing.test.mjs"), "// changed\n", "utf8");
  fs.writeFileSync(path.join(root, "tests", "new-boundary.test.mjs"), "// new\n", "utf8");
  let observation = observeCodexCandidateChanges({
    dispatchPlan,
    runReceipt,
    observedAt: new Date("2026-09-01T05:02:01.000Z"),
  });
  assert.equal(observation.kind, "evavo-codex-candidate-change-observation-v1");
  assert.deepEqual(observation.changedPaths, ["tests/existing.test.mjs", "tests/new-boundary.test.mjs"]);
  assert.deepEqual(observation.trackedPaths, ["tests/existing.test.mjs"]);
  assert.deepEqual(observation.untrackedPaths, ["tests/new-boundary.test.mjs"]);
  assert.deepEqual(observation.stagedPaths, []);
  assert.equal(observation.indexChanged, false);
  assert.deepEqual(observation.unmergedPaths, []);
  assert.equal(observation.candidateDirty, true);
  assert.equal(observation.candidateHeadChanged, false);
  assert.equal(observation.candidateBytesMutatedByObserver, false);
  assert.equal(observation.physicalPathsReturned, false);
  assert.match(observation.observationSha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(observation).includes(root), false);

  git("add", "tests/existing.test.mjs");
  observation = observeCodexCandidateChanges({ dispatchPlan, runReceipt });
  assert.deepEqual(observation.stagedPaths, ["tests/existing.test.mjs"]);
  assert.equal(observation.indexChanged, true);
  assert.deepEqual(observation.changedPaths, ["tests/existing.test.mjs", "tests/new-boundary.test.mjs"]);

  const inconsistentDirtyReceipt = { ...runReceipt, candidateDirtyAfter: false };
  assert.throws(
    () => observeCodexCandidateChanges({ dispatchPlan, runReceipt: inconsistentDirtyReceipt }),
    /dirty state differs/,
  );

  const wrongSourcePlan = { ...dispatchPlan, sourceRevision: "b".repeat(40) };
  const wrongSourceRun = { ...runReceipt, sourceRevision: "b".repeat(40), candidateHeadAfter: "b".repeat(40) };
  assert.throws(
    () => observeCodexCandidateChanges({ dispatchPlan: wrongSourcePlan, runReceipt: wrongSourceRun }),
    /HEAD no longer matches/,
  );

  const movedHeadRun = { ...runReceipt, candidateHeadChanged: true };
  assert.throws(
    () => observeCodexCandidateChanges({ dispatchPlan, runReceipt: movedHeadRun }),
    /worker-authored commit or HEAD movement/,
  );

  console.log("Codex candidate change observer tests passed.");
  console.log("- tracked, untracked and staged paths are independently observed with NUL-safe Git commands");
  console.log("- the observation is pathless outside repository-relative evidence and does not mutate candidate bytes");
  console.log("- dirty-state, source-revision and worker-authored HEAD movement mismatches fail closed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
