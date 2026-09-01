#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(
  ROOT,
  "config",
  "documentation-truth-supervised-activation-v2.json",
);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^EVAVO-STUDIO\/[A-Za-z0-9._-]{1,100}$/;
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:[\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^\u0000\r\n]{1,4096}$/;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const AUTHORITY_FALSE_FIELDS = Object.freeze([
  "leaseAcquired",
  "modelTurnPerformed",
  "repositoryMutationPerformed",
  "commitPerformed",
  "pushPerformed",
  "publicationPerformed",
  "deploymentPerformed",
  "financialActionPerformed",
  "paidFallbackUsed",
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function string(value, label, maximum = 4096) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    /[\u0000\r\n]/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty bounded string.`);
  }
  return value;
}

function sha(value, label, pattern = SHA256) {
  const selected = string(value, label, 64).toLowerCase();
  if (!pattern.test(selected)) throw new Error(`${label} is invalid.`);
  return selected;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeError(value) {
  let text = String(value ?? "activation compilation failed");
  text = text.replace(/\b[A-Za-z]:[\\/][^\r\n]*/g, "<windows-path>");
  text = text.replace(/(?<![A-Za-z0-9])\/(?:[^\s/:]+\/)+[^\s:]*/g, "<path>");
  text = text.replace(
    /(?:token|secret|password|authorization|credential)\s*[:=]\s*[^\s;]+/gi,
    "credential=<redacted>",
  );
  return text.slice(0, 1200);
}

function readJsonBytes(value, label, maximum = MAX_INPUT_BYTES) {
  const requested = string(value, `${label} path`);
  if (!SAFE_PATH.test(requested) && !path.isAbsolute(requested)) {
    throw new Error(`${label} path is unsafe.`);
  }
  const resolved = fs.realpathSync.native(path.resolve(requested));
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  const bytes = fs.readFileSync(resolved);
  if (bytes.length < 2 || bytes.length > maximum) {
    throw new Error(`${label} is outside its bounded byte limit.`);
  }
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
  return {
    path: resolved,
    bytes,
    sha256: sha256(bytes),
    document: object(document, label),
  };
}

function parseArguments(values) {
  const allowed = new Set([
    "--wave-manifest",
    "--wave-validation",
    "--repository-head",
    "--work-exchange-receipt",
    "--codex-capability",
    "--capacity-status",
    "--fixture-acceptance",
    "--candidate-validation",
    "--primary-attestation",
    "--now",
  ]);
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || !value || result.has(name)) {
      throw new Error("Activation compiler arguments are invalid or duplicated.");
    }
    result.set(name, value);
  }
  for (const name of [...allowed].filter((item) => item !== "--now")) {
    if (!result.has(name)) throw new Error(`Missing required argument ${name}.`);
  }
  return result;
}

function time(value, label) {
  const text = string(value, label, 64);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} is invalid.`);
  return milliseconds;
}

function timestampFrom(document, candidates, label) {
  for (const name of candidates) {
    if (typeof document[name] === "string") return time(document[name], `${label}.${name}`);
  }
  throw new Error(`${label} has no recognised observation timestamp.`);
}

function freshness({ observedAt, maximumAgeSeconds, now, label, blockers, rejected }) {
  if (observedAt - now > 120_000) {
    rejected.push(`${label} is future-dated.`);
    return;
  }
  if (now - observedAt > maximumAgeSeconds * 1000) {
    blockers.push(`${label} is stale.`);
  }
}

function noAuthority(document, label, rejected) {
  for (const field of AUTHORITY_FALSE_FIELDS) {
    if (document[field] === true) rejected.push(`${label} claims prohibited ${field}.`);
  }
}

function exactStringSet(value, expected) {
  if (!Array.isArray(value)) return false;
  const observed = [...new Set(value.filter((item) => typeof item === "string"))].sort();
  const required = [...expected].sort();
  return observed.length === required.length && observed.every((item, index) => item === required[index]);
}

function scenarioMap(document) {
  const raw = document.scenarios ?? document.fixtureScenarios ?? document.results;
  if (!Array.isArray(raw)) return new Map();
  return new Map(
    raw
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => [item.id ?? item.name ?? item.scenario, item]),
  );
}

function routeFromCapacity(document, routeId) {
  const routes = Array.isArray(document.routes) ? document.routes : [];
  return routes.find((item) => item?.routeId === routeId) ?? null;
}

