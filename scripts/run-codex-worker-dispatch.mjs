#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [dispatchPlanPathInput, capabilityReceiptPathInput] = process.argv.slice(2);
if (!dispatchPlanPathInput || !capabilityReceiptPathInput || process.argv.slice(2).length !== 2) {
  console.error("Usage: node scripts/run-codex-worker-dispatch.mjs <dispatch-plan.json> <codex-capability-receipt.json>");
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RESULT_STATES = new Set(["SUCCESS", "NO_ACTION", "BLOCKED", "NEEDS_DEEP_WORKER", "NEEDS_HUMAN"]);
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_BYTES = 128 * 1024;

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

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function without(value, key) {
  const result = { ...value };
  delete result[key];
  return result;
}

function readJsonBytes(value, label) {
  const resolved = fs.realpathSync.native(path.resolve(value));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  const bytes = fs.readFileSync(resolved);
  if (bytes.length < 2 || bytes.length > MAX_INPUT_BYTES) throw new Error(`${label} is outside the bounded 8 MiB limit.`);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
  if (!OBJECT(document)) throw new Error(`${label} must contain a JSON object.`);
  return { resolved, bytes, document, sha256: sha256Bytes(bytes) };
}

function requireString(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value || value.length > maximum || value.includes("\0")) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value;
}

