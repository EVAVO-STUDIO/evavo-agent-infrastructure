#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputs = process.argv.slice(2);
if (inputs.length !== 9) {
  console.error(
    "Usage: node scripts/run-codex-spark-capacity-heartbeat-v2.mjs " +
      "<dispatch-plan.json> <heartbeat-plan.json> <work-exchange-status.json> " +
      "<effective-capacity.json> <codex-capability.json> <chatgpt-auth.json> " +
      "<physical-verification.json> <route-admission.json> <supervised-acceptance.json>",
  );
  process.exit(2);
}

if (process.env.EVAVO_CODEX_SPARK_CAPACITY_HEARTBEAT_ENABLED !== "1") {
  console.error(JSON.stringify({
    schemaVersion: 2,
    kind: "evavo-codex-spark-capacity-heartbeat-run-v1",
    started: false,
    ok: false,
    state: "DISABLED",
    errors: ["EVAVO_CODEX_SPARK_CAPACITY_HEARTBEAT_ENABLED=1 is required."],
    modelProcessAttempted: false,
    modelProcessStarted: false,
    modelTurnPerformed: false,
    temporaryFixtureCreated: false,
    productRepositoryTouched: false,
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
function boundedDiagnostic(text) {
  let value = String(text ?? "");
  value = value.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "<redacted-token>");
  value = value.replace(/\bBearer\s+[A-Za-z0-9._~+\-/]+=*/gi, "Bearer <redacted>");
  value = value.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  value = value.replace(/\\\\[A-Za-z0-9._$-]+\\[^\r\n]*/g, "<unc-path>");
  for (const physical of [process.env.USERPROFILE, process.env.HOME, process.env.LOCALAPPDATA, process.env.TEMP, process.env.TMP]) {
    if (physical) value = value.split(String(physical)).join("<local-path>");
  }
  const encoded = Buffer.from(value, "utf8");
  return encoded.length <= MAX_DIAGNOSTIC_BYTES
    ? value
    : encoded.subarray(0, MAX_DIAGNOSTIC_BYTES).toString("utf8");
}
function git(repository, executable, arguments) {
  return execFileSync(executable, arguments, {
    cwd: repository,
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

let fixtureParent = null;
let fixtureRoot = null;
let fixtureCleanupComplete = true;
let modelProcessAttempted = false;
let modelProcessStarted = false;
let terminalReceipt = null;
let terminalExitCode = 1;

try {
  const labels = [
    "heartbeat dispatch plan",
    "heartbeat decision plan",
    "Work Exchange status",
    "effective-capacity status",
    "Codex capability receipt",
    "ChatGPT authentication receipt",
    "physical-acceptance verification",
    "route admission",
    "supervised physical acceptance",
  ];
  const evidence = inputs.map((input, index) => readJson(input, labels[index]));
  const [dispatchEvidence, heartbeatPlanEvidence, queueEvidence, capacityEvidence, capabilityEvidence, authEvidence, physicalEvidence, admissionEvidence, acceptanceEvidence] = evidence;
  const dispatch = dispatchEvidence.value;
  if (dispatch.schemaVersion !== 1 || dispatch.kind !== "evavo-codex-spark-capacity-heartbeat-dispatch-plan-v1" || dispatch.eligible !== true) {
    throw new Error("Capacity-heartbeat dispatch plan is not eligible.");
  }
  if (dispatch.fixtureOnly !== true || dispatch.maximumModelTurns !== 1 || dispatch.maximumConcurrency !== 1) {
    throw new Error("Capacity-heartbeat dispatch exceeds one-turn fixture authority.");
  }
  if (dispatch.paidFallbackAllowed !== false || dispatch.paidFallbackUsed !== false) {
    throw new Error("Capacity-heartbeat dispatch violates zero-paid-fallback policy.");
  }

  const compiler = regularFile(
    path.join(ROOT, "scripts", "compile-codex-spark-capacity-heartbeat-dispatch.mjs"),
    "heartbeat dispatch compiler",
  );
  const compiled = spawnSync(process.execPath, [compiler, ...inputs.slice(1)], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (compiled.status !== 0) {
    throw new Error(`Fresh heartbeat dispatch compilation failed: ${boundedDiagnostic(compiled.stderr || compiled.stdout)}`);
  }
  let freshDispatch;
  try {
    freshDispatch = JSON.parse(String(compiled.stdout ?? "").trim());
  } catch {
    throw new Error("Fresh heartbeat dispatch compiler did not return valid JSON.");
  }
  if (JSON.stringify(canonical(freshDispatch)) !== JSON.stringify(canonical(dispatch))) {
    throw new Error("Heartbeat dispatch plan differs from a fresh recompilation of its evidence.");
  }

  const exactBindings = {
    heartbeatPlanSha256: heartbeatPlanEvidence.sha256,
    workExchangeStatusSha256: queueEvidence.sha256,
    effectiveCapacityStatusSha256: capacityEvidence.sha256,
    codexCapabilityReceiptSha256: capabilityEvidence.sha256,
    chatgptAuthenticationReceiptSha256: authEvidence.sha256,
    physicalAcceptanceVerificationSha256: physicalEvidence.sha256,
    routeAdmissionSha256: admissionEvidence.sha256,
    supervisedAcceptanceSha256: acceptanceEvidence.sha256,
  };
  for (const [field, expected] of Object.entries(exactBindings)) {
    if (dispatch.evidenceBindings?.[field] !== expected) throw new Error(`Heartbeat dispatch binding changed: ${field}.`);
  }

  const verifier = regularFile(
    path.join(ROOT, "scripts", "verify-codex-spark-safe-physical-acceptance.mjs"),
    "supervised physical-acceptance verifier",
  );
  const verificationProcess = spawnSync(
    process.execPath,
    [verifier, acceptanceEvidence.resolved, capabilityEvidence.resolved],
    {
      cwd: ROOT,
      env: process.env,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  let verification;
  try {
    verification = JSON.parse(String(verificationProcess.stdout ?? "").trim());
  } catch {
    throw new Error(
      `Supervised physical-acceptance verifier did not return valid JSON: ${boundedDiagnostic(verificationProcess.stderr)}`,
    );
  }
  if (
    verificationProcess.status !== 0 ||
    verification.accepted !== true ||
    verification.supervisedCleanupProven !== true ||
    verification.routeId !== "codex-spark-pro" ||
    verification.paidFallbackAllowed !== false
  ) {
    throw new Error(
      `Supervised physical acceptance is not current: ${boundedDiagnostic((verification.errors ?? []).join("; "))}`,
    );
  }
  const verificationSha256 = sha256(Buffer.from(JSON.stringify(canonical(verification)), "utf8"));

  const gitExecutable = process.platform === "win32" ? "git.exe" : "git";
  fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-spark-capacity-heartbeat-"));
  fixtureRoot = path.join(fixtureParent, "fixture-repository");
  const emptyTemplate = path.join(fixtureParent, "empty-template");
  fs.mkdirSync(fixtureRoot);
  fs.mkdirSync(emptyTemplate);
  git(fixtureRoot, gitExecutable, ["init", "--initial-branch=main", `--template=${emptyTemplate}`]);
  git(fixtureRoot, gitExecutable, ["config", "user.name", "EVAVO Capacity Fixture"]);
  git(fixtureRoot, gitExecutable, ["config", "user.email", "capacity-fixture@example.invalid"]);
  git(fixtureRoot, gitExecutable, ["config", "commit.gpgsign", "false"]);
  git(fixtureRoot, gitExecutable, ["config", "core.autocrlf", "false"]);
  git(fixtureRoot, gitExecutable, ["config", "core.hooksPath", emptyTemplate]);
  fs.writeFileSync(
    path.join(fixtureRoot, "capacity-heartbeat.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      kind: "evavo-codex-spark-capacity-heartbeat-fixture-v1",
      fixtureOnly: true,
      mutationRequested: false,
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  git(fixtureRoot, gitExecutable, ["add", "--", "capacity-heartbeat.json"]);
  git(fixtureRoot, gitExecutable, ["commit", "-m", "Create disposable capacity heartbeat fixture"]);
  const beforeHead = git(fixtureRoot, gitExecutable, ["rev-parse", "HEAD^{commit}"]).toLowerCase();
  if (git(fixtureRoot, gitExecutable, ["status", "--porcelain=v1", "--untracked-files=all"])) {
    throw new Error("Capacity-heartbeat fixture is dirty before Codex.");
  }
  if (git(fixtureRoot, gitExecutable, ["remote"])) {
    throw new Error("Capacity-heartbeat fixture unexpectedly has a Git remote.");
  }

  const adapter = readJson(path.join(ROOT, "config", "codex-worker-adapter-v1.json"), "Codex worker adapter").value;
  const childEnvironment = { ...process.env };
  const forbiddenEnvironment = new Set([
    ...(adapter.dispatch?.apiKeyEnvironmentVariablesMustBeRemoved ?? []),
    "OPENAI_API_KEY",
    "OPENAI_API_TOKEN",
    "OPENAI_BASE_URL",
    "OPENAI_ORGANIZATION",
    "OPENAI_PROJECT",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
    "CODEX_API_KEY",
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
  const removedEnvironment = [];
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

  modelProcessAttempted = true;
  const startedAt = new Date().toISOString();
  const processResult = spawnSync(dispatch.executable, dispatch.argv, {
    cwd: fixtureRoot,
    env: childEnvironment,
    input: dispatch.stdinPrompt,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 5 * 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  modelProcessStarted = processResult.error == null;
  const finishedAt = new Date().toISOString();
  const stdout = String(processResult.stdout ?? "");
  const stderr = String(processResult.stderr ?? "");
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
  const agentMessage = [...events].reverse().find(
    (event) => event?.type === "item.completed" && event?.item?.type === "agent_message",
  )?.item?.text ?? null;
  let finalMessage = null;
  if (typeof agentMessage === "string") {
    try {
      const parsed = JSON.parse(agentMessage);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) finalMessage = parsed;
    } catch {}
  }
  const structuredTurnCompleted =
    modelProcessStarted && processResult.status === 0 && Boolean(turnCompleted) && malformedJsonLines === 0;
  const finalMessageAccepted =
    finalMessage?.capacityHeartbeat === "AVAILABLE" &&
    finalMessage?.repositoryMutationPerformed === false &&
    finalMessage?.commitPerformed === false &&
    finalMessage?.publicationPerformed === false;
  const afterHead = git(fixtureRoot, gitExecutable, ["rev-parse", "HEAD^{commit}"]).toLowerCase();
  const afterStatus = git(fixtureRoot, gitExecutable, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const remoteCount = git(fixtureRoot, gitExecutable, ["remote"]).split(/\r?\n/).filter(Boolean).length;
  const temporaryFixtureMutationObserved = beforeHead !== afterHead || Boolean(afterStatus) || remoteCount !== 0;
  const heartbeatAccepted = structuredTurnCompleted && finalMessageAccepted && !temporaryFixtureMutationObserved;

  terminalReceipt = {
    schemaVersion: 2,
    kind: "evavo-codex-worker-run-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    workItemId: "capacity-heartbeat",
    workerId: "codex-spark-capacity-heartbeat-v2",
    fixtureOnly: true,
    capacityHeartbeat: true,
    heartbeatAccepted,
    startedAt,
    finishedAt,
    exitCode: processResult.status,
    signal: processResult.signal ?? null,
    processErrorType: processResult.error?.name ?? null,
    structuredTurnCompleted,
    modelTurnCompleted: structuredTurnCompleted,
    finalHeartbeatMessageAccepted: finalMessageAccepted,
    temporaryFixtureSeedCommitPerformed: true,
    workerCommitPerformed: false,
    fixtureHeadUnchanged: beforeHead === afterHead,
    fixtureWorktreeClean: !afterStatus,
    fixtureRemoteCount: remoteCount,
    temporaryFixtureMutationObserved,
    temporaryFixtureStateRemoved: false,
    productRepositoryTouched: false,
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
    stdoutDiagnostic: boundedDiagnostic(stdout),
    stderrDiagnostic: boundedDiagnostic(stderr),
    supervisedAcceptanceVerificationSha256: verificationSha256,
    dispatchPlanSha256: dispatchEvidence.sha256,
    evidenceBindings: dispatch.evidenceBindings,
    apiKeyOrProviderEnvironmentRemoved: removedEnvironment.sort(),
    apiKeyEnvironmentSanitized: true,
    paidFallbackAllowed: false,
    paidFallbackUsed: false,
    deterministicFixtureValidationPerformed: true,
    repositoryMutationAuthority: false,
    commitAuthority: false,
    pushAuthority: false,
    publicationPerformed: false,
    truthBoundary:
      "One ChatGPT-authenticated Spark turn ran only in a remote-less disposable Git fixture. Availability is accepted only after a complete structured turn, exact heartbeat JSON, unchanged HEAD, clean worktree, zero remotes and successful temporary-state removal. Temporary fixture seeding is reported separately from worker mutation; no product, Git publication or paid-fallback authority is granted.",
  };
  terminalExitCode = heartbeatAccepted ? 0 : 1;
} catch (error) {
  terminalReceipt = {
    schemaVersion: 2,
    kind: modelProcessAttempted ? "evavo-codex-worker-run-v1" : "evavo-codex-spark-capacity-heartbeat-run-v1",
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    workItemId: "capacity-heartbeat",
    fixtureOnly: true,
    capacityHeartbeat: true,
    heartbeatAccepted: false,
    started: modelProcessStarted,
    state: modelProcessAttempted ? "FAILED_AFTER_DISPATCH_ATTEMPT" : "REJECTED_BEFORE_MODEL_ATTEMPT",
    errorType: error?.constructor?.name ?? "Error",
    errorMessage: boundedDiagnostic(error?.message ?? error),
    modelProcessAttempted,
    modelProcessStarted,
    modelTurnPerformed: false,
    temporaryFixtureCreated: fixtureRoot !== null,
    temporaryFixtureStateRemoved: false,
    productRepositoryTouched: false,
    repositoryMutationAuthority: false,
    publicationPerformed: false,
    paidFallbackAllowed: false,
    paidFallbackUsed: false,
  };
  terminalExitCode = 1;
} finally {
  if (fixtureParent) {
    try {
      fs.rmSync(fixtureParent, { recursive: true, force: true });
      fixtureCleanupComplete = !fs.existsSync(fixtureParent);
    } catch {
      fixtureCleanupComplete = false;
    }
  }
  if (terminalReceipt) {
    terminalReceipt.temporaryFixtureStateRemoved = fixtureCleanupComplete;
    if (!fixtureCleanupComplete) {
      terminalReceipt.heartbeatAccepted = false;
      terminalReceipt.cleanupError = "TemporaryFixtureCleanupFailed";
      terminalExitCode = 1;
    }
  }
}

const serialized = JSON.stringify(terminalReceipt, null, 2);
if (terminalExitCode === 0) console.log(serialized);
else console.error(serialized);
process.exit(terminalExitCode);
