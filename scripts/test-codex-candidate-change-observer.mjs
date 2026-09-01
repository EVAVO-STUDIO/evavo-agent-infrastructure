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
  PATH: process.env.PATH ?? "",
  PATHEXT: process.env.PATHEXT ?? "",
  SYSTEMROOT: process.env.SYSTEMROOT ?? "",
  WINDIR: process.env.WINDIR ?? "",
  HOME: process.env.HOME ?? "",
  USERPROFILE: process.env.USERPROFILE ?? "",
  LC_ALL: "C",
  LANG: "C",
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
  const first = observeCodexCandidateChanges({
    dispatchPlan,
    runReceipt,
    observedAt: new Date("2026-09-01T05:02:01.000Z"),
  });
  assert.equal(first.kind, "evavo-codex-candidate-change-observation-v1");
  assert.deepEqual(first.changedPaths, ["tests/existing.test.mjs", "tests/new-boundary.test.mjs"]);
  assert.deepEqual(first.trackedPaths, ["tests/existing.test.mjs"]);
  assert.deepEqual(first.untrackedPaths, ["tests/new-boundary.test.mjs"]);
  assert.deepEqual(first.stagedPaths, []);
  assert.deepEqual(first.unmergedPaths, []);
  assert.equal(first.indexChanged, false);
  assert.equal(first.candidateDirty, true);
  assert.equal(first.candidateHeadChanged, false);
  assert.equal(first.snapshotStable, true);
  assert.equal(first.snapshotPasses, 2);
  assert.equal(first.candidateBytesMutatedByObserver, false);
  assert.equal(first.physicalPathsReturned, false);
  assert.match(first.trackedPatchSha256, /^[0-9a-f]{64}$/);
  assert.match(first.candidateFileManifestSha256, /^[0-9a-f]{64}$/);
  assert.match(first.untrackedFileManifestSha256, /^[0-9a-f]{64}$/);
  assert.match(first.gitIndexSha256, /^[0-9a-f]{64}$/);
  assert.match(first.candidateStateSha256, /^[0-9a-f]{64}$/);
  assert.match(first.observationSha256, /^[0-9a-f]{64}$/);
  assert.equal(first.candidateFileManifest.length, 2);
  assert.deepEqual(first.candidateFileManifest.map((entry) => entry.path), first.changedPaths);
  assert.equal(first.candidateFileManifest.every((entry) => entry.state === "present"), true);
  assert.equal(first.candidateFileManifest.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)), true);
  assert.equal(JSON.stringify(first).includes(root), false);

  fs.writeFileSync(path.join(root, "tests", "new-boundary.test.mjs"), "// new bytes with same path\n", "utf8");
  const untrackedBytesChanged = observeCodexCandidateChanges({ dispatchPlan, runReceipt });
  assert.deepEqual(untrackedBytesChanged.changedPaths, first.changedPaths);
  assert.notEqual(untrackedBytesChanged.untrackedFileManifestSha256, first.untrackedFileManifestSha256);
  assert.notEqual(untrackedBytesChanged.candidateStateSha256, first.candidateStateSha256);

  fs.writeFileSync(path.join(root, "tests", "existing.test.mjs"), "// tracked bytes changed again\n", "utf8");
  const trackedBytesChanged = observeCodexCandidateChanges({ dispatchPlan, runReceipt });
  assert.deepEqual(trackedBytesChanged.changedPaths, first.changedPaths);
  assert.notEqual(trackedBytesChanged.trackedPatchSha256, untrackedBytesChanged.trackedPatchSha256);
  assert.notEqual(trackedBytesChanged.candidateStateSha256, untrackedBytesChanged.candidateStateSha256);

  git("add", "tests/existing.test.mjs");
  const staged = observeCodexCandidateChanges({ dispatchPlan, runReceipt });
  assert.deepEqual(staged.stagedPaths, ["tests/existing.test.mjs"]);
  assert.equal(staged.indexChanged, true);
  assert.deepEqual(staged.changedPaths, first.changedPaths);
  assert.notEqual(staged.gitIndexSha256, first.gitIndexSha256);

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

  if (process.platform !== "win32") {
    git("reset", "HEAD", "tests/existing.test.mjs");
    const link = path.join(root, "tests", "outside-link.test.mjs");
    fs.symlinkSync(path.join(root, "src", "subject.mjs"), link);
    assert.throws(
      () => observeCodexCandidateChanges({ dispatchPlan, runReceipt }),
      /symbolic links/,
    );
    fs.unlinkSync(link);
  }

  console.log("Codex candidate change observer tests passed.");
  console.log("- tracked, untracked, staged and unmerged paths are independently observed with NUL-safe Git commands");
  console.log("- exact tracked patch bytes, changed file bytes and Git index identity are digest-bound in two stable passes");
  console.log("- same-path byte drift, symlink content, dirty-state drift and worker-authored HEAD movement fail closed");
  console.log("- the observation returns repository-relative paths and digests only; it does not mutate candidate bytes");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
