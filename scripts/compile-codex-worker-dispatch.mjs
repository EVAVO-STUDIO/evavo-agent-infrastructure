#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [workPathInput, routePathInput, capabilityPathInput, candidateReceiptPathInput, workerId] = process.argv.slice(2);
if (!workPathInput || !routePathInput || !capabilityPathInput || !candidateReceiptPathInput || !workerId || process.argv.slice(2).length !== 5) {
  console.error("Usage: node scripts/compile-codex-worker-dispatch.mjs <leased-work.json> <route-plan.json> <codex-capability.json> <candidate-receipt.json> <worker-id>");
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/;
const DISPATCHABLE_STATES = new Set(["AVAILABLE", "DEGRADED"]);
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

function readOwnedJson(relative, label) {
  return readJsonBytes(path.join(ROOT, relative), label).document;
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

function boundedStringArray(value, label, { minimum = 0, maximum = 256, itemMaximum = 2048 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must be a bounded string array.`);
  }
  return value.map((item) => requireString(item, label, itemMaximum));
}

function safeRelativePattern(value, label) {
  const normalized = requireString(value, label, 512).replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "" || part === "." || part === ".." || part === ".git") ||
    /[\r\n]/.test(normalized)
  ) {
    throw new Error(`${label} must be a safe repository-relative path or glob.`);
  }
  return normalized;
}

function safePromptText(value, label, maximum = 16_384) {
  const text = requireString(value, label, maximum);
  if (text.includes("\0")) throw new Error(`${label} contains a null character.`);
  return text;
}

function safeError(value) {
  let text = String(value ?? "Codex dispatch compilation failed");
  text = text.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  text = text.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  text = text.replace(/(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi, "credential=<redacted>");
  return text.slice(0, 1000);
}

try {
  if (!WORKER_ID.test(workerId)) throw new Error("Worker id is invalid.");

  const workEvidence = readJsonBytes(workPathInput, "leased work item");
  const routeEvidence = readJsonBytes(routePathInput, "worker route plan");
  const capabilityEvidence = readJsonBytes(capabilityPathInput, "Codex capability receipt");
  const candidateEvidence = readJsonBytes(candidateReceiptPathInput, "candidate worktree receipt");
  const work = workEvidence.document;
  const route = routeEvidence.document;
  const capability = capabilityEvidence.document;
  const candidateReceipt = candidateEvidence.document;
  const adapter = readOwnedJson("config/codex-worker-adapter-v1.json", "Codex worker adapter policy");
  const routing = readOwnedJson("config/worker-capacity-routing-v1.json", "worker capacity routing policy");
  const sparkRoute = (routing.workerRoutes ?? []).find((entry) => entry?.id === "codex-spark-pro");
  if (!OBJECT(sparkRoute)) throw new Error("Canonical codex-spark-pro route is unavailable.");

  if (work.lifecycleState !== "LEASED") throw new Error("Work item must be LEASED before dispatch compilation.");
  if (!OBJECT(work.lease) || work.lease.workerId !== workerId) throw new Error("Work item lease must belong to the requested worker id.");
  if (work.lease.expiresAt !== undefined && parseTime(work.lease.expiresAt, "Work-item lease expiry") <= Date.now()) {
    throw new Error("Work-item lease is expired.");
  }
  if (work.workerClass !== "test-generation") throw new Error("Initial Codex dispatcher only admits test-generation.");
  if (work.capacityClass !== "included-consumer") throw new Error("Test Builder work must request included-consumer capacity.");
  if (work.paidFallbackAllowed !== false) throw new Error("Paid fallback must be false.");
  const workItemId = requireString(work.id, "Work-item id", 256);
  const repository = requireString(work.repository, "Work-item repository", 160);
  const sourceRevision = requireSha(work.sourceRevision, "Work-item source revision", SHA1);
  const objective = safePromptText(work.objective, "Work-item objective");
  const allowedPaths = boundedStringArray(work.allowedPaths, "Work-item allowedPaths", { minimum: 1 }).map((value) => safeRelativePattern(value, "Allowed path"));
  const forbiddenPaths = boundedStringArray(work.forbiddenPaths ?? [], "Work-item forbiddenPaths").map((value) => safeRelativePattern(value, "Forbidden path"));
  if (!Array.isArray(work.requiredValidation) || work.requiredValidation.length < 1 || work.requiredValidation.length > 128) {
    throw new Error("Work item requires bounded external deterministic validation steps.");
  }

  if (route.schemaVersion !== 1 || route.kind !== "evavo-worker-route-plan-v1" || route.eligible !== true || route.decision !== "DISPATCH_ELIGIBLE") {
    throw new Error("Route plan is not dispatch eligible.");
  }
  const expectedRoutePlanSha256 = requireSha(route.routePlanSha256, "Route-plan SHA-256");
  const observedRoutePlanSha256 = sha256Bytes(Buffer.from(canonicalJson(without(route, "routePlanSha256")), "utf8"));
  if (observedRoutePlanSha256 !== expectedRoutePlanSha256) throw new Error("Route-plan SHA-256 does not match its canonical body.");
  if (route.workerClass !== work.workerClass || route.repository !== repository || route.sourceRevision !== sourceRevision) {
    throw new Error("Route-plan work identity differs from the leased work item.");
  }
  if (route.routeId !== sparkRoute.id || route.routeId !== adapter.spark?.routeId) throw new Error("Route plan is not the admitted Spark route.");
  if (route.runtime !== sparkRoute.runtime) throw new Error("Route-plan runtime differs from route policy.");
  if (route.modelPreference !== sparkRoute.modelPreference || route.modelPreference !== adapter.spark?.preferredModel) {
    throw new Error("Route-plan model differs from the admitted Spark model.");
  }
  if (route.capacityClass !== sparkRoute.capacityClass || route.capacityClass !== work.capacityClass) {
    throw new Error("Route-plan capacity class differs from the work item or route policy.");
  }
  if (!DISPATCHABLE_STATES.has(route.rawCapacityState) || route.capacityState !== route.rawCapacityState) {
    throw new Error("Route plan does not preserve a dispatchable raw capacity state.");
  }
  if (route.paidFallbackUsed !== false) throw new Error("Route plan did not preserve zero-paid-fallback truth.");
  if (route.executionPerformed !== false || route.validationPerformed !== false || route.publicationPerformed !== false) {
    throw new Error("Route plan exceeds planning-only authority.");
  }
  if (route.maximumConcurrency !== 1 || route.maximumAutomaticConcurrency !== 1 || sparkRoute.maximumAutomaticConcurrency !== 1) {
    throw new Error("Route plan exceeds the physically admitted Spark concurrency of one.");
  }
  if (!Array.isArray(sparkRoute.workerClasses) || sparkRoute.workerClasses.length !== 1 || sparkRoute.workerClasses[0] !== work.workerClass) {
    throw new Error("Spark route worker-class policy differs from the single admitted Test Builder class.");
  }

  const routeAdmissionSha256 = requireSha(route.routeAdmissionSha256, "Route admission SHA-256");
  const supervisedAcceptanceSha256 = requireSha(route.supervisedAcceptanceSha256, "Supervised acceptance SHA-256");
  const capabilityReceiptSha256 = requireSha(route.capabilityReceiptSha256, "Capability receipt SHA-256");
  const capacityObservationSha256 = requireSha(route.capacityObservationSha256, "Capacity observation SHA-256");
  const acceptanceVerificationSha256 = requireSha(route.acceptanceVerificationSha256, "Acceptance verification SHA-256");
  const capacityStatusSha256 = requireSha(route.capacityStatusSha256, "Capacity-status SHA-256");
  const admissionObservedAt = parseTime(route.routeAdmissionObservedAt, "Route admission observedAt");
  const admissionExpiresAt = parseTime(route.routeAdmissionExpiresAt, "Route admission expiresAt");
  const now = Date.now();
  if (admissionObservedAt - now > 120_000) throw new Error("Route admission is future-dated.");
  if (now - admissionObservedAt > 600_000) throw new Error("Route admission is stale.");
  if (admissionExpiresAt <= now) throw new Error("Route admission is expired.");
  if (admissionExpiresAt - admissionObservedAt > 600_000) throw new Error("Route admission lifetime exceeds the bounded policy.");
  if (capabilityEvidence.sha256 !== capabilityReceiptSha256) {
    throw new Error("Capability receipt bytes differ from the receipt admitted by route planning.");
  }

  if (capability.schemaVersion !== 1 || capability.kind !== "evavo-codex-worker-capability-probe-v1" || capability.eligibleForWorkerDispatch !== true) {
    throw new Error("Codex capability receipt is not eligible for dispatch.");
  }
  const capabilityObservedAt = parseTime(capability.observedAt, "Codex capability observedAt");
  if (capabilityObservedAt - now > 120_000 || now - capabilityObservedAt > 600_000) {
    throw new Error("Codex capability receipt is stale or future-dated.");
  }
  for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
    if (typeof capability.capabilities?.[key] !== "string" || !capability.capabilities[key]) {
      throw new Error(`Codex capability receipt lacks ${key}.`);
    }
  }

  if (candidateReceipt.schemaVersion !== 1 || candidateReceipt.kind !== "evavo-autonomous-candidate-worktree-v1") {
    throw new Error("Candidate worktree receipt is invalid.");
  }
  if (candidateReceipt.workItemId !== workItemId || candidateReceipt.sourceRevision !== sourceRevision) {
    throw new Error("Candidate worktree receipt does not match the leased work item.");
  }
  if (candidateReceipt.candidate?.contract !== "evavo_mainline_candidate_worktree_v1") {
    throw new Error("Candidate worktree contract is invalid.");
  }
  const candidatePath = fs.realpathSync.native(path.resolve(requireString(candidateReceipt.candidate.path, "Candidate path", 4096)));
  const candidateStat = fs.lstatSync(candidatePath);
  if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) throw new Error("Candidate working directory must be a real non-symlink directory.");

  const allowed = allowedPaths.map((value) => `- ${value}`).join("\n");
  const forbidden = forbiddenPaths.length > 0
    ? forbiddenPaths.map((value) => `- ${value}`).join("\n")
    : "- any path outside the allowed paths\n- production source unless explicitly listed as a test-support path\n- .git metadata";
  const validation = work.requiredValidation
    .map((value) => `- ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
  const prompt = `You are an EVAVO Test Builder worker. Complete exactly one bounded test-generation job.\n\nRepository: ${repository}\nExact source revision: ${sourceRevision}\nObjective: ${objective}\n\nAllowed paths:\n${allowed}\n\nForbidden paths:\n${forbidden}\n\nRequired downstream validation (do not claim these passed unless the external validator later supplies receipts):\n${validation}\n\nRules:\n- Add only meaningful regression, boundary, failure-path, or state-transition coverage required by the objective.\n- Do not redesign, refactor unrelated code, change dependencies, schemas, public APIs, creative assets, brand, story, art direction, or owner-authored copy.\n- Do not commit, push, publish, deploy, or change Git metadata.\n- Do not use the network, install dependencies, or alter machine/user configuration.\n- Do not broaden scope merely to consume model capacity. NO_ACTION is valid when coverage is already sufficient.\n- If production behavior is ambiguous or source changes would be required, return NEEDS_DEEP_WORKER or NEEDS_HUMAN rather than guessing.\n- Keep the patch bounded and leave deterministic validation to the EVAVO validation queue.\n\nYour final agent message must be JSON only, with exactly this shape and no Markdown fence:\n{\"resultState\":\"SUCCESS|NO_ACTION|BLOCKED|NEEDS_DEEP_WORKER|NEEDS_HUMAN\",\"changedPaths\":[\"path\"],\"assertionsAdded\":[\"brief assertion purpose\"],\"assumptions\":[\"brief assumption\"],\"followUp\":[\"brief follow-up\"]}\nUse empty arrays when a list has no entries. Do not claim downstream validation passed.\n`;
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) throw new Error("Compiled Codex prompt exceeds the bounded 128 KiB limit.");

  const argv = [
    "exec",
    capability.capabilities.jsonFlag,
    capability.capabilities.modelFlag,
    route.modelPreference,
    capability.capabilities.sandboxFlag,
    adapter.dispatch.sandboxMode,
    capability.capabilities.approvalFlag,
    adapter.dispatch.approvalPolicy,
    "-",
  ];

  const planBody = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-dispatch-plan-v1",
    eligible: true,
    workerId,
    workItemId,
    workerClass: work.workerClass,
    repository,
    sourceRevision,
    fixtureOnly: work.fixtureOnly === true,
    routeId: route.routeId,
    runtime: route.runtime,
    modelPreference: route.modelPreference,
    capacityClass: route.capacityClass,
    rawCapacityState: route.rawCapacityState,
    maximumConcurrency: 1,
    routePlanSha256: expectedRoutePlanSha256,
    routePlanBytesSha256: routeEvidence.sha256,
    capacityStatusSha256,
    routeAdmissionSha256,
    routeAdmissionObservedAt: new Date(admissionObservedAt).toISOString(),
    routeAdmissionExpiresAt: new Date(admissionExpiresAt).toISOString(),
    supervisedAcceptanceSha256,
    capabilityReceiptSha256,
    capacityObservationSha256,
    acceptanceVerificationSha256,
    candidateReceiptSha256: candidateEvidence.sha256,
    executable: adapter.executable,
    argv,
    stdinPrompt: prompt,
    workingDirectory: candidatePath,
    candidateContract: candidateReceipt.candidate.contract,
    candidateTreeSha: candidateReceipt.sourceTreeSha ?? null,
    shell: false,
    structuredOutputRequired: true,
    workerSummarySchemaVersion: 1,
    sandboxMode: adapter.dispatch.sandboxMode,
    approvalPolicy: adapter.dispatch.approvalPolicy,
    networkAccessExpected: adapter.dispatch.networkAccessExpected,
    apiKeyEnvironmentVariablesMustBeRemoved: adapter.dispatch.apiKeyEnvironmentVariablesMustBeRemoved,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    publicationAuthority: false,
    validationAuthority: false,
    paidFallbackUsed: false,
    truthBoundary: "This exact-byte-bound plan admits one Test Builder Codex Exec invocation in an isolated candidate worktree. The runner must recheck the dispatch digest, short-lived route admission, supervised acceptance bytes, same capability bytes, exact candidate HEAD and clean pre-turn state immediately before execution. It grants no deterministic-validation, commit, push, deployment or publication authority.",
  };
  process.stdout.write(`${JSON.stringify({
    ...planBody,
    dispatchPlanSha256: sha256Bytes(Buffer.from(canonicalJson(planBody), "utf8")),
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-worker-dispatch-plan-v1",
    eligible: false,
    errors: [safeError(error?.message ?? error)],
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    publicationAuthority: false,
    validationAuthority: false,
    paidFallbackUsed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
