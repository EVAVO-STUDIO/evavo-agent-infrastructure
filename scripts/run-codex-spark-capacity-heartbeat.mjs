#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 9) {
  console.error(
    "Usage: node scripts/run-codex-spark-capacity-heartbeat.mjs " +
      "<dispatch-plan.json> <heartbeat-plan.json> <work-exchange-status.json> " +
      "<effective-capacity.json> <codex-capability.json> <chatgpt-auth.json> " +
      "<physical-verification.json> <route-admission.json> <supervised-acceptance.json>",
  );
  process.exit(2);
}

const enabled = process.env.EVAVO_CODEX_SPARK_CAPACITY_HEARTBEAT_ENABLED === "1";
if (!enabled) {
  console.error(JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-spark-capacity-heartbeat-run-v1",
    started: false,
    ok: false,
    state: "DISABLED",
    errors: ["EVAVO_CODEX_SPARK_CAPACITY_HEARTBEAT_ENABLED=1 is required."],
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
    paidFallbackUsed: false,
  }, null, 2));
  process.exit(1);
}

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
function readJson(input, label) {
  const resolved = fs.realpathSync.native(path.resolve(input));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  if (stat.size < 2 || stat.size > MAX_INPUT_BYTES) throw new Error(`${label} size is outside the bounded contract.`);
  const bytes = fs.readFileSync(resolved);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must contain UTF-8 JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain one JSON object.`);
  return { value, resolved, bytes, sha256: sha256(bytes) };
}
function regularFile(input, label) {
  const resolved = fs.realpathSync.native(path.resolve(input));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return resolved;
}
function redact(text) {
  let value = String(text ?? "");
  value = value.replace(/(?i)/g, "");
  value = value.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "<redacted-token>");
  value = value.replace(/\b(?:Bearer\s+)[A-Za-z0-9._~+\-/]+=*/gi, "Bearer <redacted>");
  value = value.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  value = value.replace(/\\\\[A-Za-z0-9._$-]+\\[^\r\n]*/g, "<unc-path>");
  const bytes = Buffer.from(value, "utf8");
  return bytes.length <= MAX_DIAGNOSTIC_BYTES ? value : bytes.subarray(0, MAX_DIAGNOSTIC_BYTES).toString("utf8");
}
function git(root, gitExecutable, arguments) {
  return execFileSync(gitExecutable, arguments, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
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
}

let fixtureRoot = null;
let fixtureCleanupComplete = false;
let modelStarted = false;
let receipt = null;
let exitCode = 1;
try {
  const [dispatchEvidence, heartbeatPlanEvidence, queueEvidence, capacityEvidence, capabilityEvidence, authEvidence, physicalEvidence, admissionEvidence, acceptanceEvidence] = args.map((input, index) =>
    readJson(input, [
      "heartbeat dispatch plan",
      "heartbeat decision plan",
      "Work Exchange status",
      "effective-capacity status",
      "Codex capability receipt",
      "ChatGPT authentication receipt",
      "physical-acceptance verification",
      "route admission",
      "supervised physical acceptance",
    ][index]),
  );
  const dispatch = dispatchEvidence.value;
  if (dispatch.schemaVersion !== 1 || dispatch.kind !== "evavo-codex-spark-capacity-heartbeat-dispatch-plan-v1" || dispatch.eligible !== true) {
    throw new Error("Capacity-heartbeat dispatch plan is not eligible.");
  }
  if (dispatch.fixtureOnly !== true || dispatch.maximumModelTurns !== 1 || dispatch.maximumConcurrency !== 1) {
    throw new Error("Capacity-heartbeat dispatch exceeds one-turn fixture authority.");
  }
  if (dispatch.paidFallbackAllowed !== false || dispatch.paidFallbackUsed !== false) throw new Error("Capacity-heartbeat dispatch violates zero-paid-fallback policy.");

  const compiler = regularFile(path.join(ROOT, "scripts", "compile-codex-spark-capacity-heartbeat-dispatch.mjs"), "heartbeat dispatch compiler");
  const compiled = spawnSync(process.execPath, [compiler, ...args.slice(1)], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (compiled.status !== 0) throw new Error(`Fresh heartbeat dispatch compilation failed: ${redact(compiled.stderr || compiled.stdout)}`);
  let freshDispatch;
  try {
    freshDispatch = JSON.parse(String(compiled.stdout ?? "").trim());
  } catch {
    throw new Error("Fresh heartbeat dispatch compiler did not return valid JSON.");
  }
  if (JSON.stringify(canonical(freshDispatch)) !== JSON.stringify(canonical(dispatch))) {
    throw new Error("Heartbeat dispatch plan differs from a fresh recompilation of its evidence.");
  }

  const expectedBindings = {
    heartbeatPlanSha256: heartbeatPlanEvidence.sha256,
    workExchangeStatusSha256: queueEvidence.sha256,
    effectiveCapacityStatusSha256: capacityEvidence.sha256,
    codexCapabilityReceiptSha256: capabilityEvidence.sha256,
    chatgptAuthenticationReceiptSha256: authEvidence.sha256,
    physicalAcceptanceVerificationSha256: physicalEvidence.sha256,
    routeAdmissionSha256: admissionEvidence.sha256,
    supervisedAcceptanceSha256: acceptanceEvidence.sha256,
  };
  for (const [name, expected] of Object.entries(expectedBindings)) {
    if (dispatch.evidenceBindings?.[name] !== expected) throw new Error(`Heartbeat dispatch binding changed: ${name}.`);
  }

  const verifier = regularFile(path.join(ROOT, "scripts", "verify-codex-spark-safe-physical-acceptance.mjs"), "supervised physical-acceptance verifier");
  const verification = spawnSync(process.execPath, [verifier, acceptanceEvidence.resolved, capabilityEvidence.resolved], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  let verified;
  try {
    verified = JSON.parse(String(verification.stdout ?? "").trim());
  } catch {
    throw new Error(`Supervised physical-acceptance verifier did not return valid JSON: ${redact(verification.stderr)}`);
  }
  if (verification.status !== 0 || verified.accepted !== true || verified.supervisedCleanupProven !== true) {
    throw new Error(`Supervised physical acceptance is not current: ${redact((verified.errors ?? []).join("; "))}`);
  }
  const verificationSha256 = sha256(Buffer.from(JSON.stringify(canonical(verified)), "utf8"));

  const gitExecutable = process.platform === "win32" ? "git.exe" : "git";
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-capacity-heartbeat-"));
  fixtureRoot = path.join(fixtureParent, "fixture-repository");
  const emptyTemplate = path.join(fixtureParent, "empty-template");
  fs.mkdirSync(fixtureRoot, { recursive: false });
  fs.mkdirSync(emptyTemplate, { recursive: false });
  git(fixtureRoot, gitExecutable, ["init", "--initial-branch=main", `--template=${emptyTemplate}`]);
  git(fixtureRoot, gitExecutable, ["config", "user.name", "EVAVO Capacity Fixture"]);
  git(fixtureRoot, gitExecutable, ["config", "user.email", "capacity-fixture@example.invalid"]);
  git(fixtureRoot, gitExecutable, ["config", "commit.gpgsign", "false"]);
  git(fixtureRoot, gitExecutable, ["config", "core.autocrlf", "false"]);
  git(fixtureRoot, gitExecutable, ["config", "core.hooksPath", emptyTemplate]);
  fs.writeFileSync(
    path.join(fixtureRoot, "capacity-heartbeat.json"),
    `${JSON.stringify({ schemaVersion: 1, kind: "evavo-codex-spark-capacity-heartbeat-fixture-v1", fixtureOnly: true, mutationRequested: false }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  git(fixtureRoot, gitExecutable, ["add", "--", "capacity-heartbeat.json"]);
  git(fixtureRoot, gitExecutable, ["commit", "-m", "Create disposable capacity heartbeat fixture"]);
  const beforeHead = git(fixtureRoot, gitExecutable, ["rev-parse", "HEAD^{commit}"]).toLowerCase();
  if (git(fixtureRoot, gitExecutable, ["status", "--porcelain=v1", "--untracked-files=all"])) throw new Error("Capacity-heartbeat fixture is dirty before Codex.");
  if (git(fixtureRoot, gitExecutable, ["remote"])) throw new Error("Capacity-heartbeat fixture unexpectedly has a Git remote.");

  const adapter = readJson(path.join(ROOT, "config", "codex-worker-adapter-v1.json"), "Codex worker adapter").value;
  const childEnvironment = { ...process.env };
  const removedEnvironment = [];
  const forbiddenEnvironment = new Set([
    ...(adapter.dispatch?.apiKeyEnvironmentVariablesMustBeRemoved ?? []),
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "EVAVO_NODE_GITHUB_TOKEN",
    "NETLIFY_AUTH_TOKEN",
    "EVAVO_CODEX_SPARK_CAPACITY_HEARTBEAT_ENABLED",
    "EVAVO_CODEX_SPARK_EXECUTION_ENABLED",
    "EVAVO_CODEX_SPARK_CERTIFICATION_MODE",
    "EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT",
    "EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED",
    "NODE_OPTIONS",
    "NODE_PATH",
  ]);
  for (const name of forbiddenEnvironment) {
    if (Object.prototype.hasOwnProperty.call(childEnvironment, name)) removedEnvironment.push(name);
    delete childEnvironment[name];
  }
  if ([...forbiddenEnvironment].some((name) => Object.prototype.hasOwnProperty.call(childEnvironment, name))) {
    throw new Error("Forbidden provider, GitHub or outer-control environment survived heartbeat sanitization.");
  }
  childEnvironment.GIT_TERMINAL_PROMPT = "0";
  childEnvironment.GCM_INTERACTIVE = "Never";
  childEnvironment.GIT_CONFIG_NOSYSTEM = "1";
  childEnvironment.EVAVO_AUTONOMOUS_WORKER = "1";
  childEnvironment.EVAVO_AUTONOMOUS_WORKER_CLASS = "capacity-heartbeat";
  childEnvironment.EVAVO_AUTONOMOUS_FIXTURE_ONLY = "1";

  modelStarted = true;
  const startedAt = new Date().toISOString();
  const result = spawnSync(dispatch.executable, dispatch.argv, {
    cwd: fixtureRoot,
    env: childEnvironment,
    input: dispatch.stdinPrompt,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 5 * 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const finishedAt = new Date().toISOString();
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  const events = [];
  let malformedJsonLines = 0;
  for (const line of stdout.split(/\r?\n/).filter((value) => value.trim())) {
    try {
      events.push(JSON.parse(line));
    } catch {
      malformedJsonLines += 1;
    }
  }
  const turnCompleted = [...events].reverse().find((event) => event?.type === "turn.completed") ?? null;
  const agentMessage = [...events].reverse().find((event) => event?.type === "item.completed" && event?.item?.type === "agent_message")?.item?.text ?? null;
  let finalMessage = null;
  if (typeof agentMessage === "string") {
    try {
      const parsed = JSON.parse(agentMessage);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) finalMessage = parsed;
    } catch {}
  }
  const structuredTurnCompleted = result.status === 0 && Boolean(turnCompleted) && malformedJsonLines === 0;
  const finalAccepted =
    finalMessage?.capacityHeartbeat === "AVAILABLE" &&
    finalMessage?.repositoryMutationPerformed === false &&
    finalMessage?.commitPerformed === false &&
    finalMessage?.publicationPerformed === false;
  const afterHead = git(fixtureRoot, gitExecutable, ["rev-parse", "HEAD^{commit}"]).toLowerCase();
  const afterStatus = git(fixtureRoot, gitExecutable, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const remoteCount = git(fixtureRoot, gitExecutable, ["remote"]).split(/\r?\n/).filter(Boolean).length;
  const fixtureUnchanged = beforeHead === afterHead && !afterStatus && remoteCount === 0;
  const heartbeatAccepted = structuredTurnCompleted && finalAccepted && fixtureUnchanged;

  receipt = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-run-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    workItemId: "capacity-heartbeat",
    workerId: "codex-spark-capacity-heartbeat",
    fixtureOnly: true,
    capacityHeartbeat: true,
    heartbeatAccepted,
    startedAt,
    finishedAt,
    exitCode: result.status,
    signal: result.signal ?? null,
    structuredTurnCompleted,
    modelTurnCompleted: structuredTurnCompleted,
    finalHeartbeatMessageAccepted: finalAccepted,
    fixtureSeedCommitPerformed: true,
    workerCommitPerformed: false,
    fixtureHeadUnchanged: beforeHead === afterHead,
    fixtureWorktreeClean: !afterStatus,
    fixtureRemoteCount: remoteCount,
    fixtureTemporaryStateRemoved: false,
    jsonl: {
      parsedEvents: events.length,
      malformedLines: malformedJsonLines,
      turnCompleted: Boolean(turnCompleted),
      usage: turnCompleted?.usage ?? null,
    },
    stdoutSha256: sha256(Buffer.from(stdout, "utf8")),
    stderrSha256: sha256(Buffer.from(stderr, "utf8")),
    stdoutBytes: Buffer.byteLength(stdout, "utf8"),
    stderrBytes: Buffer.byteLength(stderr, "utf8"),
    stdoutDiagnostic: redact(stdout),
    stderrDiagnostic: redact(stderr),
    supervisedAcceptanceVerificationSha256: verificationSha256,
    dispatchPlanSha256: dispatchEvidence.sha256,
    evidenceBindings: dispatch.evidenceBindings,
    apiKeyOrProviderEnvironmentRemoved: removedEnvironment.sort(),
    apiKeyEnvironmentSanitized: true,
    paidFallbackAllowed: false,
    paidFallbackUsed: false,
    deterministicValidationPerformed: true,
    repositoryMutationPerformed: false,
    commitAuthority: false,
    pushAuthority: false,
    publicationPerformed: false,
    productRepositoryTouched: false,
    truthBoundary:
      "One ChatGPT-authenticated Spark turn ran only in a remote-less disposable Git fixture. Availability is accepted only when Codex emitted a complete structured turn and exact heartbeat JSON while HEAD, worktree and remotes remained unchanged. The receipt grants no product, Git or publication authority.",
  };
  exitCode = heartbeatAccepted ? 0 : 1;
} catch (error) {
  receipt = {
    schemaVersion: 1,
    kind: "evavo-codex-spark-capacity-heartbeat-run-v1",
    started: modelStarted,
    ok: false,
    state: modelStarted ? "FAILED_AFTER_START" : "REJECTED_BEFORE_START",
    errorType: error?.constructor?.name ?? "Error",
    errorMessage: redact(error?.message ?? error),
    modelTurnPerformed: modelStarted,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
    paidFallbackUsed: false,
  };
  exitCode = 1;
} finally {
  if (fixtureRoot) {
    const parent = path.dirname(fixtureRoot);
    try {
      fs.rmSync(parent, { recursive: true, force: true });
      fixtureCleanupComplete = !fs.existsSync(parent);
    } catch {
      fixtureCleanupComplete = false;
    }
  } else {
    fixtureCleanupComplete = true;
  }
  if (receipt && receipt.kind === "evavo-codex-worker-run-v1") {
    receipt.fixtureTemporaryStateRemoved = fixtureCleanupComplete;
    if (!fixtureCleanupComplete) {
      receipt.heartbeatAccepted = false;
      receipt.errorType = "FixtureCleanupFailed";
      exitCode = 1;
    }
  } else if (receipt) {
    receipt.fixtureTemporaryStateRemoved = fixtureCleanupComplete;
  }
}

const serialized = JSON.stringify(receipt, null, 2);
if (exitCode === 0) console.log(serialized);
else console.error(serialized);
process.exit(exitCode);