function requireRepositoryAndSource(documents, rejected) {
  const repositories = new Set();
  const revisions = new Set();
  for (const [label, document] of documents) {
    const repository = document.repository ?? document.repositoryFullName;
    const revision = document.sourceRevision ?? document.headSha ?? document.sha;
    if (typeof repository === "string") repositories.add(repository);
    if (typeof revision === "string" && SHA1.test(revision.toLowerCase())) {
      revisions.add(revision.toLowerCase());
    }
    if (typeof repository === "string" && !REPOSITORY.test(repository)) {
      rejected.push(`${label} repository identity is invalid.`);
    }
  }
  if (repositories.size !== 1) {
    rejected.push("Repository identity is missing or differs across activation evidence.");
  }
  if (revisions.size !== 1) {
    rejected.push("Exact source revision is missing or differs across activation evidence.");
  }
  return {
    repository: repositories.size === 1 ? [...repositories][0] : null,
    sourceRevision: revisions.size === 1 ? [...revisions][0] : null,
  };
}

try {
  const args = parseArguments(process.argv.slice(2));
  const policyEvidence = readJsonBytes(POLICY_PATH, "activation policy", 2 * 1024 * 1024);
  const policy = policyEvidence.document;
  if (
    policy.schemaVersion !== 2 ||
    policy.kind !== "evavo-documentation-truth-supervised-activation-policy-v2" ||
    policy.owner !== "EVAVO-STUDIO/evavo-agent-infrastructure"
  ) {
    throw new Error("Documentation-truth activation policy identity is invalid.");
  }
  if (
    policy.workerClass !== "documentation-truth" ||
    policy.workClass !== "capability-manifest-maintenance" ||
    policy.capacityClass !== "included-consumer" ||
    policy.maximumConcurrency !== 1 ||
    policy.maximumAutomaticAttempts !== 1 ||
    policy.maximumChangedFiles !== 1 ||
    policy.maximumChangedLines !== 600 ||
    policy.activation?.automaticallyChangesConfiguration !== false ||
    policy.activation?.automaticallyAcquiresLease !== false ||
    policy.activation?.automaticallyStartsModel !== false ||
    policy.activation?.automaticallyCommits !== false ||
    policy.activation?.automaticallyPushes !== false ||
    policy.activation?.automaticallyPublishes !== false
  ) {
    throw new Error("Documentation-truth activation policy widens its bounded authority.");
  }

  const evidence = {
    waveManifest: readJsonBytes(args.get("--wave-manifest"), "sealed wave manifest"),
    waveValidation: readJsonBytes(args.get("--wave-validation"), "sealed wave validation receipt"),
    repositoryHead: readJsonBytes(args.get("--repository-head"), "repository head observation"),
    workExchange: readJsonBytes(args.get("--work-exchange-receipt"), "Work Exchange deployment receipt"),
    capability: readJsonBytes(args.get("--codex-capability"), "Codex capability receipt"),
    capacity: readJsonBytes(args.get("--capacity-status"), "canonical capacity status"),
    fixture: readJsonBytes(args.get("--fixture-acceptance"), "supervised fixture acceptance"),
    validation: readJsonBytes(args.get("--candidate-validation"), "candidate validation receipt"),
    primary: readJsonBytes(args.get("--primary-attestation"), "primary checkout attestation"),
  };
  const nowValue = args.get("--now");
  const nowDate = nowValue ? new Date(nowValue) : new Date();
  if (!Number.isFinite(nowDate.getTime())) throw new Error("--now is invalid.");
  const now = nowDate.getTime();
  const blockers = [];
  const rejected = [];

  for (const [label, item] of Object.entries(evidence)) {
    noAuthority(item.document, label, rejected);
  }

  const waveManifest = evidence.waveManifest.document;
  const waveValidation = evidence.waveValidation.document;
  if (
    waveManifest.kind !== "evavo-autonomous-lease-wave-manifest-v1" &&
    waveManifest.kind !== "evavo-autonomous-lease-wave-manifest-v2"
  ) {
    rejected.push("Sealed wave manifest kind is not recognised.");
  }
  if (waveValidation.ok !== true && waveValidation.passed !== true) {
    rejected.push("Sealed wave validation did not pass.");
  }
  if (waveValidation.packageVerified === false) {
    rejected.push("Sealed wave package checksum verification failed.");
  }
  freshness({
    observedAt: timestampFrom(
      waveValidation,
      ["completedAt", "validatedAt", "observedAt"],
      "wave validation",
    ),
    maximumAgeSeconds: policy.maximumEvidenceAgeSeconds.packageValidation,
    now,
    label: "Sealed wave validation",
    blockers,
    rejected,
  });

  const head = evidence.repositoryHead.document;
  const headSha = String(head.sha ?? head.headSha ?? head.sourceRevision ?? "").toLowerCase();
  if (!SHA1.test(headSha)) rejected.push("Repository head observation lacks an exact commit SHA.");
  if ((head.ref ?? head.branch ?? head.defaultBranch) !== "main") {
    rejected.push("Repository head observation is not bound to main.");
  }
  if (head.trusted === false || head.readOnly === false) {
    rejected.push("Repository head observation is not trusted read-only evidence.");
  }
  freshness({
    observedAt: timestampFrom(head, ["observedAt", "recordedAt", "createdAt"], "repository head"),
    maximumAgeSeconds: policy.maximumEvidenceAgeSeconds.repositoryHead,
    now,
    label: "Repository head observation",
    blockers,
    rejected,
  });

  const workExchange = evidence.workExchange.document;
  const workExchangeDecision = workExchange.decision ?? workExchange.result ?? null;
  const workExchangeOk =
    workExchange.ok === true ||
    ["COMMITTED_TO_MAIN", "ALREADY_CURRENT", "ENQUEUED", "IDEMPOTENT_REPLAY"].includes(
      workExchangeDecision,
    );
  if (!workExchangeOk) blockers.push("Canonical Work Exchange deployment/effect is not positively reconciled.");
  if (workExchange.forcePushPerformed === true || workExchange.githubActionsDispatched === true) {
    rejected.push("Work Exchange evidence contains a prohibited force-push or Actions dispatch.");
  }
  freshness({
    observedAt: timestampFrom(
      workExchange,
      ["completedAt", "observedAt", "createdAt"],
      "Work Exchange receipt",
    ),
    maximumAgeSeconds: policy.maximumEvidenceAgeSeconds.workExchangeEffect,
    now,
    label: "Work Exchange receipt",
    blockers,
    rejected,
  });

  const capability = evidence.capability.document;
  if (
    capability.schemaVersion !== 1 ||
    capability.kind !== "evavo-codex-worker-capability-probe-v1" ||
    capability.eligibleForWorkerDispatch !== true
  ) {
    blockers.push("Fresh Codex capability receipt is not dispatch eligible.");
  }
  for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
    if (typeof capability.capabilities?.[key] !== "string" || !capability.capabilities[key]) {
      blockers.push(`Codex capability receipt lacks ${key}.`);
    }
  }
  freshness({
    observedAt: timestampFrom(capability, ["observedAt"], "Codex capability"),
    maximumAgeSeconds: policy.maximumEvidenceAgeSeconds.codexCapability,
    now,
    label: "Codex capability receipt",
    blockers,
    rejected,
  });

  const capacity = evidence.capacity.document;
  if (capacity.schemaVersion !== 1 || capacity.kind !== "evavo-worker-capacity-status-v1") {
    rejected.push("Canonical capacity status kind/schema is invalid.");
  }
  const route = routeFromCapacity(capacity, policy.routeId);
  if (!route) {
    blockers.push("Canonical capacity status has no documentation-truth route.");
  } else {
    if (route.modelPreference !== policy.modelPreference) {
      rejected.push("Capacity route model differs from activation policy.");
    }
    if (route.capacityClass !== policy.capacityClass || route.paidFallbackAllowed !== false) {
      rejected.push("Capacity route billing class differs from zero-paid-fallback policy.");
    }
    if (
      route.dispatchEligible !== true ||
      route.maximumConcurrency !== 1 ||
      !Array.isArray(route.admittedWorkerClasses) ||
      !route.admittedWorkerClasses.includes(policy.workerClass)
    ) {
      blockers.push("Documentation-truth is not currently admitted at concurrency one.");
    }
  }
  freshness({
    observedAt: timestampFrom(capacity, ["observedAt"], "capacity status"),
    maximumAgeSeconds: policy.maximumEvidenceAgeSeconds.capacityStatus,
    now,
    label: "Canonical capacity status",
    blockers,
    rejected,
  });

  const fixture = evidence.fixture.document;
  if (
    fixture.schemaVersion !== 2 ||
    fixture.kind !== "evavo-documentation-truth-supervised-fixture-acceptance-v2" ||
    fixture.accepted !== true ||
    fixture.supervised === false
  ) {
    blockers.push("Supervised documentation-truth fixture acceptance is not positive.");
  }
  if (
    fixture.maximumConcurrency !== 1 ||
    fixture.maximumAutomaticAttempts !== 1 ||
    fixture.workerClass !== policy.workerClass ||
    fixture.workClass !== policy.workClass ||
    fixture.paidFallbackUsed !== false ||
    fixture.workerCommitPerformed !== false ||
    fixture.workerPushPerformed !== false ||
    fixture.publicationPerformed !== false
  ) {
    rejected.push("Supervised fixture acceptance widens the documentation-truth boundary.");
  }
  const scenarios = scenarioMap(fixture);
  for (const scenario of policy.requiredFixtureScenarios) {
    const result = scenarios.get(scenario);
    if (!result || result.passed !== true || !SHA256.test(String(result.receiptSha256 ?? ""))) {
      blockers.push(`Required supervised fixture scenario did not pass: ${scenario}.`);
    }
  }
  freshness({
    observedAt: timestampFrom(
      fixture,
      ["acceptedAt", "completedAt", "observedAt"],
      "fixture acceptance",
    ),
    maximumAgeSeconds: policy.maximumEvidenceAgeSeconds.supervisedFixtureAcceptance,
    now,
    label: "Supervised fixture acceptance",
    blockers,
    rejected,
  });

  const validation = evidence.validation.document;
  if (
    ![
      "evavo-documentation-truth-candidate-validation-v1",
      "evavo-documentation-truth-candidate-validation-v2",
    ].includes(validation.kind) ||
    !["VALIDATED_SUCCESS", "VALIDATED_NO_ACTION"].includes(validation.decision)
  ) {
    blockers.push("Independent candidate validation is not successful or NO_ACTION.");
  }
  if (validation.independent !== true && validation.candidateValidationIndependent !== true) {
    rejected.push("Candidate validation is not explicitly independent of the model session.");
  }
  if (
    validation.changedFiles !== undefined &&
    (!Number.isInteger(validation.changedFiles) || validation.changedFiles < 0 || validation.changedFiles > 1)
  ) {
    rejected.push("Candidate validation reports more than one changed file.");
  }
  if (
    validation.changedLines !== undefined &&
    (!Number.isInteger(validation.changedLines) || validation.changedLines < 0 || validation.changedLines > 600)
  ) {
    rejected.push("Candidate validation reports more than 600 changed lines.");
  }

  const primary = evidence.primary.document;
  if (
    primary.primaryCheckoutUnchanged !== true ||
    primary.primaryCheckoutClean !== true ||
    primary.branch !== "main"
  ) {
    rejected.push("Primary checkout attestation does not prove clean unchanged main.");
  }

  const identity = requireRepositoryAndSource(
    [
      ["repositoryHead", head],
      ["workExchange", workExchange],
      ["fixture", fixture],
      ["validation", validation],
      ["primary", primary],
    ],
    rejected,
  );
  if (identity.sourceRevision && headSha && identity.sourceRevision !== headSha) {
    rejected.push("Repository head SHA differs from the evidence source revision.");
  }

  const decision = rejected.length > 0
    ? "REJECTED"
    : blockers.length > 0
      ? "RETAIN_READY"
      : "ACTIVATE_ELIGIBLE";
  const body = {
    schemaVersion: 2,
    kind: "evavo-documentation-truth-supervised-activation-decision-v2",
    decision,
    eligible: decision === "ACTIVATE_ELIGIBLE",
    repository: identity.repository,
    sourceRevision: identity.sourceRevision,
    routeId: policy.routeId,
    modelPreference: policy.modelPreference,
    capacityClass: policy.capacityClass,
    workerClass: policy.workerClass,
    workClass: policy.workClass,
    maximumConcurrency: 1,
    maximumAutomaticAttempts: 1,
    allowedPaths: [...policy.allowedPaths],
    maximumChangedFiles: 1,
    maximumChangedLines: 600,
    observedAt: nowDate.toISOString(),
    expiresAt: new Date(now + policy.maximumEvidenceAgeSeconds.activationDecision * 1000).toISOString(),
    blockers: [...new Set(blockers)].sort(),
    rejections: [...new Set(rejected)].sort(),
    evidence: Object.fromEntries(
      Object.entries(evidence).map(([name, item]) => [name, {
        sha256: item.sha256,
        byteLength: item.bytes.length,
      }]),
    ),
    activationPolicySha256: policyEvidence.sha256,
    configurationMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
    truthBoundary: policy.truthBoundary,
  };
  process.stdout.write(`${JSON.stringify({
    ...body,
    activationDecisionSha256: sha256(Buffer.from(canonical(body), "utf8")),
  }, null, 2)}\n`);
  process.exitCode = decision === "REJECTED" ? 1 : 0;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 2,
    kind: "evavo-documentation-truth-supervised-activation-error-v2",
    eligible: false,
    decision: "REJECTED",
    errorType: error?.constructor?.name ?? "Error",
    errorMessage: safeError(error?.message ?? error),
    configurationMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
