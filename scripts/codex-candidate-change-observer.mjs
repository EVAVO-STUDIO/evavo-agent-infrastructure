#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, ordered(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(ordered(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeRelativePath(value, label) {
  if (typeof value !== "string" || !value || value.length > 1024) throw new Error(`${label} contains an invalid path.`);
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => part === "" || part === "." || part === ".." || part === ".git")
  ) {
    throw new Error(`${label} contains an unsafe repository path.`);
  }
  return normalized;
}

function normalizeRoot(value) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Candidate working directory must be a real non-symlink directory.");
  return resolved;
}

function samePath(left, right) {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function gitEnvironment() {
  return {
    PATH: process.env.PATH ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    WINDIR: process.env.WINDIR ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    TMP: process.env.TMP ?? "",
    TEMP: process.env.TEMP ?? "",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function runGit(root, args, { acceptedExitCodes = [0] } = {}) {
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", args, {
    cwd: root,
    env: gitEnvironment(),
    encoding: null,
    input: undefined,
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  if (result.error) throw result.error;
  if (!acceptedExitCodes.includes(result.status)) {
    const detail = Buffer.concat([
      Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0),
      Buffer.from("\n"),
      Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
    ]).toString("utf8").trim().slice(0, 2000);
    throw new Error(`Candidate Git observation failed for ${args[0]} with exit code ${result.status}: ${detail}`);
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
}

function text(buffer, label) {
  const value = buffer.toString("utf8").trim();
  if (!value) throw new Error(`${label} returned no value.`);
  return value;
}

function nulPaths(buffer, label) {
  if (buffer.length === 0) return [];
  const values = buffer.toString("utf8").split("\0");
  if (values.at(-1) !== "") throw new Error(`${label} did not use a complete NUL-delimited path envelope.`);
  values.pop();
  const normalized = values.map((value) => safeRelativePath(value, label));
  const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== normalized.length) throw new Error(`${label} returned duplicate normalized paths.`);
  return unique;
}

export function observeCodexCandidateChanges({ dispatchPlan, runReceipt, observedAt = new Date() }) {
  if (!OBJECT(dispatchPlan)) throw new Error("Codex dispatch plan must be a JSON object.");
  if (!OBJECT(runReceipt)) throw new Error("Codex run receipt must be a JSON object.");
  if (dispatchPlan.kind !== "evavo-codex-worker-dispatch-plan-v1" || dispatchPlan.eligible !== true) {
    throw new Error("Codex dispatch plan is not eligible for candidate observation.");
  }
  if (runReceipt.kind !== "evavo-codex-worker-run-v1") throw new Error("Codex run receipt kind is invalid for candidate observation.");
  for (const field of ["workItemId", "workerId", "repository", "sourceRevision"]) {
    if (dispatchPlan[field] !== runReceipt[field]) throw new Error(`Candidate observation identity differs between dispatch and run receipt: ${field}.`);
  }
  if (typeof dispatchPlan.sourceRevision !== "string" || !SHA1.test(dispatchPlan.sourceRevision)) {
    throw new Error("Candidate observation requires an exact lowercase source revision.");
  }
  if (runReceipt.modelTurnCompleted !== true || runReceipt.structuredTurnCompleted !== true || Number(runReceipt.exitCode) !== 0) {
    throw new Error("Candidate observation requires a completed structured Codex model turn.");
  }

  const candidateRoot = normalizeRoot(dispatchPlan.workingDirectory);
  const topLevel = fs.realpathSync.native(path.resolve(text(runGit(candidateRoot, ["rev-parse", "--show-toplevel"]), "Candidate Git root")));
  if (!samePath(candidateRoot, topLevel)) throw new Error("Dispatch working directory is not the exact candidate Git root.");

  const head = text(runGit(candidateRoot, ["rev-parse", "HEAD^{commit}"]), "Candidate HEAD").toLowerCase();
  if (!SHA1.test(head)) throw new Error("Candidate HEAD is invalid.");
  if (head !== dispatchPlan.sourceRevision || head !== runReceipt.sourceRevision) {
    throw new Error("Candidate HEAD no longer matches the admitted source revision.");
  }
  if (typeof runReceipt.candidateHeadAfter === "string" && runReceipt.candidateHeadAfter.toLowerCase() !== head) {
    throw new Error("Candidate HEAD differs from the post-turn run receipt.");
  }
  if (runReceipt.candidateHeadChanged !== false) throw new Error("Candidate observation rejects a worker-authored commit or HEAD movement.");

  const trackedDiff = runGit(candidateRoot, ["diff", "--name-only", "-z", "--no-renames", "HEAD", "--"]);
  const stagedDiff = runGit(candidateRoot, ["diff", "--cached", "--name-only", "-z", "--no-renames", "HEAD", "--"]);
  const untrackedList = runGit(candidateRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const unmergedList = runGit(candidateRoot, ["ls-files", "--unmerged", "-z"]);
  const status = runGit(candidateRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);

  const trackedPaths = nulPaths(trackedDiff, "Tracked candidate diff");
  const stagedPaths = nulPaths(stagedDiff, "Staged candidate diff");
  const untrackedPaths = nulPaths(untrackedList, "Untracked candidate list");
  const unmergedEntries = unmergedList.length === 0 ? [] : unmergedList.toString("utf8").split("\0").filter(Boolean);
  const unmergedPaths = [...new Set(unmergedEntries.map((entry) => {
    const tabIndex = entry.indexOf("\t");
    if (tabIndex < 0) throw new Error("Unmerged candidate entry is malformed.");
    return safeRelativePath(entry.slice(tabIndex + 1), "Unmerged candidate list");
  }))].sort((left, right) => left.localeCompare(right));
  const changedPaths = [...new Set([...trackedPaths, ...untrackedPaths])].sort((left, right) => left.localeCompare(right));
  const candidateDirty = status.length > 0;
  if (candidateDirty !== (changedPaths.length > 0 || stagedPaths.length > 0 || unmergedPaths.length > 0)) {
    throw new Error("Candidate Git status cannot be reconciled with its observed changed-path sets.");
  }
  if (typeof runReceipt.candidateDirtyAfter === "boolean" && runReceipt.candidateDirtyAfter !== candidateDirty) {
    throw new Error("Candidate dirty state differs from the post-turn run receipt.");
  }

  const observationTime = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (!Number.isFinite(observationTime.getTime())) throw new Error("Candidate observation timestamp is invalid.");
  const body = {
    schemaVersion: 1,
    kind: "evavo-codex-candidate-change-observation-v1",
    observedAt: observationTime.toISOString(),
    workItemId: dispatchPlan.workItemId,
    workerId: dispatchPlan.workerId,
    repository: dispatchPlan.repository,
    sourceRevision: dispatchPlan.sourceRevision,
    candidateHead: head,
    candidateHeadChanged: false,
    candidateDirty,
    changedPaths,
    changedPathCount: changedPaths.length,
    trackedPaths,
    untrackedPaths,
    stagedPaths,
    stagedPathCount: stagedPaths.length,
    indexChanged: stagedPaths.length > 0,
    unmergedPaths,
    unmergedPathCount: unmergedPaths.length,
    statusSha256: sha256(status),
    trackedDiffSha256: sha256(trackedDiff),
    stagedDiffSha256: sha256(stagedDiff),
    untrackedListSha256: sha256(untrackedList),
    unmergedListSha256: sha256(unmergedList),
    gitObservationPerformed: true,
    candidateBytesMutatedByObserver: false,
    gitIndexMutationAccepted: false,
    workerCommitAccepted: false,
    physicalPathsReturned: false,
    credentialValuesReturned: false,
    deterministicValidationPerformed: false,
    publicationPerformed: false,
    truthBoundary: "This independent post-turn observation reads the isolated candidate Git state and returns only repository-relative path and digest evidence. It does not trust the model summary, mutate candidate bytes, stage files, validate behavior, commit, push or publish.",
  };
  return {
    ...body,
    observationSha256: sha256(Buffer.from(canonicalJson(body), "utf8")),
  };
}