function requireSha(value, label, pattern = SHA256) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function parseTime(value, label) {
  requireString(value, label, 64);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return milliseconds;
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeError(value) {
  let text = String(value ?? "Codex worker preflight failed");
  text = text.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  text = text.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  text = text.replace(/(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi, "credential=<redacted>");
  return text.slice(0, 1500);
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
    GIT_CONFIG_NOSYSTEM: "1",
  };
}

function retain(value, maximumBytes) {
  const text = typeof value === "string" ? value : "";
  const encoded = Buffer.from(text, "utf8");
  const digest = sha256Bytes(encoded);
  if (encoded.length <= maximumBytes) return { text, truncated: false, bytes: encoded.length, sha256: digest };
  let retained = encoded.subarray(0, maximumBytes).toString("utf8");
  while (Buffer.byteLength(retained, "utf8") > maximumBytes) retained = retained.slice(0, -1);
  return {
    text: retained,
    truncated: true,
    bytes: encoded.length,
    retainedBytes: Buffer.byteLength(retained, "utf8"),
    sha256: digest,
  };
}

function exactWorkerSummary(value) {
  if (!OBJECT(value)) return false;
  const expected = ["assertionsAdded", "assumptions", "changedPaths", "followUp", "resultState"].sort();
  const actual = Object.keys(value).sort();
  if (!sameArray(actual, expected) || !RESULT_STATES.has(value.resultState)) return false;
  return ["changedPaths", "assertionsAdded", "assumptions", "followUp"].every(
    (field) => Array.isArray(value[field]) && value[field].length <= 256 && value[field].every((item) => typeof item === "string" && item.length <= 2048),
  );
}

let planEvidence;
let capabilityEvidence;
let plan;
let capability;
let adapter;
let certificationMode = false;
let legacyProfileFlagPresent = false;
let executionEnabled = false;
let chatgptAuthPolicyAccepted = false;
let acceptanceVerification = null;
let supervisedAcceptanceSha256 = null;
let routeAdmissionSha256 = null;
let capabilityReceiptSha256 = null;
let routeAdmissionVerifiedAtStart = false;
let supervisedPhysicalAcceptanceVerifiedAtStart = false;
let candidatePath = null;
let beforeHead = null;
let beforeStatus = null;
let preflightStartedAt = new Date().toISOString();

try {
  planEvidence = readJsonBytes(dispatchPlanPathInput, "dispatch plan");
  capabilityEvidence = readJsonBytes(capabilityReceiptPathInput, "Codex capability receipt");
  plan = planEvidence.document;
  capability = capabilityEvidence.document;
  adapter = readJsonBytes(path.join(ROOT, "config", "codex-worker-adapter-v1.json"), "Codex worker adapter policy").document;

  executionEnabled = process.env.EVAVO_CODEX_SPARK_EXECUTION_ENABLED === "1";
  legacyProfileFlagPresent = process.env.EVAVO_CODEX_SPARK_PROFILE_ACCEPTED === "1";
  certificationMode = process.env.EVAVO_CODEX_SPARK_CERTIFICATION_MODE === "1";
  chatgptAuthPolicyAccepted = process.env.EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED === "1";
  if (!executionEnabled) throw new Error("EVAVO_CODEX_SPARK_EXECUTION_ENABLED=1 is required for a model turn.");

  if (plan.schemaVersion !== 1 || plan.kind !== "evavo-codex-worker-dispatch-plan-v1" || plan.eligible !== true) {
    throw new Error("Dispatch plan is not eligible.");
  }
  const expectedDispatchPlanSha256 = requireSha(plan.dispatchPlanSha256, "Dispatch-plan SHA-256");
  const observedDispatchPlanSha256 = sha256Bytes(Buffer.from(canonicalJson(without(plan, "dispatchPlanSha256")), "utf8"));
  if (observedDispatchPlanSha256 !== expectedDispatchPlanSha256) throw new Error("Dispatch-plan SHA-256 does not match its canonical body.");
  if (planEvidence.sha256 === expectedDispatchPlanSha256) {
    // Exact file-byte and canonical-body hashes are intentionally different evidence classes.
    // Equality is permitted but never assumed.
  }

  if (plan.executable !== adapter.executable) throw new Error("Dispatch executable differs from the admitted adapter.");
  if (plan.routeId !== adapter.spark?.routeId || plan.modelPreference !== adapter.spark?.preferredModel) {
    throw new Error("Dispatch route/model differs from the admitted Spark adapter.");
  }
  if (plan.workerClass !== "test-generation") throw new Error("Normal Spark runner only admits the Test Builder worker class.");
  if (plan.maximumConcurrency !== 1) throw new Error("Dispatch plan exceeds the admitted Spark concurrency of one.");
  if (plan.publicationAuthority !== false || plan.validationAuthority !== false || plan.paidFallbackUsed !== false) {
    throw new Error("Dispatch plan exceeds the worker authority boundary.");
  }
  if (plan.modelTurnPerformed !== false || plan.repositoryMutationPerformed !== false) {
    throw new Error("Dispatch plan incorrectly claims prior execution or mutation.");
  }
  requireString(plan.workItemId, "Dispatch work-item id", 256);
  requireString(plan.workerId, "Dispatch worker id", 256);
  requireString(plan.repository, "Dispatch repository", 160);
  requireSha(plan.sourceRevision, "Dispatch source revision", SHA1);
  requireSha(plan.routePlanSha256, "Route-plan SHA-256");
  requireSha(plan.capacityStatusSha256, "Capacity-status SHA-256");
  requireSha(plan.capacityObservationSha256, "Capacity-observation SHA-256");
  requireSha(plan.acceptanceVerificationSha256, "Acceptance-verification SHA-256");
  routeAdmissionSha256 = requireSha(plan.routeAdmissionSha256, "Route-admission SHA-256");
  supervisedAcceptanceSha256 = requireSha(plan.supervisedAcceptanceSha256, "Supervised-acceptance SHA-256");
  capabilityReceiptSha256 = requireSha(plan.capabilityReceiptSha256, "Capability-receipt SHA-256");
  if (capabilityEvidence.sha256 !== capabilityReceiptSha256) {
    throw new Error("Capability receipt bytes differ from the exact receipt bound into the dispatch plan.");
  }

  if (capability.schemaVersion !== 1 || capability.kind !== "evavo-codex-worker-capability-probe-v1" || capability.eligibleForWorkerDispatch !== true) {
    throw new Error("Fresh eligible Codex capability receipt is required.");
  }
  const now = Date.now();
  const capabilityObservedAt = parseTime(capability.observedAt, "Codex capability observedAt");
  if (capabilityObservedAt - now > 120_000 || now - capabilityObservedAt > 600_000) {
    throw new Error("Codex capability receipt is stale or future-dated.");
  }
  for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
    if (typeof capability.capabilities?.[key] !== "string" || !capability.capabilities[key]) {
      throw new Error(`Codex capability receipt lacks ${key}.`);
    }
  }

  const expectedArgv = [
    "exec",
    capability.capabilities.jsonFlag,
    capability.capabilities.modelFlag,
    plan.modelPreference,
    capability.capabilities.sandboxFlag,
    adapter.dispatch.sandboxMode,
    capability.capabilities.approvalFlag,
    adapter.dispatch.approvalPolicy,
    "-",
  ];
  if (!sameArray(plan.argv, expectedArgv)) throw new Error("Dispatch argv differs from the exact admitted Codex invocation.");
  if (plan.sandboxMode !== adapter.dispatch.sandboxMode || plan.approvalPolicy !== adapter.dispatch.approvalPolicy) {
    throw new Error("Dispatch sandbox or approval policy differs from the adapter.");
  }
  if (typeof plan.stdinPrompt !== "string" || !plan.stdinPrompt.trim() || Buffer.byteLength(plan.stdinPrompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new Error("Dispatch prompt is missing or exceeds its bounded size.");
  }

  const admissionObservedAt = parseTime(plan.routeAdmissionObservedAt, "Route admission observedAt");
  const admissionExpiresAt = parseTime(plan.routeAdmissionExpiresAt, "Route admission expiresAt");
  if (admissionObservedAt - now > 120_000 || now - admissionObservedAt > 600_000) throw new Error("Route admission is stale or future-dated.");
  if (admissionExpiresAt <= now) throw new Error("Route admission expired before the Codex process boundary.");
  if (admissionExpiresAt - admissionObservedAt > 600_000) throw new Error("Route admission lifetime exceeds its bounded policy.");
  routeAdmissionVerifiedAtStart = true;

  if (certificationMode) {
    if (plan.fixtureOnly !== true || plan.repository !== "EVAVO-STUDIO/_autonomous-spark-fixture") {
      throw new Error("Certification mode only admits the dedicated fixture repository and a fixtureOnly dispatch plan.");
    }
    if (!chatgptAuthPolicyAccepted) {
      throw new Error("Certification mode requires EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED=1 from the read-only auth-policy probe.");
    }
    if (process.env.EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT) {
      throw new Error("Certification mode may not reuse a prior supervised physical-acceptance envelope.");
    }
  } else {
    if (plan.fixtureOnly === true) throw new Error("Normal Spark execution may not consume a physical-certification fixture dispatch.");
    const acceptanceInput = process.env.EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT ?? "";
    if (!acceptanceInput) {
      throw new Error("Normal Spark execution requires EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT; the legacy PROFILE_ACCEPTED boolean is not authority.");
    }
    const acceptanceEvidence = readJsonBytes(acceptanceInput, "supervised physical acceptance");
    if (acceptanceEvidence.sha256 !== supervisedAcceptanceSha256) {
      throw new Error("Supervised physical-acceptance bytes differ from the exact acceptance bound into the dispatch plan.");
    }
    const verifierPath = fs.realpathSync.native(path.join(ROOT, "scripts", "verify-codex-spark-safe-physical-acceptance.mjs"));
    const verifierStat = fs.lstatSync(verifierPath);
    if (!verifierStat.isFile() || verifierStat.isSymbolicLink()) throw new Error("Supervised physical-acceptance verifier is unavailable or unsafe.");
    const verificationProcess = spawnSync(process.execPath, [verifierPath, acceptanceEvidence.resolved, capabilityEvidence.resolved], {
      cwd: ROOT,
      env: process.env,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (verificationProcess.error) throw verificationProcess.error;
    let verification;
    try {
      verification = JSON.parse(String(verificationProcess.stdout ?? "").trim());
    } catch {
      throw new Error(`Supervised physical-acceptance verifier did not return valid JSON: ${String(verificationProcess.stderr ?? "").trim().slice(0, 1000)}`);
    }
    if (verificationProcess.status !== 0 || verification.accepted !== true) {
      const detail = Array.isArray(verification.errors) ? verification.errors.join("; ") : "verification rejected";
      throw new Error(`Supervised physical-acceptance verification failed: ${detail}`);
    }
    if (
      verification.supervisedCleanupProven !== true ||
      verification.routeId !== plan.routeId ||
      verification.modelPreference !== plan.modelPreference ||
      verification.paidFallbackAllowed !== false ||
      verification.maximumConcurrency !== 1 ||
      !Array.isArray(verification.workerClasses) ||
      verification.workerClasses.length !== 1 ||
      verification.workerClasses[0] !== plan.workerClass
    ) {
      throw new Error("Supervised physical acceptance does not admit the exact Test Builder route, class and concurrency.");
    }
    const observedVerificationSha256 = sha256Bytes(Buffer.from(String(verificationProcess.stdout ?? ""), "utf8"));
    if (observedVerificationSha256 !== plan.acceptanceVerificationSha256) {
      throw new Error("Fresh acceptance-verification bytes differ from the verification bound into route planning.");
    }
    acceptanceVerification = verification;
    supervisedPhysicalAcceptanceVerifiedAtStart = true;
  }

  candidatePath = fs.realpathSync.native(path.resolve(requireString(plan.workingDirectory, "Candidate working directory", 4096)));
  const candidateStat = fs.lstatSync(candidatePath);
  if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) throw new Error("Candidate working directory must be a real non-symlink directory.");
  const gitExecutable = process.platform === "win32" ? "git.exe" : "git";
  const git = (arguments) => execFileSync(gitExecutable, arguments, {
    cwd: candidatePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: gitEnvironment(process.env),
  }).trim();
  const gitRoot = fs.realpathSync.native(path.resolve(git(["rev-parse", "--show-toplevel"])));
  if (gitRoot !== candidatePath) throw new Error("Dispatch working directory is not the candidate Git root.");
  beforeHead = git(["rev-parse", "HEAD^{commit}"]).toLowerCase();
  if (beforeHead !== plan.sourceRevision) throw new Error("Candidate HEAD no longer matches the dispatch source revision.");
  beforeStatus = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (beforeStatus) throw new Error("Candidate must be clean immediately before the Codex model turn.");

  const childEnvironment = { ...process.env };
  const removedEnvironment = [];
  for (const name of adapter.dispatch.apiKeyEnvironmentVariablesMustBeRemoved ?? []) {
    if (Object.prototype.hasOwnProperty.call(childEnvironment, name)) removedEnvironment.push(name);
    delete childEnvironment[name];
  }
  for (const name of [
    "EVAVO_CODEX_SPARK_EXECUTION_ENABLED",
    "EVAVO_CODEX_SPARK_PROFILE_ACCEPTED",
    "EVAVO_CODEX_SPARK_ACCEPTANCE_RECEIPT",
    "EVAVO_CODEX_SPARK_CERTIFICATION_MODE",
    "EVAVO_CODEX_CHATGPT_AUTH_POLICY_ACCEPTED",
  ]) delete childEnvironment[name];
  const sanitizedEnvironmentNames = adapter.dispatch.apiKeyEnvironmentVariablesMustBeRemoved ?? [];
  if (!sanitizedEnvironmentNames.every((name) => !Object.prototype.hasOwnProperty.call(childEnvironment, name))) {
    throw new Error("Codex child environment still contains a forbidden provider/API override.");
  }
  childEnvironment.GIT_TERMINAL_PROMPT = "0";
  childEnvironment.GCM_INTERACTIVE = "Never";
  childEnvironment.EVAVO_AUTONOMOUS_WORKER = "1";
  childEnvironment.EVAVO_AUTONOMOUS_WORKER_CLASS = "test-generation";
  childEnvironment.EVAVO_AUTONOMOUS_FIXTURE_ONLY = plan.fixtureOnly === true ? "1" : "0";

  const startedAt = new Date().toISOString();
  if (Date.parse(startedAt) >= admissionExpiresAt) throw new Error("Route admission expired immediately before process spawn.");
  const result = spawnSync(plan.executable, plan.argv, {
    cwd: candidatePath,
    env: childEnvironment,
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
      const event = JSON.parse(line);
      if (OBJECT(event)) events.push(event);
      else malformedJsonLines += 1;
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
      if (OBJECT(parsed)) workerSummary = parsed;
    } catch {}
  }
  const structuredTurnCompleted = result.status === 0 && Boolean(turnCompleted) && malformedJsonLines === 0 && exactWorkerSummary(workerSummary);
  const stdoutReceipt = retain(stdout, adapter.dispatch.maximumRetainedStdoutBytes ?? 262_144);
  const stderrReceipt = retain(stderr, adapter.dispatch.maximumRetainedStderrBytes ?? 131_072);
  const agentMessageReceipt = typeof agentMessage === "string" ? retain(agentMessage, 32_768) : null;

  const receipt = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-run-v1",
    routeId: plan.routeId,
    modelPreference: plan.modelPreference,
    capacityClass: plan.capacityClass,
    rawCapacityState: plan.rawCapacityState,
    maximumConcurrency: 1,
    workItemId: plan.workItemId,
    workerId: plan.workerId,
    workerClass: plan.workerClass,
    repository: plan.repository,
    sourceRevision: plan.sourceRevision,
    fixtureOnly: plan.fixtureOnly === true,
    certificationMode,
    legacyProfileFlagPresentAtStart: legacyProfileFlagPresent,
    routeAdmissionVerifiedAtStart,
    supervisedPhysicalAcceptanceVerifiedAtStart,
    supervisedPhysicalAcceptanceRouteId: acceptanceVerification?.routeId ?? null,
    supervisedPhysicalAcceptanceWorkerClasses: acceptanceVerification?.workerClasses ?? [],
    chatgptAuthPolicyGateAtStart: certificationMode ? chatgptAuthPolicyAccepted : null,
    dispatchPlanSha256: plan.dispatchPlanSha256,
    dispatchPlanBytesSha256: planEvidence.sha256,
    routePlanSha256: plan.routePlanSha256,
    capacityStatusSha256: plan.capacityStatusSha256,
    routeAdmissionSha256,
    routeAdmissionObservedAt: plan.routeAdmissionObservedAt,
    routeAdmissionExpiresAt: plan.routeAdmissionExpiresAt,
    supervisedAcceptanceSha256,
    capabilityReceiptSha256,
    capacityObservationSha256: plan.capacityObservationSha256,
    acceptanceVerificationSha256: plan.acceptanceVerificationSha256,
    candidateReceiptSha256: plan.candidateReceiptSha256,
    startedAt,
    finishedAt,
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
      finalAgentMessage: agentMessageReceipt,
      parsedWorkerSummary: workerSummary,
      workerSummaryContractAccepted: exactWorkerSummary(workerSummary),
    },
    modelTurnCompleted: structuredTurnCompleted,
    structuredTurnCompleted,
    candidateHeadBefore: beforeHead,
    candidateHeadAfter: afterHead,
    candidateHeadChanged: afterHead !== beforeHead,
    candidateDirtyAfter: Boolean(afterStatus),
    apiKeyOrProviderEnvironmentRemoved: removedEnvironment,
    apiKeyEnvironmentSanitized: true,
    sanitizedEnvironmentNames,
    sandboxMode: plan.sandboxMode,
    approvalPolicy: plan.approvalPolicy,
    paidFallbackUsed: false,
    deterministicValidationPerformed: false,
    publicationPerformed: false,
    truthBoundary: "This is the bounded direct Codex process receipt. The runner revalidated the exact dispatch digest, short-lived route admission, same fresh capability bytes, exact candidate HEAD and clean pre-turn state. Normal execution additionally rehashed and reverified the exact supervised acceptance against that same capability receipt. A completed model turn is not deterministic validation, approval, commit, push or publication.",
  };
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  process.exit(structuredTurnCompleted && afterHead === beforeHead ? 0 : 1);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-worker-run-v1",
    started: false,
    certificationMode,
    legacyProfileFlagPresent,
    routeAdmissionVerified: routeAdmissionVerifiedAtStart,
    supervisedPhysicalAcceptanceVerified: supervisedPhysicalAcceptanceVerifiedAtStart,
    dispatchPlanBytesAccepted: Boolean(planEvidence),
    capabilityReceiptBytesAccepted: Boolean(capabilityEvidence),
    errors: [safeError(error?.message ?? error)],
    modelTurnPerformed: false,
    deterministicValidationPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
    paidFallbackUsed: false,
    preflightStartedAt,
  }, null, 2)}\n`);
  process.exit(1);
}
