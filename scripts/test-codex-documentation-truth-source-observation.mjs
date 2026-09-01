#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-doc-truth-source-"));
const REPOSITORY = path.join(TEMP, "evavo-agent-infrastructure");
fs.mkdirSync(REPOSITORY, { recursive: true });

const environment = {
  PATH: process.env.PATH ?? "",
  PATHEXT: process.env.PATHEXT ?? "",
  SYSTEMROOT: process.env.SYSTEMROOT ?? "",
  WINDIR: process.env.WINDIR ?? "",
  HOME: path.join(TEMP, "home"),
  USERPROFILE: path.join(TEMP, "home"),
  GIT_AUTHOR_NAME: "EVAVO Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "EVAVO Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "Never",
};
fs.mkdirSync(environment.HOME, { recursive: true });

function git(arguments_, cwd = REPOSITORY) {
  return execFileSync(process.platform === "win32" ? "git.exe" : "git", arguments_, {
    cwd,
    env: environment,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
  }).trim();
}

function copy(relativePath) {
  const source = path.join(ROOT, relativePath);
  const destination = path.join(REPOSITORY, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function run(now) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "scripts", "compile-codex-documentation-truth-source-observation.mjs"),
      "--repository-root",
      REPOSITORY,
      "--now",
      now,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const channel = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  return { result, document: JSON.parse(String(channel).trim()) };
}

try {
  for (const relativePath of [
    "config/codex-documentation-truth-physical-acceptance-v1.json",
    "config/worker-capacity-routing-v1.json",
    "config/codex-spark-capacity-status-v1.json",
    "config/codex-spark-physical-acceptance-v1.json",
    "config/codex-worker-adapter-v1.json",
    "config/worker-profiles/documentation-truth-v1.json",
  ]) copy(relativePath);

  git(["init", "-b", "main"]);
  git(["remote", "add", "origin", "https://github.com/EVAVO-STUDIO/evavo-agent-infrastructure.git"]);
  git(["add", "."]);
  git(["commit", "-m", "fixture source"]);
  const now = new Date().toISOString();

  {
    const { result, document } = run(now);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(document.repository, "EVAVO-STUDIO/evavo-agent-infrastructure");
    assert.equal(document.branch, "main");
    assert.equal(document.clean, true);
    assert.equal(document.originVerified, true);
    assert.deepEqual(document.normalWorkerClasses, ["test-generation"]);
    assert.equal(document.documentationTruthActivationState, "staged-only");
    assert.equal(Object.keys(document.currentBindings).length, 5);
    assert.match(document.sourceRevision, /^[0-9a-f]{40}$/);
    assert.match(document.sourceTreeSha, /^[0-9a-f]{40}$/);
    assert.match(document.sourceObservationSha256, /^[0-9a-f]{64}$/);
    assert.equal(document.networkUsed, false);
    assert.equal(document.repositoryMutationPerformed, false);
    assert.equal(document.publicationPerformed, false);
  }

  {
    fs.writeFileSync(path.join(REPOSITORY, "untracked.txt"), "dirty\n");
    const { result, document } = run(now);
    assert.equal(result.status, 1);
    assert.equal(document.observed, false);
    assert.match(document.errors[0], /clean checkout/);
    fs.rmSync(path.join(REPOSITORY, "untracked.txt"));
  }

  {
    git(["checkout", "-b", "feature"]);
    const { result, document } = run(now);
    assert.equal(result.status, 1);
    assert.match(document.errors[0], /branch main/);
    git(["checkout", "main"]);
    git(["branch", "-D", "feature"]);
  }

  {
    const routingPath = path.join(REPOSITORY, "config", "worker-capacity-routing-v1.json");
    const routing = JSON.parse(fs.readFileSync(routingPath, "utf8"));
    const route = routing.workerRoutes.find((entry) => entry.id === "codex-spark-pro");
    route.workerClasses = ["test-generation", "documentation-truth"];
    fs.writeFileSync(routingPath, `${JSON.stringify(routing, null, 2)}\n`);
    git(["add", "config/worker-capacity-routing-v1.json"]);
    git(["commit", "-m", "widen route"]);
    const { result, document } = run(now);
    assert.equal(result.status, 1);
    assert.match(document.errors[0], /staged-only state/);
  }

  console.log("Documentation-truth source observation tests passed.");
  console.log("- clean main, exact origin, Git source and policy bytes are bound together");
  console.log("- dirty, non-main and prematurely widened routes fail closed");
  console.log("- the observer performs no network, model, lease, Git mutation or publication effect");
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true });
}
