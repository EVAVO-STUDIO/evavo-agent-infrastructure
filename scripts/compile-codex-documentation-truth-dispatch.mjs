#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
const canonicalJson = (value) => JSON.stringify(ordered(value));
const sha256 = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).digest("hex");

function readJsonBytes(input, label, maximum = MAX_INPUT_BYTES) {
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
function ownedJson(relative, label) { return readJsonBytes(path.join(ROOT, relative), label, 2 * 1024 * 1024); }
function string(value, label, maximum = 4096) {
  if (typeof value !== "string" || !value || value.length > maximum || value.includes("\0")) throw new Error(`${label} must be a non-empty bounded string.`);
  return value;
}
function exactSha(value, label, expression = SHA256) {
  const text = string(value, label, 64);
  if (!expression.test(text)) throw new Error(`${label} is invalid.`);
  return text;
}
function integer(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
function parseTime(value, label) {
  const milliseconds = Date.parse(string(value, label, 64));
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return milliseconds;
}
function safePath(value, label) {
  const normalized = string(value, label, 512).replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").some((part) => !part || part === "." || part === ".." || part === ".git") || /[\r\n]/.test(normalized)) {
    throw new Error(`${label} is not a safe repository-relative path.`);
  }
  return normalized;
}
function arrayOfStrings(value, label, minimum = 0, maximum = 64) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(`${label} must be a bounded string array.`);
  const result = value.map((item) => string(item, `${label} entry`, 2048));
  if (new Set(result).size !== result.length) throw new Error(`${label} must not contain duplicates.`);
  return result;
}
function bodySha(document, field) {
  const body = { ...document };
  delete body[field];
  return sha256(canonicalJson(body));
}
function safeError(value) {
  return String(value ?? "documentation-truth dispatch compilation failed")
    .replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>")
    .replace(/(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi, "credential=<redacted>")
    .slice(0, 1400);
}

function parseArguments(argv) {
  if (argv.length !== 5 && argv.length !== 7) {
    throw new Error("Usage: node scripts/compile-codex-documentation-truth-dispatch.mjs <leased-work.json> <route-plan.json> <codex-capability.json> <candidate-receipt.json> <worker-id> [--now <iso-8601>]");
  }
  const [workInput, routeInput, capabilityInput, candidateInput, workerId, option, nowInput] = argv;
  if (argv.length === 7 && option !== "--now") throw new Error("Only --now is accepted as an optional argument.");
  return { workInput, routeInput, capabilityInput, candidateInput, workerId, nowInput };
}

try {
  const { workInput, routeInput, capabilityInput, candidateInput, workerId, nowInput } = parseArguments(process.argv.slice(2));
  if (!WORKER_ID.test(workerId)) throw new Error("worker id is invalid.");
  const policySource = ownedJson("config/codex-documentation-truth-dispatch-v1.json", "documentation-truth dispatch policy");
  const adapterSource = ownedJson("config/codex-worker-adapter-v1.json", "Codex worker adapter");
  const policy = policySource.document;
  const adapter = adapterSource.document;
  if (policy.schemaVersion !== 1 || policy.kind !== "evavo-codex-documentation-truth-dispatch-policy-v1") throw new Error("documentation-truth dispatch policy identity is invalid.");
  for (const key of ["deterministicValidationAuthority", "commitAuthority", "pushAuthority", "publicationAuthority", "deploymentAuthority", "paidFallbackAllowed"]) {
    if (policy[key] !== false) throw new Error(`dispatch policy authority must remain false: ${key}.`);
  }
  if (adapter.schemaVersion !== 1 || adapter.kind !== "evavo-codex-worker-adapter-v1") throw new Error("Codex worker adapter identity is invalid.");
  if (adapter.dispatch?.networkAccessExpected !== false || adapter.dispatch?.paidFallbackAllowed !== false || adapter.dispatch?.publicationAuthority !== false || adapter.dispatch?.validationAuthority !== false) {
    throw new Error("Codex worker adapter exceeds documentation-truth network, cost, publication or validation authority.");
  }
  integer(policy.maximumChangedLines, "policy maximumChangedLines", 1, 600);
  integer(policy.maximumChangedFiles, "policy maximumChangedFiles", 1, 1);
  integer(policy.maximumAutomaticAttempts, "policy maximumAutomaticAttempts", 1, 1);
  integer(policy.maximumPromptBytes, "policy maximumPromptBytes", 1024, 131072);
  if (!Array.isArray(policy.resultStates) || policy.resultStates.length < 1 || !Array.isArray(policy.resultFields) || policy.resultFields.length < 2) {
    throw new Error("documentation-truth result contract is incomplete.");
  }

  const workSource = readJsonBytes(workInput, "leased documentation-truth work item");
  const routeSource = readJsonBytes(routeInput, "documentation-truth route plan");
  const capabilitySource = readJsonBytes(capabilityInput, "Codex capability receipt");
  const candidateSource = readJsonBytes(candidateInput, "candidate worktree receipt");
  const work = workSource.document;
  const route = routeSource.document;
  const capability = capabilitySource.document;
  const candidate = candidateSource.document;
  const now = nowInput ? parseTime(nowInput, "--now") : Date.now();

  if (work.schemaVersion !== 1 || work.kind !== "evavo-autonomous-improvement-work-item-v1" || work.lifecycleState !== "LEASED") throw new Error("work item must be an autonomous LEASED record.");
  if (work.workerClass !== policy.workerClass || work.workClass !== policy.workClass || work.category !== policy.category) throw new Error("work item is not admitted documentation-truth maintenance.");
  if (!OBJECT(work.lease) || work.lease.schemaVersion !== 2 || work.lease.kind !== "evavo-autonomous-work-exchange-lease-v2" || work.lease.workerId !== workerId || work.lease.workerClass !== policy.workerClass) {
    throw new Error("work-item lease does not belong to this documentation-truth worker or is not the route-bound v2 lease.");
  }
  const leaseExpiresAt = parseTime(work.lease.expiresAt, "work-item lease expiry");
  if (leaseExpiresAt <= now) throw new Error("work-item lease is expired.");
  if (work.capacityClass !== policy.capacityClass || work.paidFallbackAllowed !== false) throw new Error("work item must remain included-consumer with paid fallback disabled.");
  const repository = string(work.repository, "repository", 160);
  const sourceRevision = exactSha(work.sourceRevision, "sourceRevision", SHA1);
  const workItemId = string(work.id, "work item id", 256);
  const objective = string(work.objective, "objective", 16_384);
  if (work.documentationMetadataMutationAllowed !== true || work.productionSourceMutationAllowed !== false) throw new Error("documentation-truth metadata/source authority is invalid.");
  for (const key of ["dependencyChangeAllowed", "schemaChangeAllowed", "publicApiChangeAllowed", "workerMayCommit", "workerMayPush", "workerMayPublish"]) {
    if (work[key] !== false) throw new Error(`documentation-truth ${key} must remain false.`);
  }
  const allowedPaths = arrayOfStrings(work.allowedPaths, "allowedPaths", 1, 2).map((value) => safePath(value, "allowed path"));
  if (allowedPaths.some((value) => !policy.canonicalAllowedPaths.includes(value))) throw new Error("documentation-truth may target only canonical capability manifest paths.");
  if (work.maximumChangedFiles !== policy.maximumChangedFiles || integer(work.maximumChangedLines, "maximumChangedLines", 1, policy.maximumChangedLines) > policy.maximumChangedLines || work.maximumAutomaticAttempts !== policy.maximumAutomaticAttempts || work.requiresCurrentHeadMatch !== true || work.noActionAccepted !== true) {
    throw new Error("documentation-truth mutation, retry, head or NO_ACTION bounds are invalid.");
  }

  if (route.schemaVersion !== 1 || route.kind !== "evavo-worker-route-plan-v1" || route.eligible !== true || route.decision !== "DISPATCH_ELIGIBLE") throw new Error("route plan is not dispatch eligible.");
  const routePlanSha256 = exactSha(route.routePlanSha256, "route plan SHA-256");
  if (bodySha(route, "routePlanSha256") !== routePlanSha256) throw new Error("route plan canonical SHA-256 is invalid.");
  if (route.workerClass !== policy.workerClass || route.repository !== repository || route.sourceRevision !== sourceRevision) throw new Error("route plan identity differs from leased documentation-truth work.");
  if (route.routeId !== policy.routeId || route.routeId !== adapter.spark?.routeId || route.modelPreference !== policy.modelPreference || route.modelPreference !== adapter.spark?.preferredModel) throw new Error("route/model differs from documentation-truth policy or adapter.");
  if (route.capacityClass !== policy.capacityClass || route.paidFallbackUsed !== false || route.maximumConcurrency !== 1 || route.maximumAutomaticConcurrency !== 1) throw new Error("route capacity, concurrency or paid-fallback posture is invalid.");
  if (route.executionPerformed !== false || route.validationPerformed !== false || route.publicationPerformed !== false) throw new Error("route plan exceeds planning-only authority.");
  const routeObserved = parseTime(route.routeAdmissionObservedAt, "route admission observedAt");
  const routeExpires = parseTime(route.routeAdmissionExpiresAt, "route admission expiresAt");
  if (routeObserved - now > 120_000 || now - routeObserved > 600_000 || routeExpires <= now) throw new Error("route admission is stale, future-dated or expired.");
  if (routeExpires - routeObserved > 600_000) throw new Error("route admission lifetime exceeds the bounded ten-minute policy.");
  if (leaseExpiresAt > routeExpires) throw new Error("work-item lease outlives route admission.");
  for (const key of ["routeAdmissionSha256", "supervisedAcceptanceSha256", "capabilityReceiptSha256", "capacityObservationSha256", "acceptanceVerificationSha256", "capacityStatusSha256"]) exactSha(route[key], key);
  for (const key of ["routeAdmissionSha256", "supervisedAcceptanceSha256", "capabilityReceiptSha256", "capacityObservationSha256", "acceptanceVerificationSha256", "capacityStatusSha256", "routePlanSha256"]) {
    exactSha(work.lease[key], `lease ${key}`);
    if (work.lease[key] !== route[key]) throw new Error(`lease/route ${key} continuity failed.`);
  }
  if (work.lease.routeId !== route.routeId || work.lease.runtime !== route.runtime || work.lease.modelPreference !== route.modelPreference) {
    throw new Error("lease/route runtime identity continuity failed.");
  }
  if (work.lease.routeAdmissionObservedAt !== route.routeAdmissionObservedAt || work.lease.routeAdmissionExpiresAt !== route.routeAdmissionExpiresAt) {
    throw new Error("lease/route admission timestamp continuity failed.");
  }

  if (capability.schemaVersion !== 1 || capability.kind !== "evavo-codex-worker-capability-probe-v1" || capability.eligibleForWorkerDispatch !== true) throw new Error("fresh eligible Codex capability receipt is required.");
  if (capabilitySource.sha256 !== route.capabilityReceiptSha256) throw new Error("capability receipt bytes differ from the route admission.");
  const capabilityObserved = parseTime(capability.observedAt, "capability observedAt");
  if (capabilityObserved - now > 120_000 || now - capabilityObserved > 600_000) throw new Error("capability receipt is stale or future-dated.");
  for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) if (typeof capability.capabilities?.[key] !== "string" || !capability.capabilities[key]) throw new Error(`capability receipt lacks ${key}.`);

  if (candidate.schemaVersion !== 1 || candidate.kind !== "evavo-autonomous-candidate-worktree-v1" || candidate.workItemId !== workItemId || candidate.sourceRevision !== sourceRevision) throw new Error("candidate worktree receipt does not match the leased item.");
  if (candidate.candidate?.contract !== "evavo_mainline_candidate_worktree_v1") throw new Error("candidate worktree contract is invalid.");
  const candidatePath = fs.realpathSync.native(path.resolve(string(candidate.candidate.path, "candidate path", 4096)));
  const candidateStat = fs.lstatSync(candidatePath);
  if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) throw new Error("candidate path must be a real non-symlink directory.");

  const allowed = allowedPaths.map((value) => `- ${value}`).join("\n");
  const evidence = OBJECT(work.origin)
    ? Object.entries(work.origin).filter(([key, value]) => key.endsWith("Sha256") && SHA256.test(String(value))).map(([key, value]) => `- ${key}: ${value}`).join("\n")
    : "- no admitted evidence digest";
  const resultShape = JSON.stringify(Object.fromEntries(policy.resultFields.map((field) => [field, field === "resultState" ? "SUCCESS|NO_ACTION|BLOCKED|NEEDS_DEEP_WORKER|NEEDS_HUMAN" : []])));
  const prompt = `You are the EVAVO Documentation Truth worker. Complete exactly one bounded capability-manifest maintenance job.\n\nRepository: ${repository}\nExact source revision: ${sourceRevision}\nObjective: ${objective}\n\nAllowed paths (change at most one):\n${allowed}\n\nImmutable evidence digests:\n${evidence}\n\nRules:\n- Inspect the current repository and declare only reusable capabilities it actually owns.\n- Prefer NO_ACTION when the existing manifest is already truthful or the repository does not own a reusable capability.\n- Preserve the existing evavo_repository_capabilities_v1 contract and do not invent runtime readiness, authorization, publication, financial, deployment, communication or machine-control authority.\n- Do not edit production source, dependencies, schemas, public APIs, creative assets, brand, story, art direction or owner-authored copy.\n- Do not commit, push, publish, deploy, install dependencies, use the network or change Git metadata.\n- Change at most one canonical capability-manifest file and no more than ${policy.maximumChangedLines} lines.\n- Do not claim deterministic validation passed; a separate validator owns that decision.\n- If evidence is insufficient or the current HEAD differs from the admitted source, return BLOCKED or NEEDS_HUMAN rather than guessing.\n\nReturn JSON only with exactly this shape and no Markdown fence:\n${resultShape}\nUse empty arrays when a list has no entries.\n`;
  if (Buffer.byteLength(prompt, "utf8") > policy.maximumPromptBytes) throw new Error("compiled documentation-truth prompt exceeds its bounded size.");

  const argv = ["exec", capability.capabilities.jsonFlag, capability.capabilities.modelFlag, route.modelPreference, capability.capabilities.sandboxFlag, adapter.dispatch.sandboxMode, capability.capabilities.approvalFlag, adapter.dispatch.approvalPolicy, "-"];
  const planBody = {
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-dispatch-plan-v1",
    eligible: true,
    workerId,
    workItemId,
    workerClass: policy.workerClass,
    workClass: policy.workClass,
    category: policy.category,
    repository,
    sourceRevision,
    workItemSha256: workSource.sha256,
    leasePlanSha256: exactSha(work.lease.planSha256, "lease plan SHA-256"),
    leaseExpiresAt: work.lease.expiresAt,
    routeId: route.routeId,
    runtime: route.runtime,
    modelPreference: route.modelPreference,
    capacityClass: route.capacityClass,
    maximumConcurrency: 1,
    routePlanSha256,
    routePlanBytesSha256: routeSource.sha256,
    routeAdmissionSha256: route.routeAdmissionSha256,
    routeAdmissionObservedAt: route.routeAdmissionObservedAt,
    routeAdmissionExpiresAt: route.routeAdmissionExpiresAt,
    supervisedAcceptanceSha256: route.supervisedAcceptanceSha256,
    capabilityReceiptSha256: route.capabilityReceiptSha256,
    capacityObservationSha256: route.capacityObservationSha256,
    acceptanceVerificationSha256: route.acceptanceVerificationSha256,
    capacityStatusSha256: route.capacityStatusSha256,
    candidateReceiptSha256: candidateSource.sha256,
    candidateContract: candidate.candidate.contract,
    candidateTreeSha: candidate.sourceTreeSha ?? null,
    executable: adapter.executable,
    argv,
    stdinPrompt: prompt,
    workingDirectory: candidatePath,
    allowedPaths,
    maximumChangedFiles: 1,
    maximumChangedLines: policy.maximumChangedLines,
    maximumAutomaticAttempts: 1,
    sandboxMode: adapter.dispatch.sandboxMode,
    approvalPolicy: adapter.dispatch.approvalPolicy,
    networkAccessExpected: false,
    apiKeyEnvironmentVariablesMustBeRemoved: adapter.dispatch.apiKeyEnvironmentVariablesMustBeRemoved,
    structuredOutputRequired: true,
    resultFields: policy.resultFields,
    physicalDocumentationTruthAcceptanceRequired: true,
    modelTurnPerformed: false,
    candidateWorktreeMutationPerformed: false,
    primaryRepositoryMutationPerformed: false,
    deterministicValidationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    paidFallbackUsed: false,
    truthBoundary: policy.truthBoundary
  };
  process.stdout.write(`${JSON.stringify({ ...planBody, dispatchPlanSha256: sha256(canonicalJson(planBody)) }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "evavo-codex-documentation-truth-dispatch-plan-v1",
    eligible: false,
    errors: [safeError(error?.message ?? error)],
    modelTurnPerformed: false,
    candidateWorktreeMutationPerformed: false,
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
