#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_BYTES = 8 * 1024 * 1024;

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
const canonical = (value) => JSON.stringify(ordered(value));
const sha256 = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).digest("hex");

function readJsonBytes(input, label, maximum = MAX_BYTES) {
  const resolved = fs.realpathSync.native(path.resolve(input));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maximum) throw new Error(`${label} must be a bounded regular non-symlink file.`);
  const bytes = fs.readFileSync(resolved);
  let document;
  try { document = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} is not valid UTF-8 JSON.`); }
  if (!OBJECT(document)) throw new Error(`${label} must contain a JSON object.`);
  return { resolved, bytes, sha256: sha256(bytes), document };
}
function owned(relative, label) { return readJsonBytes(path.join(ROOT, relative), label, 2 * 1024 * 1024); }
function string(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value || value.length > maximum || value.includes("\0")) throw new Error(`${label} must be a non-empty bounded string.`);
  return value;
}
function exactSha(value, label, pattern = SHA256) {
  const text = string(value, label, 64);
  if (!pattern.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}
function parseTime(value, label) {
  const milliseconds = Date.parse(string(value, label, 64));
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return milliseconds;
}
function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}
function safeRelative(value, label) {
  const normalized = string(value, label, 512).replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").some((part) => !part || part === "." || part === ".." || part === ".git") || /[\r\n]/.test(normalized)) throw new Error(`${label} is not a safe repository-relative path.`);
  return normalized;
}
function retain(value, maximumBytes) {
  const text = typeof value === "string" ? value : "";
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maximumBytes) return { text, bytes: bytes.length, sha256: sha256(bytes), truncated: false };
  let retained = bytes.subarray(0, maximumBytes).toString("utf8");
  while (Buffer.byteLength(retained, "utf8") > maximumBytes) retained = retained.slice(0, -1);
  return { text: retained, bytes: bytes.length, retainedBytes: Buffer.byteLength(retained, "utf8"), sha256: sha256(bytes), truncated: true };
}
function safeError(value) {
  return String(value ?? "documentation-truth runner failed")
    .replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>")
    .replace(/(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi, "credential=<redacted>")
    .slice(0, 1800);
}
function gitEnvironment(source) {
  return {
    PATH: source.PATH ?? "",
    PATHEXT: source.PATHEXT ?? "",
    SYSTEMROOT: source.SYSTEMROOT ?? "",
    WINDIR: source.WINDIR ?? "",
    HOME: source.HOME ?? "",
    USERPROFILE: source.USERPROFILE ?? "",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1"
  };
}
function exactSummary(value, dispatchPolicy) {
  if (!OBJECT(value)) return false;
  const expected = [...dispatchPolicy.resultFields].sort();
  if (!sameArray(Object.keys(value).sort(), expected) || !dispatchPolicy.resultStates.includes(value.resultState)) return false;
  return dispatchPolicy.resultFields.filter((field) => field !== "resultState").every((field) => Array.isArray(value[field]) && value[field].length <= 128 && value[field].every((entry) => typeof entry === "string" && entry.length <= 2048));
}
function nulList(value) {
  return String(value ?? "").split("\0").filter(Boolean).map((entry) => safeRelative(entry, "changed path"));
}
function changedLines(git, candidatePath, changedPaths) {
  let total = 0;
  for (const relative of changedPaths) {
    const absolute = path.join(candidatePath, relative);
    const untracked = git(["ls-files", "--others", "--exclude-standard", "--", relative]).split(/\r?\n/).filter(Boolean).includes(relative);
    if (untracked) {
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error("new capability manifest must be a bounded regular non-symlink file.");
      const text = fs.readFileSync(absolute, "utf8");
      total += text.length === 0 ? 0 : text.split(/\r?\n/).length;
      continue;
    }
    const line = git(["diff", "HEAD", "--numstat", "--", relative]).split(/\r?\n/).find(Boolean);
    if (!line) continue;
    const [added, removed] = line.split("\t");
    if (!/^\d+$/.test(added) || !/^\d+$/.test(removed)) throw new Error("binary capability-manifest changes are forbidden.");
    total += Number(added) + Number(removed);
  }
  return total;
}
function auditManifest(candidatePath, relative, repository) {
  const absolute = path.join(candidatePath, relative);
  const real = fs.realpathSync.native(absolute);
  const relation = path.relative(candidatePath, real).replaceAll("\\", "/");
  if (relation !== relative) throw new Error("capability manifest escaped the candidate worktree or used a symlink.");
  const stat = fs.lstatSync(real);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 1024 * 1024) throw new Error("capability manifest must be a bounded regular non-symlink JSON file.");
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(real, "utf8")); }
  catch { throw new Error("candidate capability manifest is not valid UTF-8 JSON."); }
  if (!OBJECT(manifest) || manifest.contractVersion !== "evavo_repository_capabilities_v1" || manifest.repository !== repository || typeof manifest.authority !== "string" || !manifest.authority || typeof manifest.summary !== "string" || !manifest.summary || !Array.isArray(manifest.capabilities)) {
    throw new Error("candidate capability manifest lacks the canonical identity, repository, authority, summary or capabilities array.");
  }
  return { authority: manifest.authority, capabilityCount: manifest.capabilities.length, manifestSha256: sha256(fs.readFileSync(real)) };
}

let planSource = null;
let capabilitySource = null;
let acceptanceSource = null;
let modelTurnStarted = false;
let acceptanceVerified = false;
let candidatePath = null;
let beforeHead = null;
let beforeStatus = null;
let observedChangedPaths = [];
let observedChangedLines = 0;
try {
  const inputs = process.argv.slice(2);
  if (inputs.length !== 2) throw new Error("Usage: node scripts/run-codex-documentation-truth-dispatch.mjs <dispatch-plan.json> <fresh-capability.json>");
  const [planInput, capabilityInput] = inputs;
  const runnerPolicy = owned("config/codex-documentation-truth-runner-v1.json", "documentation-truth runner policy").document;
  const dispatchPolicy = owned("config/codex-documentation-truth-dispatch-v1.json", "documentation-truth dispatch policy").document;
  const adapter = owned("config/codex-worker-adapter-v1.json", "Codex worker adapter").document;
  planSource = readJsonBytes(planInput, "documentation-truth dispatch plan");
  capabilitySource = readJsonBytes(capabilityInput, "fresh Codex capability receipt");
  const plan = planSource.document;
  const capability = capabilitySource.document;

  if (process.env[runnerPolicy.executionEnableEnvironmentVariable] !== "1") throw new Error(`${runnerPolicy.executionEnableEnvironmentVariable}=1 is required for a documentation-truth model turn.`);
  const acceptanceInput = process.env[runnerPolicy.acceptanceReceiptEnvironmentVariable] ?? "";
  if (!acceptanceInput) throw new Error(`${runnerPolicy.acceptanceReceiptEnvironmentVariable} is required; a policy file or legacy boolean is not physical acceptance.`);

  if (plan.schemaVersion !== 1 || plan.kind !== runnerPolicy.acceptedPlanKind || plan.eligible !== true || plan.workerClass !== runnerPolicy.acceptedWorkerClass) throw new Error("documentation-truth dispatch plan is not eligible.");
  const suppliedPlanSha = exactSha(plan.dispatchPlanSha256, "dispatch plan SHA-256");
  const planBody = { ...plan };
  delete planBody.dispatchPlanSha256;
  if (sha256(canonical(planBody)) !== suppliedPlanSha) throw new Error("dispatch plan canonical SHA-256 is invalid.");
  for (const key of ["modelTurnPerformed", "candidateWorktreeMutationPerformed", "primaryRepositoryMutationPerformed", "deterministicValidationPerformed", "commitPerformed", "pushPerformed", "publicationPerformed", "deploymentPerformed", "paidFallbackUsed"]) if (plan[key] !== false) throw new Error(`dispatch plan pre-effect field ${key} must remain false.`);
  if (plan.physicalDocumentationTruthAcceptanceRequired !== true || plan.maximumConcurrency !== 1 || plan.maximumChangedFiles !== 1 || !Number.isInteger(plan.maximumChangedLines) || plan.maximumChangedLines < 1 || plan.maximumChangedLines > runnerPolicy.maximumChangedLines || plan.maximumAutomaticAttempts !== 1 || plan.networkAccessExpected !== false) {
    throw new Error("dispatch plan exceeds documentation-truth resource or acceptance bounds.");
  }
  for (const key of ["workItemSha256", "leasePlanSha256", "routePlanSha256", "routePlanBytesSha256", "routeAdmissionSha256", "supervisedAcceptanceSha256", "capabilityReceiptSha256", "capacityObservationSha256", "acceptanceVerificationSha256", "capacityStatusSha256", "candidateReceiptSha256"]) exactSha(plan[key], key);
  if (typeof plan.stdinPrompt !== "string" || !plan.stdinPrompt.trim() || Buffer.byteLength(plan.stdinPrompt, "utf8") > 131072) throw new Error("dispatch prompt is missing or exceeds 128 KiB.");
  if (!sameArray(plan.apiKeyEnvironmentVariablesMustBeRemoved, adapter.dispatch.apiKeyEnvironmentVariablesMustBeRemoved)) throw new Error("dispatch environment-sanitization list differs from the adapter.");
  const admittedAllowedPaths = Array.isArray(plan.allowedPaths) ? plan.allowedPaths.map((entry) => safeRelative(entry, "allowed path")) : [];
  if (admittedAllowedPaths.length < 1 || admittedAllowedPaths.length > 2 || new Set(admittedAllowedPaths).size !== admittedAllowedPaths.length || admittedAllowedPaths.some((entry) => !runnerPolicy.canonicalAllowedPaths.includes(entry))) {
    throw new Error("dispatch plan allowed paths exceed canonical capability manifests.");
  }
  if (plan.executable !== adapter.executable || plan.routeId !== adapter.spark?.routeId || plan.modelPreference !== adapter.spark?.preferredModel || plan.capacityClass !== adapter.spark?.capacityClass) throw new Error("dispatch plan differs from the admitted Codex adapter route.");
  if (plan.sandboxMode !== adapter.dispatch?.sandboxMode || plan.approvalPolicy !== adapter.dispatch?.approvalPolicy || adapter.dispatch?.networkAccessExpected !== false || adapter.dispatch?.paidFallbackAllowed !== false) throw new Error("dispatch sandbox, approval, network or billing boundary differs from the adapter.");
  if (capabilitySource.sha256 !== plan.capabilityReceiptSha256) throw new Error("fresh capability bytes differ from the dispatch plan.");
  if (capability.schemaVersion !== 1 || capability.kind !== "evavo-codex-worker-capability-probe-v1" || capability.eligibleForWorkerDispatch !== true) throw new Error("fresh eligible Codex capability receipt is required.");
  for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) if (typeof capability.capabilities?.[key] !== "string" || !capability.capabilities[key]) throw new Error(`fresh capability lacks ${key}.`);
  const expectedArgv = ["exec", capability.capabilities.jsonFlag, capability.capabilities.modelFlag, plan.modelPreference, capability.capabilities.sandboxFlag, adapter.dispatch.sandboxMode, capability.capabilities.approvalFlag, adapter.dispatch.approvalPolicy, "-"];
  if (!sameArray(plan.argv, expectedArgv)) throw new Error("dispatch argv differs from the exact admitted Codex invocation.");

  const now = Date.now();
  const capabilityObservedAt = parseTime(capability.observedAt, "capability observedAt");
  if (capabilityObservedAt - now > 120_000 || now - capabilityObservedAt > 600_000) throw new Error("fresh capability receipt is stale or future-dated.");
  const routeObservedAt = parseTime(plan.routeAdmissionObservedAt, "route admission observedAt");
  const routeExpiresAt = parseTime(plan.routeAdmissionExpiresAt, "route admission expiresAt");
  const leaseExpiresAt = parseTime(plan.leaseExpiresAt, "lease expiresAt");
  if (routeObservedAt - now > 120_000 || now - routeObservedAt > 600_000 || routeExpiresAt <= now || routeExpiresAt - routeObservedAt > 600_000 || leaseExpiresAt <= now || leaseExpiresAt > routeExpiresAt) throw new Error("route admission or work-item lease is stale, expired or inconsistent.");

  acceptanceSource = readJsonBytes(acceptanceInput, "documentation-truth physical acceptance receipt");
  if (acceptanceSource.sha256 !== plan.supervisedAcceptanceSha256) throw new Error("physical acceptance bytes differ from the exact acceptance bound into route planning.");
  const verifierPath = fs.realpathSync.native(path.join(ROOT, runnerPolicy.acceptanceVerifier));
  const verifierStat = fs.lstatSync(verifierPath);
  if (!verifierStat.isFile() || verifierStat.isSymbolicLink()) throw new Error("documentation-truth physical acceptance verifier is unavailable or unsafe.");
  const verificationProcess = spawnSync(process.execPath, [verifierPath, acceptanceSource.resolved, capabilitySource.resolved], { cwd: ROOT, env: process.env, encoding: "utf8", shell: false, windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  if (verificationProcess.error) throw verificationProcess.error;
  let verification;
  try { verification = JSON.parse(String(verificationProcess.stdout ?? "").trim()); }
  catch { throw new Error(`documentation-truth acceptance verifier did not return valid JSON: ${String(verificationProcess.stderr ?? "").slice(0, 1000)}`); }
  if (verificationProcess.status !== 0 || verification.accepted !== true || verification.routeId !== plan.routeId || verification.modelPreference !== plan.modelPreference || verification.maximumConcurrency !== 1 || !sameArray(verification.workerClasses, ["documentation-truth"]) || verification.paidFallbackAllowed !== false) {
    throw new Error(`documentation-truth physical acceptance verification failed: ${(verification.errors ?? []).join("; ") || "verification mismatch"}`);
  }
  if (sha256(Buffer.from(String(verificationProcess.stdout ?? ""), "utf8")) !== plan.acceptanceVerificationSha256) throw new Error("fresh acceptance-verification bytes differ from route planning.");
  acceptanceVerified = true;

  candidatePath = fs.realpathSync.native(path.resolve(string(plan.workingDirectory, "candidate working directory", 4096)));
  const candidateStat = fs.lstatSync(candidatePath);
  if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) throw new Error("candidate working directory must be a real non-symlink directory.");
  const gitExecutable = process.platform === "win32" ? "git.exe" : "git";
  const git = (gitArgs) => execFileSync(gitExecutable, gitArgs, { cwd: candidatePath, encoding: "utf8", shell: false, windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024, env: gitEnvironment(process.env) }).trim();
  const gitRoot = fs.realpathSync.native(path.resolve(git(["rev-parse", "--show-toplevel"])));
  if (gitRoot !== candidatePath) throw new Error("dispatch working directory is not the candidate Git root.");
  beforeHead = git(["rev-parse", "HEAD^{commit}"]).toLowerCase();
  if (!SHA1.test(beforeHead) || beforeHead !== plan.sourceRevision) throw new Error("candidate HEAD no longer matches the dispatch source revision.");
  beforeStatus = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (beforeStatus) throw new Error("candidate must be clean immediately before the documentation-truth model turn.");

  const childEnvironment = { ...process.env };
  const removedEnvironment = [];
  for (const name of adapter.dispatch.apiKeyEnvironmentVariablesMustBeRemoved ?? []) {
    if (Object.prototype.hasOwnProperty.call(childEnvironment, name)) removedEnvironment.push(name);
    delete childEnvironment[name];
  }
  for (const name of [runnerPolicy.executionEnableEnvironmentVariable, runnerPolicy.acceptanceReceiptEnvironmentVariable, "EVAVO_CODEX_SPARK_EXECUTION_ENABLED", "EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT", "EVAVO_CODEX_SPARK_CERTIFICATION_MODE"]) delete childEnvironment[name];
  if ((adapter.dispatch.apiKeyEnvironmentVariablesMustBeRemoved ?? []).some((name) => Object.prototype.hasOwnProperty.call(childEnvironment, name))) throw new Error("Codex child environment still contains a forbidden provider/API override.");
  childEnvironment.GIT_TERMINAL_PROMPT = "0";
  childEnvironment.GCM_INTERACTIVE = "Never";
  childEnvironment.EVAVO_AUTONOMOUS_WORKER = "1";
  childEnvironment.EVAVO_AUTONOMOUS_WORKER_CLASS = "documentation-truth";

  const startedAt = new Date().toISOString();
  if (Date.parse(startedAt) >= routeExpiresAt || Date.parse(startedAt) >= leaseExpiresAt) throw new Error("route admission or lease expired immediately before process spawn.");
  modelTurnStarted = true;
  const result = spawnSync(plan.executable, plan.argv, { cwd: candidatePath, env: childEnvironment, encoding: "utf8", input: plan.stdinPrompt, shell: false, windowsHide: true, timeout: runnerPolicy.maximumProcessSeconds * 1000, maxBuffer: 8 * 1024 * 1024 });
  const finishedAt = new Date().toISOString();
  const afterHead = git(["rev-parse", "HEAD^{commit}"]).toLowerCase();
  const staged = git(["diff", "--cached", "--name-only"]);
  const changedPaths = [...new Set([...nulList(git(["diff", "HEAD", "--name-only", "-z"])), ...nulList(git(["ls-files", "--others", "--exclude-standard", "-z"]))])].sort();
  observedChangedPaths = changedPaths;
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const events = [];
  let malformedJsonLines = 0;
  for (const line of stdout.split(/\r?\n/).filter((entry) => entry.trim())) {
    try { const event = JSON.parse(line); if (OBJECT(event)) events.push(event); else malformedJsonLines += 1; }
    catch { malformedJsonLines += 1; }
  }
  const turnCompleted = [...events].reverse().find((event) => event?.type === "turn.completed") ?? null;
  const agentMessage = [...events].reverse().find((event) => event?.type === "item.completed" && event?.item?.type === "agent_message")?.item?.text ?? null;
  let workerSummary = null;
  if (typeof agentMessage === "string") { try { const parsed = JSON.parse(agentMessage); if (OBJECT(parsed)) workerSummary = parsed; } catch {} }
  const structuredTurnCompleted = result.status === 0 && Boolean(turnCompleted) && malformedJsonLines === 0 && exactSummary(workerSummary, dispatchPolicy);

  if (afterHead !== beforeHead) throw new Error("documentation-truth worker changed candidate HEAD or created a commit.");
  if (staged) throw new Error("documentation-truth worker staged Git changes.");
  if (!structuredTurnCompleted) throw new Error("documentation-truth Codex turn did not complete with the exact structured result contract.");
  const summaryPaths = [...new Set(workerSummary.changedPaths.map((entry) => safeRelative(entry, "worker-summary changed path")))].sort();
  if (!sameArray(summaryPaths, changedPaths)) throw new Error("worker summary changedPaths differs from the observed candidate worktree.");
  if (workerSummary.resultState === "SUCCESS") {
    if (changedPaths.length !== 1 || !runnerPolicy.canonicalAllowedPaths.includes(changedPaths[0])) throw new Error("SUCCESS must change exactly one canonical capability manifest.");
  } else if (changedPaths.length !== 0) {
    throw new Error("Only SUCCESS may leave a candidate capability-manifest change.");
  }
  if (changedPaths.length > runnerPolicy.maximumChangedFiles) throw new Error("documentation-truth changed too many files.");
  if (changedPaths.some((entry) => !runnerPolicy.canonicalAllowedPaths.includes(entry))) throw new Error("documentation-truth changed a forbidden path.");
  observedChangedLines = changedLines(git, candidatePath, changedPaths);
  if (observedChangedLines > runnerPolicy.maximumChangedLines) throw new Error("documentation-truth changed too many lines.");
  const manifestAudit = changedPaths.length === 1 ? auditManifest(candidatePath, changedPaths[0], plan.repository) : null;

  const stdoutReceipt = retain(stdout, runnerPolicy.maximumStdoutBytes);
  const stderrReceipt = retain(stderr, runnerPolicy.maximumStderrBytes);
  const messageReceipt = typeof agentMessage === "string" ? retain(agentMessage, runnerPolicy.maximumAgentMessageBytes) : null;
  const receiptBody = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-run-v1",
    ok: true,
    startedAt,
    finishedAt,
    routeId: plan.routeId,
    modelPreference: plan.modelPreference,
    capacityClass: plan.capacityClass,
    maximumConcurrency: 1,
    workItemId: plan.workItemId,
    workerId: plan.workerId,
    workerClass: plan.workerClass,
    repository: plan.repository,
    sourceRevision: plan.sourceRevision,
    workItemSha256: plan.workItemSha256,
    leasePlanSha256: plan.leasePlanSha256,
    leaseExpiresAt: plan.leaseExpiresAt,
    dispatchPlanSha256: plan.dispatchPlanSha256,
    dispatchPlanBytesSha256: planSource.sha256,
    routePlanSha256: plan.routePlanSha256,
    routeAdmissionSha256: plan.routeAdmissionSha256,
    routeAdmissionExpiresAt: plan.routeAdmissionExpiresAt,
    supervisedAcceptanceSha256: plan.supervisedAcceptanceSha256,
    capabilityReceiptSha256: plan.capabilityReceiptSha256,
    acceptanceVerificationSha256: plan.acceptanceVerificationSha256,
    acceptanceVerifiedAtStart: acceptanceVerified,
    candidateReceiptSha256: plan.candidateReceiptSha256,
    candidateHeadBefore: beforeHead,
    candidateHeadAfter: afterHead,
    candidateHeadChanged: false,
    candidateDirtyAfter: changedPaths.length > 0,
    changedPaths,
    changedLines: observedChangedLines,
    manifestAudit,
    exitCode: result.status,
    signal: result.signal ?? null,
    errorType: result.error?.name ?? null,
    errorMessage: result.error ? safeError(result.error.message) : null,
    stdout: stdoutReceipt,
    stderr: stderrReceipt,
    jsonl: {
      parsedEvents: events.length,
      malformedLines: malformedJsonLines,
      turnCompleted: Boolean(turnCompleted),
      usage: turnCompleted?.usage ?? null,
      finalAgentMessage: messageReceipt,
      parsedWorkerSummary: workerSummary,
      workerSummaryContractAccepted: true
    },
    resultState: workerSummary.resultState,
    modelTurnPerformed: true,
    structuredTurnCompleted: true,
    candidateWorktreeMutationPerformed: changedPaths.length > 0,
    primaryRepositoryMutationPerformed: false,
    deterministicValidationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    paidFallbackUsed: false,
    apiKeyOrProviderEnvironmentRemoved: removedEnvironment,
    apiKeyEnvironmentSanitized: true,
    truthBoundary: runnerPolicy.truthBoundary
  };
  process.stdout.write(`${JSON.stringify({ ...receiptBody, receiptSha256: sha256(canonical(receiptBody)) }, null, 2)}\n`);
  process.exitCode = 0;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-run-v1",
    ok: false,
    started: modelTurnStarted,
    acceptanceVerified,
    dispatchPlanBytesAccepted: Boolean(planSource),
    capabilityReceiptBytesAccepted: Boolean(capabilitySource),
    acceptanceReceiptBytesAccepted: Boolean(acceptanceSource),
    candidatePathResolved: Boolean(candidatePath),
    candidateHeadBefore: beforeHead,
    candidateCleanBefore: beforeStatus === "",
    errors: [safeError(error?.message ?? error)],
    modelTurnPerformed: modelTurnStarted,
    candidateWorktreeMutationPerformed: observedChangedPaths.length > 0,
    observedChangedPaths,
    observedChangedLines,
    primaryRepositoryMutationPerformed: false,
    deterministicValidationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    paidFallbackUsed: false
  }, null, 2)}\n`);
  process.exitCode = 1;
}
