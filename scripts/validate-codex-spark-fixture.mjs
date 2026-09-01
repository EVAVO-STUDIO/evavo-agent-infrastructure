#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [sealReceiptPath] = process.argv.slice(2);
if (!sealReceiptPath) {
  console.error("Usage: node scripts/validate-codex-spark-fixture.mjs <seal-receipt.json>");
  process.exit(2);
}
const seal = JSON.parse(fs.readFileSync(path.resolve(sealReceiptPath), "utf8"));
if (seal.kind !== "evavo-autonomous-candidate-seal-v1" || seal.sealed !== true) throw new Error("A sealed autonomous candidate receipt is required.");
const candidate = seal.validationCandidate;
if (!candidate || candidate.contract !== "evavo_mainline_candidate_worktree_v1") throw new Error("Sealed receipt lacks a clean validation candidate.");
const cwd = fs.realpathSync.native(path.resolve(candidate.path));
const stat = fs.lstatSync(cwd);
if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Validation candidate must be a real directory.");

const git = (args) => execFileSync(process.platform === "win32" ? "git.exe" : "git", args, {
  cwd,
  encoding:"utf8",
  shell:false,
  windowsHide:true,
  timeout:120000,
  maxBuffer:16 * 1024 * 1024,
  env:{
    PATH:process.env.PATH ?? "",
    PATHEXT:process.env.PATHEXT ?? "",
    SYSTEMROOT:process.env.SYSTEMROOT ?? "",
    WINDIR:process.env.WINDIR ?? "",
    HOME:process.env.HOME ?? "",
    USERPROFILE:process.env.USERPROFILE ?? "",
    GIT_TERMINAL_PROMPT:"0",
    GCM_INTERACTIVE:"Never",
    GIT_CONFIG_NOSYSTEM:"1"
  }
}).trim();

const root = fs.realpathSync.native(path.resolve(git(["rev-parse","--show-toplevel"])));
if (root !== cwd) throw new Error("Validation candidate path is not the exact Git root.");
const beforeHead = git(["rev-parse","HEAD^{commit}"]).toLowerCase();
const beforeTree = git(["rev-parse","HEAD^{tree}"]).toLowerCase();
const beforeStatus = git(["status","--porcelain=v1","--untracked-files=all"]);
if (beforeHead !== String(seal.commitSha).toLowerCase() || beforeTree !== String(seal.treeSha).toLowerCase() || beforeStatus) {
  throw new Error("Validation candidate is not the exact clean sealed commit/tree.");
}

const env = {
  PATH:process.env.PATH ?? "",
  PATHEXT:process.env.PATHEXT ?? "",
  SYSTEMROOT:process.env.SYSTEMROOT ?? "",
  WINDIR:process.env.WINDIR ?? "",
  HOME:process.env.HOME ?? "",
  USERPROFILE:process.env.USERPROFILE ?? "",
  NODE_NO_WARNINGS:"1",
  CI:"1"
};
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, ["--test"], {
  cwd,
  env,
  encoding:"utf8",
  shell:false,
  windowsHide:true,
  timeout:120000,
  maxBuffer:4 * 1024 * 1024,
});
const completedAt = new Date().toISOString();
const afterHead = git(["rev-parse","HEAD^{commit}"]).toLowerCase();
const afterTree = git(["rev-parse","HEAD^{tree}"]).toLowerCase();
const afterStatus = git(["status","--porcelain=v1","--untracked-files=all"]);
const unchanged = afterHead === beforeHead && afterTree === beforeTree && afterStatus.length === 0;
const passed = result.status === 0 && unchanged;
const hash = (value) => createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
const summarize = (value) => {
  const text = String(value ?? "");
  const bytes = Buffer.byteLength(text,"utf8");
  const preview = Buffer.from(text,"utf8").subarray(0,32768).toString("utf8");
  return {bytes, sha256:hash(text), preview, truncated:bytes > Buffer.byteLength(preview,"utf8")};
};

console.log(JSON.stringify({
  schemaVersion:1,
  kind:"evavo-codex-spark-fixture-validation-v1",
  workItemId:seal.workItemId,
  repository:seal.repository,
  commitSha:seal.commitSha,
  treeSha:seal.treeSha,
  startedAt,
  completedAt,
  command:{executable:process.execPath,args:["--test"],networkExpected:false},
  exitCode:result.status,
  signal:result.signal ?? null,
  error:result.error?.message ?? null,
  stdout:summarize(result.stdout),
  stderr:summarize(result.stderr),
  candidateHeadBefore:beforeHead,
  candidateHeadAfter:afterHead,
  candidateTreeBefore:beforeTree,
  candidateTreeAfter:afterTree,
  candidateCleanAfter:afterStatus.length === 0,
  candidateUnchanged:unchanged,
  passed,
  modelTurnPerformed:false,
  publicationPerformed:false,
  truthBoundary:"This fixture validator runs only Node's built-in test runner against the exact sealed clean disposable candidate. Passing proves the fixture test executes successfully and validation did not alter the candidate; it is not production publication approval."
}, null, 2));
process.exit(passed ? 0 : 1);
