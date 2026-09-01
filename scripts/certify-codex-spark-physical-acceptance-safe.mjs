#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const developmentStudioInput = option("--development-studio-root");
const outputRootInput = option("--output-root");
if (!developmentStudioInput) {
  console.error("Usage: node scripts/certify-codex-spark-physical-acceptance-safe.mjs --development-studio-root <dir> [--output-root <dir>]");
  process.exit(2);
}
if (process.env.EVAVO_CODEX_SPARK_CERTIFICATION_ENABLED !== "1") {
  console.error("Physical Spark certification requires EVAVO_CODEX_SPARK_CERTIFICATION_ENABLED=1.");
  process.exit(1);
}

const realDirectory = (value, label) => {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory.`);
  return resolved;
};
const regularFile = (value, label) => {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  return resolved;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const git = (root, argv) => execFileSync(process.platform === "win32" ? "git.exe" : "git", argv, {
  cwd: root,
  encoding: "utf8",
  shell: false,
  windowsHide: true,
  timeout: 120_000,
  env: {
    PATH: process.env.PATH ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    WINDIR: process.env.WINDIR ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1",
  },
}).trim();

const agentRoot = realDirectory(process.cwd(), "Agent Infrastructure root");
const devRoot = realDirectory(developmentStudioInput, "Development Studio root");
const legacyCertifier = regularFile(path.join(agentRoot, "scripts", "certify-codex-spark-physical-acceptance.mjs"), "staged Spark certifier");
const fixtureCleanup = regularFile(path.join(devRoot, "scripts", "cleanup-autonomous-fixture-candidate.mjs"), "fixture candidate cleanup authority");
const canonicalRoot = path.resolve(outputRootInput ?? (process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "EVAVO", "AutonomousImprovement", "SparkCertification")
  : path.join(os.tmpdir(), "EVAVO", "AutonomousImprovement", "SparkCertification")));
fs.mkdirSync(canonicalRoot, { recursive: true, mode: 0o700 });
const stagingParent = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-certification-stage-"));

const cleanupReceipts = [];
let runRoot = null;
let cleanupComplete = false;
let child = null;
try {
  child = spawnSync(process.execPath, [legacyCertifier, "--development-studio-root", devRoot, "--output-root", stagingParent], {
    cwd: agentRoot,
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30 * 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });

  const runDirectories = fs.readdirSync(stagingParent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("certification-"))
    .map((entry) => path.join(stagingParent, entry.name));
  if (runDirectories.length !== 1) throw new Error(`Expected exactly one staged certification run, found ${runDirectories.length}.`);
  runRoot = realDirectory(runDirectories[0], "staged certification run");
  const evidenceRoot = realDirectory(path.join(runRoot, "evidence"), "staged certification evidence");
  const fixtureRepository = realDirectory(path.join(runRoot, "fixture-repository"), "disposable fixture repository");

  const cleanupIfPresent = (relative) => {
    const receiptFile = path.join(evidenceRoot, relative);
    if (!fs.existsSync(receiptFile)) return;
    const receipt = readJson(receiptFile);
    const candidate = receipt?.candidate?.contract === "evavo_mainline_candidate_worktree_v1"
      ? receipt.candidate
      : receipt?.validationCandidate?.contract === "evavo_mainline_candidate_worktree_v1"
        ? receipt.validationCandidate
        : null;
    if (!candidate || !candidate.path || !fs.existsSync(candidate.path)) return;
    const result = spawnSync(process.execPath, [fixtureCleanup, receiptFile, runRoot], {
      cwd: devRoot,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 180_000,
    });
    if (result.status !== 0) throw new Error(`Fixture candidate cleanup failed for ${relative}: ${(result.stderr || result.stdout || "").trim().slice(0, 4096)}`);
    const cleanup = JSON.parse(result.stdout);
    if (cleanup.removed !== true || cleanup.mainUnchanged !== true || cleanup.primaryCheckoutClean !== true) {
      throw new Error(`Fixture candidate cleanup receipt was not affirmative for ${relative}.`);
    }
    cleanupReceipts.push({ receipt: relative, result: cleanup });
  };

  // Sealed validation candidate first; dirty candidate may already have been removed by sealing.
  cleanupIfPresent("14-seal.json");
  cleanupIfPresent("07-candidate.json");

  const workFile = regularFile(path.join(evidenceRoot, "01-work-ready.json"), "fixture work item");
  const work = readJson(workFile);
  if (work.fixtureOnly !== true || work.repository !== "EVAVO-STUDIO/_autonomous-spark-fixture") {
    throw new Error("Staged certification work is not the dedicated disposable fixture.");
  }
  const observedMain = git(fixtureRepository, ["rev-parse", "refs/heads/main"]);
  if (observedMain.toLowerCase() !== String(work.sourceRevision ?? "").toLowerCase()) {
    throw new Error("Disposable fixture main no longer matches the admitted source revision.");
  }
  if (git(fixtureRepository, ["status", "--porcelain=v1", "--untracked-files=all"]).trim()) {
    throw new Error("Disposable fixture primary checkout is not clean after certification cleanup.");
  }
  if (git(fixtureRepository, ["remote"]).trim()) throw new Error("Disposable fixture unexpectedly has a configured Git remote.");
  const worktreeList = git(fixtureRepository, ["worktree", "list", "--porcelain"]);
  const registeredWorktrees = worktreeList.split(/\r?\n/).filter((line) => line.startsWith("worktree "));
  if (registeredWorktrees.length !== 1) throw new Error(`Certification cleanup left ${registeredWorktrees.length} registered worktrees.`);
  const onlyWorktree = fs.realpathSync.native(path.resolve(registeredWorktrees[0].slice("worktree ".length)));
  if (onlyWorktree !== fixtureRepository) throw new Error("Certification cleanup left a non-primary registered worktree.");
  cleanupComplete = true;

  if (child.status !== 0) {
    const detail = `${child.stdout ?? ""}\n${child.stderr ?? ""}`.trim().slice(0, 8192);
    throw new Error(`Staged physical certification did not succeed (${child.status}): ${detail}`);
  }
  let stagedTerminal;
  try {
    stagedTerminal = JSON.parse(String(child.stdout ?? "").trim());
  } catch {
    throw new Error("Staged physical certifier did not emit one valid terminal JSON receipt.");
  }
  if (stagedTerminal.kind !== "evavo-codex-spark-certification-run-v1" || stagedTerminal.accepted !== true) {
    throw new Error("Staged physical certification receipt was not accepted.");
  }
  const stagedAcceptancePath = regularFile(stagedTerminal.acceptancePath, "staged physical acceptance");
  if (!stagedAcceptancePath.startsWith(stagingParent + path.sep)) throw new Error("Staged acceptance escaped the private certification staging root.");
  const acceptance = readJson(stagedAcceptancePath);
  if (acceptance.kind !== "evavo-codex-spark-physical-acceptance-v1" || acceptance.accepted === false) {
    throw new Error("Staged acceptance document is invalid.");
  }

  const acceptedRoot = path.join(canonicalRoot, "accepted");
  fs.mkdirSync(acceptedRoot, { recursive: true, mode: 0o700 });
  const canonicalAcceptancePath = path.join(acceptedRoot, `acceptance-${Date.now()}.json`);
  fs.copyFileSync(stagedAcceptancePath, canonicalAcceptancePath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(canonicalAcceptancePath, 0o600);

  console.log(JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-spark-safe-certification-run-v1",
    accepted: true,
    acceptedWorkerClasses: stagedTerminal.acceptedWorkerClasses,
    maximumConcurrency: stagedTerminal.maximumConcurrency,
    acceptancePath: canonicalAcceptancePath,
    stagedAcceptancePromotedOnlyAfterCleanup: true,
    fixtureRepositoryMainUnchanged: true,
    fixtureRepositoryClean: true,
    fixtureRepositoryRemoteCount: 0,
    registeredWorktreesAfterCleanup: 1,
    cleanupReceipts,
    publicationPerformed: false,
    productRepositoryTouched: false,
    truthBoundary: "The effectful certification harness ran only in a private staging root. Its acceptance was promoted into the canonical accepted directory only after an independent Development Studio cleanup authority removed all remaining detached candidates and the supervisor proved the disposable fixture main ref remained unchanged, clean and remote-less."
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-spark-safe-certification-run-v1",
    accepted: false,
    cleanupComplete,
    stagingRootPreservedForRecovery: cleanupComplete !== true,
    stagingRoot: cleanupComplete ? null : stagingParent,
    error: String(error?.message ?? error).slice(0, 8192),
    publicationPerformed: false,
    productRepositoryTouched: false,
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (cleanupComplete) fs.rmSync(stagingParent, { recursive: true, force: true });
}
