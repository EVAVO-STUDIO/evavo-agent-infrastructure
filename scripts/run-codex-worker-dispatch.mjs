#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [dispatchPlanPath, capabilityReceiptPath] = process.argv.slice(2);
if (!dispatchPlanPath || !capabilityReceiptPath) {
  console.error("Usage: node scripts/run-codex-worker-dispatch.mjs <dispatch-plan.json> <codex-capability-receipt.json>");
  process.exit(2);
}

const plan = JSON.parse(fs.readFileSync(path.resolve(dispatchPlanPath), "utf8"));
const capability = JSON.parse(fs.readFileSync(path.resolve(capabilityReceiptPath), "utf8"));
const adapter = JSON.parse(fs.readFileSync("config/codex-worker-adapter-v1.json", "utf8"));
const errors = [];

if (process.env.EVAVO_CODEX_SPARK_EXECUTION_ENABLED !== "1") {
  errors.push("EVAVO_CODEX_SPARK_EXECUTION_ENABLED=1 is required for a model turn.");
}
if (process.env.EVAVO_CODEX_SPARK_PROFILE_ACCEPTED !== "1") {
  errors.push("EVAVO_CODEX_SPARK_PROFILE_ACCEPTED=1 is required after physical sandbox/auth acceptance.");
}
if (plan.kind !== "evavo-codex-worker-dispatch-plan-v1" || plan.eligible !== true) errors.push("Dispatch plan is not eligible.");
if (plan.executable !== adapter.executable) errors.push("Dispatch executable differs from the admitted adapter.");
if (plan.publicationAuthority !== false || plan.validationAuthority !== false) errors.push("Dispatch plan exceeds worker authority.");
if (plan.paidFallbackUsed !== false) errors.push("Paid fallback is forbidden.");
if (plan.sandboxMode !== adapter.dispatch.sandboxMode) errors.push("Sandbox mode mismatch.");
if (plan.approvalPolicy !== adapter.dispatch.approvalPolicy) errors.push("Approval policy mismatch.");
if (capability.kind !== "evavo-codex-worker-capability-probe-v1" || capability.eligibleForWorkerDispatch !== true) {
  errors.push("Fresh eligible Codex capability receipt is required.");
}
const observedAt = Date.parse(capability.observedAt ?? "");
if (!Number.isFinite(observedAt) || Date.now() - observedAt > 10 * 60_000 || observedAt - Date.now() > 120_000) {
  errors.push("Codex capability receipt is stale or future-dated.");
}
for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
  if (!capability.capabilities?.[key]) errors.push(`Codex capability receipt lacks ${key}.`);
}
if (!Array.isArray(plan.argv) || plan.argv.length < 8 || plan.argv[0] !== "exec" || plan.argv.at(-1) !== "-") {
  errors.push("Dispatch argv shape is invalid.");
}
if (typeof plan.stdinPrompt !== "string" || !plan.stdinPrompt.trim()) errors.push("Dispatch prompt is missing.");
if (errors.length) {
  console.error(JSON.stringify({kind:"evavo-codex-worker-run-v1",started:false,errors}, null, 2));
  process.exit(1);
}

const candidatePath = fs.realpathSync.native(path.resolve(plan.workingDirectory));
const stat = fs.lstatSync(candidatePath);
if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Candidate working directory must be a real directory.");

function git(args) {
  return execFileSync(process.platform === "win32" ? "git.exe" : "git", args, {
    cwd: candidatePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      WINDIR: process.env.WINDIR ?? "",
      HOME: process.env.HOME ?? "",
      USERPROFILE: process.env.USERPROFILE ?? "",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "Never",
      GIT_CONFIG_NOSYSTEM: "1"
    }
  }).trim();
}

const gitRoot = fs.realpathSync.native(path.resolve(git(["rev-parse", "--show-toplevel"])));
if (gitRoot !== candidatePath) throw new Error("Dispatch working directory is not the candidate Git root.");
const beforeHead = git(["rev-parse", "HEAD^{commit}"]).toLowerCase();
if (beforeHead !== String(plan.sourceRevision).toLowerCase()) throw new Error("Candidate HEAD no longer matches the dispatch source revision.");
const beforeStatus = git(["status", "--porcelain=v1", "--untracked-files=all"]);
if (beforeStatus) throw new Error("Candidate must be clean immediately before the Codex model turn.");

