import { createHash } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isSha256 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const FUTURE_TOLERANCE_MS = 120_000;

function requireBuffer(value, label) {
  if (!Buffer.isBuffer(value) || value.length < 2) throw new Error(`${label} bytes are required.`);
}
function requireFresh(value, label, nowMs, maximumAgeSeconds) {
  const parsed = Date.parse(value ?? "");
  if (!Number.isFinite(parsed)) throw new Error(`${label} timestamp is invalid.`);
  if (parsed - nowMs > FUTURE_TOLERANCE_MS) throw new Error(`${label} timestamp is future-dated.`);
  if (nowMs - parsed > maximumAgeSeconds * 1000) throw new Error(`${label} is stale.`);
  return parsed;
}
function exactlyTestGeneration(value, label) {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== "test-generation") {
    throw new Error(`${label} must admit exactly test-generation.`);
  }
}

export function compileCodexSparkRouteAdmission({
  acceptanceBytes,
  capabilityBytes,
  authenticationBytes,
  physicalVerificationBytes,
  acceptance,
  capability,
  authentication,
  physicalVerification,
  baseVerification,
  nowMs = Date.now(),
  ttlSeconds = 600,
}) {
  requireBuffer(acceptanceBytes, "Supervised acceptance");
  requireBuffer(capabilityBytes, "Codex capability");
  requireBuffer(authenticationBytes, "ChatGPT authentication");
  requireBuffer(physicalVerificationBytes, "Physical verification");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 600) {
    throw new Error("Route-admission TTL must be an integer between 60 and 600 seconds.");
  }
  for (const [value, label] of [
    [acceptance, "Supervised acceptance"],
    [capability, "Codex capability"],
    [authentication, "ChatGPT authentication"],
    [physicalVerification, "Physical verification"],
    [baseVerification, "Base supervised verification"],
  ]) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  }

  if (acceptance.schemaVersion !== 1 || acceptance.kind !== "evavo-codex-spark-safe-physical-acceptance-v1") {
    throw new Error("Supervised acceptance kind/schema is invalid.");
  }
  const supervision = acceptance.supervision;
  if (
    supervision?.cleanupComplete !== true ||
    supervision?.stagedAcceptancePromotedOnlyAfterCleanup !== true ||
    supervision?.fixtureRepositoryMainUnchanged !== true ||
    supervision?.fixtureRepositoryClean !== true ||
    supervision?.fixtureRepositoryRemoteCount !== 0 ||
    supervision?.registeredWorktreesAfterCleanup !== 1
  ) {
    throw new Error("Supervised acceptance lacks required cleanup and disposable-fixture truth.");
  }
  if (supervision?.publicationPerformed !== false || supervision?.productRepositoryTouched !== false) {
    throw new Error("Supervised acceptance exceeds fixture-only authority.");
  }
  requireFresh(acceptance.supervisedAt, "Supervised acceptance", nowMs, 7 * 24 * 60 * 60);

  if (capability.schemaVersion !== 1 || capability.kind !== "evavo-codex-worker-capability-probe-v1") {
    throw new Error("Codex capability kind/schema is invalid.");
  }
  if (capability.eligibleForWorkerDispatch !== true) throw new Error("Codex capability is not eligible for dispatch.");
  requireFresh(capability.observedAt, "Codex capability", nowMs, 600);
  for (const key of ["jsonFlag", "modelFlag", "sandboxFlag", "approvalFlag"]) {
    if (typeof capability.capabilities?.[key] !== "string" || !capability.capabilities[key]) {
      throw new Error(`Codex capability lacks ${key}.`);
    }
  }

  if (authentication.schemaVersion !== 1 || authentication.kind !== "evavo-codex-chatgpt-auth-observation-v1") {
    throw new Error("ChatGPT authentication observation kind/schema is invalid.");
  }
  if (
    authentication.accepted !== true ||
    authentication.authPolicyAccepted !== true ||
    authentication.authenticationClass !== "chatgpt-consumer" ||
    authentication.chatgptOnly !== true
  ) {
    throw new Error("ChatGPT-only consumer authentication is not accepted.");
  }
  if (
    authentication.apiKeyAllowed !== false ||
    authentication.apiLoginAllowed !== false ||
    authentication.mixedLoginAllowed !== false ||
    authentication.providerApiCredentialsRequired !== false ||
    authentication.credentialValuesRead !== false
  ) {
    throw new Error("Authentication observation permits API/mixed login or credential-value access.");
  }
  requireFresh(authentication.observedAt, "ChatGPT authentication observation", nowMs, 600);

  if (
    physicalVerification.schemaVersion !== 1 ||
    physicalVerification.kind !== "evavo-codex-spark-safe-physical-acceptance-verification-v1" ||
    physicalVerification.accepted !== true ||
    physicalVerification.supervisedCleanupProven !== true
  ) {
    throw new Error("Physical verification observation is not accepted.");
  }
  if (
    physicalVerification.routeId !== "codex-spark-pro" ||
    physicalVerification.modelPreference !== "gpt-5.3-codex-spark" ||
    physicalVerification.capacityClass !== "included-consumer"
  ) {
    throw new Error("Physical verification route/model/capacity class is invalid.");
  }
  exactlyTestGeneration(physicalVerification.workerClasses, "Physical verification worker classes");
  if (physicalVerification.maximumConcurrency !== 1) throw new Error("Physical verification must remain at concurrency one.");
  if (physicalVerification.paidFallbackAllowed !== false) throw new Error("Physical verification does not forbid paid fallback.");
  requireFresh(physicalVerification.observedAt, "Physical verification observation", nowMs, 600);

  if (
    baseVerification.schemaVersion !== 1 ||
    baseVerification.kind !== "evavo-codex-spark-safe-physical-acceptance-verification-v1" ||
    baseVerification.accepted !== true ||
    baseVerification.supervisedCleanupProven !== true
  ) {
    throw new Error("Fresh base supervised verification is not accepted.");
  }
  if (
    baseVerification.routeId !== "codex-spark-pro" ||
    baseVerification.modelPreference !== "gpt-5.3-codex-spark" ||
    baseVerification.paidFallbackAllowed !== false
  ) {
    throw new Error("Fresh base supervised verification route/model/billing boundary is invalid.");
  }
  exactlyTestGeneration(baseVerification.workerClasses, "Base verification worker classes");
  if (baseVerification.maximumConcurrency !== 1) throw new Error("Base verification must remain at concurrency one.");

  const supervisedAcceptanceSha256 = sha256(acceptanceBytes);
  const codexCapabilityReceiptSha256 = sha256(capabilityBytes);
  const chatgptAuthenticationReceiptSha256 = sha256(authenticationBytes);
  const physicalAcceptanceVerificationSha256 = sha256(physicalVerificationBytes);
  if (
    physicalVerification.supervisedAcceptanceSha256 !== supervisedAcceptanceSha256 ||
    physicalVerification.codexCapabilityReceiptSha256 !== codexCapabilityReceiptSha256
  ) {
    throw new Error("Physical verification observation is not bound to the exact acceptance and capability bytes.");
  }
  if (!isSha256(physicalVerification.baseVerificationSha256)) {
    throw new Error("Physical verification observation lacks its base-verification SHA-256.");
  }

  const admittedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlSeconds * 1000).toISOString();
  return {
    schemaVersion: 1,
    kind: "evavo-codex-spark-route-admission-v1",
    accepted: true,
    admitted: true,
    eligible: true,
    admittedAt,
    expiresAt,
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    authenticationClass: "chatgpt-consumer",
    workerClasses: ["test-generation"],
    admittedWorkerClasses: ["test-generation"],
    maximumConcurrency: 1,
    admittedMaximumConcurrency: 1,
    paidFallbackAllowed: false,
    paidFallbackUsed: false,
    supervisedAcceptanceSha256,
    codexCapabilityReceiptSha256,
    chatgptAuthenticationReceiptSha256,
    physicalAcceptanceVerificationSha256,
    basePhysicalVerificationSha256: physicalVerification.baseVerificationSha256,
    bindings: {
      supervisedAcceptanceSha256,
      codexCapabilityReceiptSha256,
      chatgptAuthenticationReceiptSha256,
      physicalAcceptanceVerificationSha256,
      basePhysicalVerificationSha256: physicalVerification.baseVerificationSha256,
    },
    capacityAvailabilityProven: false,
    accountUsageQueried: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
    physicalPathsReturned: false,
    truthBoundary:
      "This short-lived admission proves only that the currently verified ChatGPT-authenticated Spark Test Builder route may be considered at concurrency one. Raw Spark capacity remains a separate independently observed fact; no model turn, repository mutation, publication or paid fallback is authorized here.",
  };
}
