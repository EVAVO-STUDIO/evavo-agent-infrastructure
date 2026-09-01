#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_CHANGED_FILES = 1024;
const MAX_CHANGED_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CHANGED_BYTES = 64 * 1024 * 1024;

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, ordered(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(ordered(value));
}

export function sha256Bytes(value) {
  return createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8"))
    .digest("hex");
}

function safeRelativePath(value, label) {
  if (typeof value !== "string" || !value || value.length > 1024) {
    throw new Error(`${label} contains an invalid path.`);
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    /[\u0000-\u001f\u007f]/.test(normalized) ||
    parts.some((part) => part === "" || part === "." || part === ".." || part.toLowerCase() === ".git")
  ) {
    throw new Error(`${label} contains an unsafe repository path.`);
  }
  return normalized;
}

function samePath(left, right) {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function normalizeRoot(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new Error("Candidate working directory is invalid.");
  }
  const requested = path.resolve(value);
  const requestedStat = fs.lstatSync(requested);
  if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) {
    throw new Error("Candidate working directory must be a real non-symlink directory.");
  }
  const resolved = fs.realpathSync.native(requested);
  const resolvedStat = fs.lstatSync(resolved);
  if (!resolvedStat.isDirectory() || resolvedStat.isSymbolicLink()) {
    throw new Error("Candidate working directory must resolve to a real non-symlink directory.");
  }
  return resolved;
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
    LC_ALL: "C",
    LANG: "C",
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

function runGit(root, args, { acceptedExitCodes = [0] } = {}) {
  const command = [
    "--no-pager",
    "-c",
    "color.ui=false",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    ...args,
  ];
  const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", command, {
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
  if (values.at(-1) !== "") {
    throw new Error(`${label} did not use a complete NUL-delimited path envelope.`);
  }
  values.pop();
  const normalized = values.map((value) => safeRelativePath(value, label));
  const unique = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (unique.length !== normalized.length) {
    throw new Error(`${label} returned duplicate normalized paths.`);
  }
  return unique;
}

function unmergedPaths(buffer) {
  if (buffer.length === 0) return [];
  const values = buffer.toString("utf8").split("\0");
  if (values.at(-1) !== "") {
    throw new Error("Unmerged candidate list did not use a complete NUL-delimited envelope.");
  }
  values.pop();
  const paths = values.map((entry) => {
    const tabIndex = entry.indexOf("\t");
    if (tabIndex < 0) throw new Error("Unmerged candidate entry is malformed.");
    return safeRelativePath(entry.slice(tabIndex + 1), "Unmerged candidate list");
  });
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function fileSignature(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
}

function readStableRegularFile(file, label, maximumBytes = MAX_CHANGED_FILE_BYTES) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  if (before.size > maximumBytes) {
    throw new Error(`${label} exceeds the bounded ${maximumBytes}-byte limit.`);
  }
  const bytes = fs.readFileSync(file);
  const after = fs.lstatSync(file);
  if (!after.isFile() || after.isSymbolicLink() || fileSignature(before) !== fileSignature(after) || bytes.length !== after.size) {
    throw new Error(`${label} changed while it was being observed.`);
  }
  return { bytes, stat: after };
}

function gitIndexIdentity(root) {
  const value = text(runGit(root, ["rev-parse", "--git-path", "index"]), "Candidate Git index path");
  const indexPath = path.isAbsolute(value) ? value : path.resolve(root, value);
  const { bytes } = readStableRegularFile(indexPath, "Candidate Git index", MAX_GIT_OUTPUT_BYTES);
  return {
    sha256: sha256Bytes(bytes),
    byteLength: bytes.length,
  };
}

