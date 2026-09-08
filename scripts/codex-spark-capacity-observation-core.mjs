#!/usr/bin/env node

const STATES = new Set([
  "AVAILABLE",
  "DEGRADED",
  "RATE_LIMITED",
  "EXHAUSTED",
  "AUTH_REQUIRED",
  "OFFLINE",
  "UNKNOWN",
]);

const RATE_LIMIT = /(?:rate[ -]?limit|too many requests|retry[- ]after|http\s*429|status\s*429)/i;
const EXHAUSTED = /(?:usage limit|quota (?:is )?exhausted|quota exceeded|allowance exhausted|capacity exhausted|weekly limit|monthly limit)/i;
const AUTH = /(?:auth(?:entication|orization)? required|not logged in|login required|sign in|unauthorized|forbidden|invalid credential|http\s*401|status\s*401)/i;
const OFFLINE = /(?:enoent|executable not found|command not found|could not resolve host|dns|network is unreachable|connection refused|offline)/i;
const CLASSIFIER_KINDS = new Set([
  "evavo-codex-worker-result-classification-v1",
  "evavo-codex-worker-result-classification-v2",
]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return value;
}

function text(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function observedAt(source) {
  const candidate = source.observedAt ?? source.finishedAt ?? source.completedAt ?? source.recordedAt;
  if (typeof candidate !== "string" || !Number.isFinite(Date.parse(candidate))) {
    throw new TypeError("Capacity source must provide a valid observedAt, finishedAt, completedAt, or recordedAt timestamp.");
  }
  return new Date(candidate).toISOString();
}

function explicitState(source) {
  const values = [
    source.capacityState,
    source.state,
    source.classification?.capacityState,
    source.classification?.state,
    source.result?.capacityState,
  ];
  for (const value of values) {
    if (typeof value === "string" && STATES.has(value.toUpperCase())) return value.toUpperCase();
  }
  return null;
}

function diagnosticText(source) {
  return [
    source.error,
    source.errorMessage,
    source.message,
    source.reason,
    source.stderr?.text,
    source.stdout?.text,
    source.jsonl?.finalAgentMessage?.text,
    source.classification,
    source.result,
  ]
    .map(text)
    .filter(Boolean)
    .join("\n")
    .slice(0, 256 * 1024);
}

function completionEvidence(source) {
  if (source.kind === "evavo-codex-worker-run-v1") {
    return {
      recognized: true,
      verified:
        Number.isInteger(source.exitCode) &&
        source.exitCode === 0 &&
        source.modelTurnCompleted === true &&
        source.structuredTurnCompleted === true,
    };
  }
  if (CLASSIFIER_KINDS.has(source.kind)) {
    return {
      recognized: true,
      verified:
        Number.isInteger(source.sourceExitCode) &&
        source.sourceExitCode === 0 &&
        source.structuredTurnCompleted === true &&
        source.completionEvidenceConsistent !== false,
    };
  }
  return { recognized: false, verified: false };
}

export function classifyCodexSparkCapacityObservation(input) {
  object(input, "Capacity observation input");
  const source = object(input.source, "Capacity observation source");
  if (source.paidFallbackUsed === true) {
    throw new TypeError("A paid-fallback result cannot become a Spark included-capacity observation.");
  }
  const at = observedAt(source);
  const explicit = explicitState(source);
  const diagnostic = diagnosticText(source);
  const completion = completionEvidence(source);
  const contradictoryAvailableClaim = completion.recognized && explicit === "AVAILABLE" && !completion.verified;
  let state = null;
  let reason = null;

  // Exit-code-backed completion outranks incidental diagnostic text and stale
  // classifier labels. This also repairs old v1 classifier receipts whose text
  // matcher could label a successful model turn as exhausted or rate-limited.
  if (completion.verified) {
    state = "AVAILABLE";
    reason = "VERIFIED_STRUCTURED_TURN_COMPLETED";
  } else if (explicit && !contradictoryAvailableClaim) {
    state = explicit;
    reason = "EXPLICIT_CAPACITY_CLASSIFICATION";
  }
  if (!state && EXHAUSTED.test(diagnostic)) {
    state = "EXHAUSTED";
    reason = "USAGE_ALLOWANCE_EXHAUSTED_OBSERVED";
  }
  if (!state && RATE_LIMIT.test(diagnostic)) {
    state = "RATE_LIMITED";
    reason = "RATE_LIMIT_OBSERVED";
  }
  if (!state && AUTH.test(diagnostic)) {
    state = "AUTH_REQUIRED";
    reason = "AUTHENTICATION_FAILURE_OBSERVED";
  }
  if (!state && OFFLINE.test(diagnostic)) {
    state = "OFFLINE";
    reason = "TRANSPORT_OR_EXECUTABLE_FAILURE_OBSERVED";
  }
  if (!state && contradictoryAvailableClaim) {
    state = "DEGRADED";
    reason = "CONTRADICTORY_AVAILABLE_COMPLETION_EVIDENCE";
  }
  if (!state && source.kind === "evavo-codex-worker-run-v1") {
    state = "DEGRADED";
    reason = "UNCLASSIFIED_CODEX_RUN_FAILURE";
  }
  if (!state && CLASSIFIER_KINDS.has(source.kind)) {
    state = "DEGRADED";
    reason = "UNCLASSIFIED_CODEX_CLASSIFICATION_FAILURE";
  }
  if (!state) {
    state = "UNKNOWN";
    reason = "NO_CAPACITY_OUTCOME_OBSERVED";
  }

  const maximumConcurrency = Number.isInteger(source.maximumConcurrency) && source.maximumConcurrency >= 1
    ? Math.min(source.maximumConcurrency, 4)
    : 1;

  return {
    schemaVersion: 1,
    kind: "evavo-codex-spark-capacity-observation-v1",
    routeId: "codex-spark-pro",
    state,
    observedAt: at,
    sourceKind: typeof source.kind === "string" ? source.kind : "unknown",
    sourceSha256: input.sourceSha256,
    reason,
    maximumConcurrency,
    completionEvidenceRecognized: completion.recognized,
    completionEvidenceVerified: completion.verified,
    contradictoryAvailableClaimRejected: contradictoryAvailableClaim,
    paidFallbackUsed: false,
    modelTurnPerformedByClassifier: false,
    accountUsageScraped: false,
    capacityInferredFromInstallationOnly: false,
    capacityInferredFromAuthenticationOnly: false,
    credentialValuesReturned: false,
    diagnosticTextReturned: false,
    truthBoundary:
      "This observation classifies an already-observed Codex result. AVAILABLE from a raw run or worker-result classifier requires coherent zero-exit structured completion evidence; incidental error-like text cannot override verified completion and a contradictory AVAILABLE claim is rejected. It does not scrape account usage, start a probe model turn, treat CLI installation/authentication as capacity, expose diagnostic text or authorize dispatch.",
  };
}

export const CODEX_SPARK_CAPACITY_STATES = Object.freeze([...STATES]);
