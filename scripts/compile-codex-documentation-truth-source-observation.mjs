#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const GIT_SHA = /^[0-9a-f]{40}$/;
const EXPECTED_REPOSITORY = "EVAVO-STUDIO/evavo-agent-infrastructure";
const POLICY_RELATIVE = "config/codex-documentation-truth-physical-acceptance-v1.json";

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, ordered(value[key])]),
  );
}
const canonicalJson = (value) => JSON.stringify(ordered(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function exactText(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000\r\n]/.test(value)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value.trim();
}

function realDirectory(value, label) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real non-symlink directory.`);
  return resolved;
}

function regularFile(root, relativePath, label, maximum = 4 * 1024 * 1024) {
  const candidate = path.join(root, relativePath);
  const resolved = fs.realpathSync.native(candidate);
  const stat = fs.lstatSync(resolved);
  const relative = path.relative(root, resolved);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    stat.size < 2 ||
    stat.size > maximum
  ) throw new Error(`${label} must be a bounded regular file inside the repository.`);
  return resolved;
}

function readJsonBinding(root, relativePath) {
  const resolved = regularFile(root, relativePath, `Source binding ${relativePath}`);
  const bytes = fs.readFileSync(resolved);
  let document;
  try { document = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`Source binding ${relativePath} is not valid UTF-8 JSON.`); }
  if (!OBJECT(document)) throw new Error(`Source binding ${relativePath} must contain one JSON object.`);
  return { sha256: sha256(bytes), byteLength: bytes.length, document };
}

function gitEnvironment() {
  return {
    PATH: process.env.PATH ?? "",
    PATHEXT: process.env.PATHEXT ?? "",
    SYSTEMROOT: process.env.SYSTEMROOT ?? "",
    WINDIR: process.env.WINDIR ?? "",
    HOME: process.env.HOME ?? "",
    USERPROFILE: process.env.USERPROFILE ?? "",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function git(root, arguments_) {
  return execFileSync(process.platform === "win32" ? "git.exe" : "git", arguments_, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: gitEnvironment(),
  }).trim();
}

function canonicalRepositoryFromRemote(value) {
  const remote = exactText(value, "Git origin", 2048)
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/")
    .replace(/\.git$/i, "");
  const match = remote.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/i);
  if (!match) throw new Error("Git origin is not a canonical GitHub repository URL.");
  return match[1];
}

function parseArguments(values) {
  let repositoryRoot = DEFAULT_ROOT;
  let now = new Date();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!value) throw new Error("Options require values.");
    if (key === "--repository-root") repositoryRoot = value;
    else if (key === "--now") now = new Date(value);
    else throw new Error(`Unsupported option: ${key}`);
  }
  if (!Number.isFinite(now.getTime())) throw new Error("Observation time is invalid.");
  return { repositoryRoot: realDirectory(repositoryRoot, "repository root"), now };
}

try {
  const { repositoryRoot, now } = parseArguments(process.argv.slice(2));
  const gitRoot = realDirectory(git(repositoryRoot, ["rev-parse", "--show-toplevel"]), "Git root");
  if (gitRoot !== repositoryRoot) throw new Error("Repository root must equal the Git top-level directory.");
  const repository = canonicalRepositoryFromRemote(git(repositoryRoot, ["remote", "get-url", "origin"]));
  if (repository.toLowerCase() !== EXPECTED_REPOSITORY.toLowerCase()) {
    throw new Error(`Git origin must be ${EXPECTED_REPOSITORY}.`);
  }
  const branch = git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch !== "main") throw new Error("Documentation-truth source observation requires branch main.");
  const sourceRevision = git(repositoryRoot, ["rev-parse", "HEAD^{commit}"]).toLowerCase();
  const sourceTreeSha = git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]).toLowerCase();
  if (!GIT_SHA.test(sourceRevision) || !GIT_SHA.test(sourceTreeSha)) throw new Error("Git source identity is invalid.");
  const status = git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) throw new Error("Documentation-truth source observation requires a clean checkout.");

  const policyBinding = readJsonBinding(repositoryRoot, POLICY_RELATIVE);
  const policy = policyBinding.document;
  if (
    policy.schemaVersion !== 1 ||
    policy.kind !== "evavo-codex-documentation-truth-physical-acceptance-policy-v1" ||
    policy.owner !== EXPECTED_REPOSITORY
  ) throw new Error("Documentation-truth physical acceptance policy identity is invalid.");
  if (!Array.isArray(policy.requiredCurrentBindings) || policy.requiredCurrentBindings.length < 5) {
    throw new Error("Documentation-truth acceptance policy has no complete current-binding set.");
  }
  const currentBindings = Object.fromEntries(
    policy.requiredCurrentBindings.map((relativePath) => {
      const binding = readJsonBinding(repositoryRoot, relativePath);
      return [relativePath, { sha256: binding.sha256, byteLength: binding.byteLength }];
    }),
  );
  const routing = readJsonBinding(repositoryRoot, "config/worker-capacity-routing-v1.json").document;
  const route = (routing.workerRoutes ?? []).find((entry) => entry?.id === policy.routeId);
  if (
    !OBJECT(route) ||
    !Array.isArray(route.workerClasses) ||
    route.workerClasses.length !== 1 ||
    route.workerClasses[0] !== "test-generation" ||
    route.maximumAutomaticConcurrency !== 1 ||
    route.paidFallbackAllowed !== false
  ) throw new Error("Normal Spark route is not in the required staged-only state.");
  const profile = readJsonBinding(repositoryRoot, policy.workerProfile).document;
  if (
    profile.workerClass !== "documentation-truth" ||
    profile.activationState !== "staged-only" ||
    profile.physicalActivation?.normalRouteEnabled !== false ||
    profile.physicalActivation?.leaseEnabled !== false ||
    profile.physicalActivation?.modelExecutionEnabled !== false
  ) throw new Error("Documentation-truth profile is not staged-only.");

  const body = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-source-observation-v1",
    repository: EXPECTED_REPOSITORY,
    branch: "main",
    sourceRevision,
    sourceTreeSha,
    observedAt: now.toISOString(),
    clean: true,
    originVerified: true,
    normalWorkerClasses: ["test-generation"],
    documentationTruthActivationState: "staged-only",
    currentBindings,
    policySha256: policyBinding.sha256,
    networkUsed: false,
    modelTurnPerformed: false,
    leaseAcquired: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    paidFallbackUsed: false,
    financialActionPerformed: false,
    truthBoundary:
      "This read-only observation binds a clean EVAVO Agent Infrastructure main checkout, exact Git source identity and exact current policy bytes. It grants no activation, lease, model, Git, publication, deployment or paid-fallback authority.",
  };
  process.stdout.write(`${JSON.stringify({
    ...body,
    sourceObservationSha256: sha256(Buffer.from(canonicalJson(body), "utf8")),
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-source-observation-v1",
    observed: false,
    errors: [String(error?.message ?? error).slice(0, 2000)],
    networkUsed: false,
    modelTurnPerformed: false,
    leaseAcquired: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    paidFallbackUsed: false,
    financialActionPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