const env = {...process.env};
const removedEnvironment = [];
for (const name of adapter.dispatch.apiKeyEnvironmentVariablesMustBeRemoved ?? []) {
  if (Object.prototype.hasOwnProperty.call(env, name)) removedEnvironment.push(name);
  delete env[name];
}
const sanitizedEnvironmentNames = adapter.dispatch.apiKeyEnvironmentVariablesMustBeRemoved ?? [];
const environmentSanitized = sanitizedEnvironmentNames.every((name) => !Object.prototype.hasOwnProperty.call(env, name));
if (!environmentSanitized) throw new Error("Codex child environment still contains a forbidden provider/API override.");
env.GIT_TERMINAL_PROMPT = "0";
env.GCM_INTERACTIVE = "Never";
env.EVAVO_AUTONOMOUS_WORKER = "1";
env.EVAVO_AUTONOMOUS_WORKER_CLASS = "test-generation";

const startedAt = new Date().toISOString();
const result = spawnSync(plan.executable, plan.argv, {
  cwd: candidatePath,
  env,
  encoding: "utf8",
  input: plan.stdinPrompt,
  shell: false,
  windowsHide: true,
  timeout: 20 * 60_000,
  maxBuffer: 8 * 1024 * 1024,
});
const finishedAt = new Date().toISOString();
const afterHead = git(["rev-parse", "HEAD^{commit}"]).toLowerCase();
const afterStatus = git(["status", "--porcelain=v1", "--untracked-files=all"]);

const stdout = typeof result.stdout === "string" ? result.stdout : "";
const stderr = typeof result.stderr === "string" ? result.stderr : "";
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
let workerSummary = null;
if (typeof agentMessage === "string") {
  try {
    const parsed = JSON.parse(agentMessage);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) workerSummary = parsed;
  } catch {
    // The candidate diff remains authoritative; an unstructured summary is retained only as text evidence.
  }
}
const structuredTurnCompleted = result.status === 0 && Boolean(turnCompleted) && malformedJsonLines === 0;

const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const retain = (value, maximum) => {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length <= maximum) return {text:value, truncated:false, bytes:encoded.length, sha256:hash(value)};
  const clipped = encoded.subarray(0, maximum).toString("utf8");
  return {text:clipped, truncated:true, bytes:encoded.length, retainedBytes:Buffer.byteLength(clipped, "utf8"), sha256:hash(value)};
};
const stdoutReceipt = retain(stdout, adapter.dispatch.maximumRetainedStdoutBytes ?? 262144);
const stderrReceipt = retain(stderr, adapter.dispatch.maximumRetainedStderrBytes ?? 131072);
const agentMessageReceipt = typeof agentMessage === "string" ? retain(agentMessage, 32768) : null;

const receipt = {
  schemaVersion: 1,
  kind: "evavo-codex-worker-run-v1",
  routeId: "codex-spark-pro",
  workItemId: plan.workItemId,
  workerId: plan.workerId,
  repository: plan.repository,
  sourceRevision: plan.sourceRevision,
  startedAt,
  finishedAt,
  exitCode: result.status,
  signal: result.signal ?? null,
  error: result.error?.message ?? null,
  stdout: stdoutReceipt,
  stderr: stderrReceipt,
  jsonl: {
    parsedEvents: events.length,
    malformedLines: malformedJsonLines,
    turnCompleted: Boolean(turnCompleted),
    usage: turnCompleted?.usage ?? null,
    finalAgentMessage: agentMessageReceipt,
    parsedWorkerSummary: workerSummary,
  },
  modelTurnCompleted: structuredTurnCompleted,
  structuredTurnCompleted,
  candidateHeadBefore: beforeHead,
  candidateHeadAfter: afterHead,
  candidateHeadChanged: afterHead !== beforeHead,
  candidateDirtyAfter: Boolean(afterStatus),
  apiKeyOrProviderEnvironmentRemoved: removedEnvironment,
  apiKeyEnvironmentSanitized: environmentSanitized,
  sanitizedEnvironmentNames,
  sandboxMode: plan.sandboxMode,
  approvalPolicy: plan.approvalPolicy,
  paidFallbackUsed: false,
  deterministicValidationPerformed: false,
  publicationPerformed: false,
  truthBoundary: "This is the bounded direct Codex process receipt. Completion requires a zero process exit plus a valid structured turn.completed event. Provider/API override variables are removed before spawning Codex. Full stdout/stderr are represented by SHA-256 and byte counts and may be truncated. This is not candidate acceptance, deterministic validation, review, commit, push or publication."
};

console.log(JSON.stringify(receipt, null, 2));
process.exit(structuredTurnCompleted ? 0 : 1);