function resolveCandidateEntry(root, relativePath, origin) {
  const normalized = safeRelativePath(relativePath, "Candidate file manifest");
  const parts = normalized.split("/");
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT" && origin === "tracked") {
        return {
          path: normalized,
          origin,
          state: "deleted",
          byteLength: 0,
          sha256: null,
          executable: false,
        };
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Candidate file manifest rejects symbolic links: ${normalized}`);
    }
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new Error(`Candidate file manifest path has a non-directory parent: ${normalized}`);
    }
  }

  const resolved = fs.realpathSync.native(current);
  if (!samePath(current, resolved)) {
    throw new Error(`Candidate file manifest path resolves through a link: ${normalized}`);
  }
  const relativeResolved = path.relative(root, resolved);
  if (relativeResolved.startsWith("..") || path.isAbsolute(relativeResolved)) {
    throw new Error(`Candidate file manifest path escapes the candidate root: ${normalized}`);
  }
  const { bytes, stat } = readStableRegularFile(resolved, `Candidate file ${normalized}`);
  return {
    path: normalized,
    origin,
    state: "present",
    byteLength: bytes.length,
    sha256: sha256Bytes(bytes),
    executable: Boolean(stat.mode & 0o111),
  };
}

function candidateFileManifest(root, trackedPaths, untrackedPaths) {
  const changedPathCount = trackedPaths.length + untrackedPaths.length;
  if (changedPathCount > MAX_CHANGED_FILES) {
    throw new Error(`Candidate change set exceeds the bounded ${MAX_CHANGED_FILES}-file limit.`);
  }
  const manifest = [
    ...trackedPaths.map((value) => resolveCandidateEntry(root, value, "tracked")),
    ...untrackedPaths.map((value) => resolveCandidateEntry(root, value, "untracked")),
  ].sort((left, right) => left.path.localeCompare(right.path) || left.origin.localeCompare(right.origin));
  const totalBytes = manifest.reduce((sum, entry) => sum + entry.byteLength, 0);
  if (totalBytes > MAX_CHANGED_BYTES) {
    throw new Error(`Candidate change set exceeds the bounded ${MAX_CHANGED_BYTES}-byte content limit.`);
  }
  return { manifest, totalBytes };
}

function captureCandidateState(root, sourceRevision) {
  const indexBefore = gitIndexIdentity(root);
  const headBefore = text(runGit(root, ["rev-parse", "HEAD^{commit}"]), "Candidate HEAD").toLowerCase();
  if (!SHA1.test(headBefore) || headBefore !== sourceRevision) {
    throw new Error("Candidate HEAD no longer matches the admitted source revision.");
  }

  const trackedNameList = runGit(root, [
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
    "--",
  ]);
  const stagedNameList = runGit(root, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
    "--",
  ]);
  const untrackedList = runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const unmergedList = runGit(root, ["ls-files", "--unmerged", "-z"]);
  const status = runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]);
  const trackedPatch = runGit(root, [
    "diff",
    "--binary",
    "--full-index",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
    "--",
  ]);

  const trackedPaths = nulPaths(trackedNameList, "Tracked candidate path list");
  const stagedPaths = nulPaths(stagedNameList, "Staged candidate path list");
  const untrackedPaths = nulPaths(untrackedList, "Untracked candidate list");
  const candidateUnmergedPaths = unmergedPaths(unmergedList);
  const changedPaths = [...new Set([...trackedPaths, ...untrackedPaths])].sort((left, right) => left.localeCompare(right));
  const candidateDirty = status.length > 0;
  if (candidateDirty !== (changedPaths.length > 0 || stagedPaths.length > 0 || candidateUnmergedPaths.length > 0)) {
    throw new Error("Candidate Git status cannot be reconciled with its observed changed-path sets.");
  }

  const files = candidateFileManifest(root, trackedPaths, untrackedPaths);
  const untrackedManifest = files.manifest.filter((entry) => entry.origin === "untracked");
  const indexAfter = gitIndexIdentity(root);
  const headAfter = text(runGit(root, ["rev-parse", "HEAD^{commit}"]), "Candidate HEAD").toLowerCase();
  if (headAfter !== headBefore) throw new Error("Candidate HEAD changed during observation.");
  if (indexAfter.sha256 !== indexBefore.sha256 || indexAfter.byteLength !== indexBefore.byteLength) {
    throw new Error("Candidate Git index changed during observation.");
  }

  const candidateState = {
    schemaVersion: 1,
    kind: "evavo-codex-candidate-state-v1",
    sourceRevision,
    candidateHead: headAfter,
    candidateDirty,
    changedPaths,
    trackedPaths,
    untrackedPaths,
    stagedPaths,
    unmergedPaths: candidateUnmergedPaths,
    statusSha256: sha256Bytes(status),
    statusByteLength: status.length,
    trackedPathListSha256: sha256Bytes(trackedNameList),
    stagedPathListSha256: sha256Bytes(stagedNameList),
    untrackedListSha256: sha256Bytes(untrackedList),
    unmergedListSha256: sha256Bytes(unmergedList),
    trackedPatchSha256: sha256Bytes(trackedPatch),
    trackedPatchByteLength: trackedPatch.length,
    candidateFileManifest: files.manifest,
    candidateFileManifestSha256: sha256Bytes(Buffer.from(canonicalJson(files.manifest), "utf8")),
    untrackedFileManifestSha256: sha256Bytes(Buffer.from(canonicalJson(untrackedManifest), "utf8")),
    changedFileBytes: files.totalBytes,
    gitIndexSha256: indexAfter.sha256,
    gitIndexByteLength: indexAfter.byteLength,
  };
  return {
    candidateState,
    candidateStateSha256: sha256Bytes(Buffer.from(canonicalJson(candidateState), "utf8")),
  };
}

function stableCandidateState(root, sourceRevision) {
  const first = captureCandidateState(root, sourceRevision);
  const second = captureCandidateState(root, sourceRevision);
  if (first.candidateStateSha256 !== second.candidateStateSha256) {
    throw new Error("Candidate state changed between the two observation passes.");
  }
  return second;
}

export function observeCodexCandidateChanges({ dispatchPlan, runReceipt, observedAt = new Date() }) {
  if (!OBJECT(dispatchPlan)) throw new Error("Codex dispatch plan must be a JSON object.");
  if (!OBJECT(runReceipt)) throw new Error("Codex run receipt must be a JSON object.");
  if (dispatchPlan.kind !== "evavo-codex-worker-dispatch-plan-v1" || dispatchPlan.eligible !== true) {
    throw new Error("Codex dispatch plan is not eligible for candidate observation.");
  }
  if (runReceipt.kind !== "evavo-codex-worker-run-v1") {
    throw new Error("Codex run receipt kind is invalid for candidate observation.");
  }
  for (const field of ["workItemId", "workerId", "repository", "sourceRevision"]) {
    if (dispatchPlan[field] !== runReceipt[field]) {
      throw new Error(`Candidate observation identity differs between dispatch and run receipt: ${field}.`);
    }
  }
  if (typeof dispatchPlan.sourceRevision !== "string" || !SHA1.test(dispatchPlan.sourceRevision)) {
    throw new Error("Candidate observation requires an exact lowercase source revision.");
  }
  if (runReceipt.modelTurnCompleted !== true || runReceipt.structuredTurnCompleted !== true || Number(runReceipt.exitCode) !== 0) {
    throw new Error("Candidate observation requires a completed structured Codex model turn.");
  }
  if (runReceipt.candidateHeadChanged !== false) {
    throw new Error("Candidate observation rejects a worker-authored commit or HEAD movement.");
  }

  const candidateRoot = normalizeRoot(dispatchPlan.workingDirectory);
  const topLevel = fs.realpathSync.native(
    path.resolve(text(runGit(candidateRoot, ["rev-parse", "--show-toplevel"]), "Candidate Git root")),
  );
  if (!samePath(candidateRoot, topLevel)) {
    throw new Error("Dispatch working directory is not the exact candidate Git root.");
  }

  const stable = stableCandidateState(candidateRoot, dispatchPlan.sourceRevision);
  const state = stable.candidateState;
  if (typeof runReceipt.candidateHeadAfter === "string" && runReceipt.candidateHeadAfter.toLowerCase() !== state.candidateHead) {
    throw new Error("Candidate HEAD differs from the post-turn run receipt.");
  }
  if (typeof runReceipt.candidateDirtyAfter === "boolean" && runReceipt.candidateDirtyAfter !== state.candidateDirty) {
    throw new Error("Candidate dirty state differs from the post-turn run receipt.");
  }

  const observationTime = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (!Number.isFinite(observationTime.getTime())) {
    throw new Error("Candidate observation timestamp is invalid.");
  }
  const body = {
    schemaVersion: 1,
    kind: "evavo-codex-candidate-change-observation-v1",
    observedAt: observationTime.toISOString(),
    workItemId: dispatchPlan.workItemId,
    workerId: dispatchPlan.workerId,
    repository: dispatchPlan.repository,
    sourceRevision: dispatchPlan.sourceRevision,
    candidateHead: state.candidateHead,
    candidateHeadChanged: false,
    candidateDirty: state.candidateDirty,
    changedPaths: state.changedPaths,
    changedPathCount: state.changedPaths.length,
    trackedPaths: state.trackedPaths,
    untrackedPaths: state.untrackedPaths,
    stagedPaths: state.stagedPaths,
    stagedPathCount: state.stagedPaths.length,
    indexChanged: state.stagedPaths.length > 0,
    unmergedPaths: state.unmergedPaths,
    unmergedPathCount: state.unmergedPaths.length,
    statusSha256: state.statusSha256,
    trackedDiffSha256: state.trackedPatchSha256,
    trackedPathListSha256: state.trackedPathListSha256,
    stagedDiffSha256: state.stagedPathListSha256,
    untrackedListSha256: state.untrackedListSha256,
    unmergedListSha256: state.unmergedListSha256,
    trackedPatchSha256: state.trackedPatchSha256,
    trackedPatchByteLength: state.trackedPatchByteLength,
    candidateFileManifest: state.candidateFileManifest,
    candidateFileManifestSha256: state.candidateFileManifestSha256,
    untrackedFileManifestSha256: state.untrackedFileManifestSha256,
    changedFileBytes: state.changedFileBytes,
    gitIndexSha256: state.gitIndexSha256,
    gitIndexByteLength: state.gitIndexByteLength,
    candidateState: state,
    candidateStateSha256: stable.candidateStateSha256,
    snapshotStable: true,
    snapshotPasses: 2,
    gitObservationPerformed: true,
    candidateBytesMutatedByObserver: false,
    gitIndexMutationAccepted: false,
    workerCommitAccepted: false,
    physicalPathsReturned: false,
    credentialValuesReturned: false,
    deterministicValidationPerformed: false,
    publicationPerformed: false,
    truthBoundary: "This independent post-turn observation performs two stable Git and file-content passes over the isolated candidate. It binds the exact tracked binary patch, changed tracked/untracked file bytes, Git index identity and repository-relative path sets without returning physical paths or file contents. It does not trust the model summary, mutate candidate bytes, stage files, validate behavior, commit, push or publish.",
  };
  return {
    ...body,
    observationSha256: sha256Bytes(Buffer.from(canonicalJson(body), "utf8")),
  };
}
