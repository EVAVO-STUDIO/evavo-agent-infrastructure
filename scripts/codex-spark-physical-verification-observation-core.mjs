import { createHash } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};

export function compilePhysicalVerificationObservation({ acceptanceBytes, capabilityBytes, verification }) {
  if (!Buffer.isBuffer(acceptanceBytes) || acceptanceBytes.length < 2) throw new Error("Supervised acceptance bytes are required.");
  if (!Buffer.isBuffer(capabilityBytes) || capabilityBytes.length < 2) throw new Error("Codex capability bytes are required.");
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) throw new Error("Base physical verification must be an object.");
  if (verification.schemaVersion !== 1 || verification.kind !== "evavo-codex-spark-safe-physical-acceptance-verification-v1") {
    throw new Error("Base physical verification kind/schema is invalid.");
  }
  if (verification.accepted !== true || verification.supervisedCleanupProven !== true) {
    throw new Error("Base physical verification is not accepted with supervised cleanup.");
  }
  if (verification.routeId !== "codex-spark-pro" || verification.modelPreference !== "gpt-5.3-codex-spark") {
    throw new Error("Base physical verification route/model is invalid.");
  }
  if (verification.paidFallbackAllowed !== false) throw new Error("Base physical verification does not forbid paid fallback.");
  if (!Array.isArray(verification.workerClasses) || verification.workerClasses.length !== 1 || verification.workerClasses[0] !== "test-generation") {
    throw new Error("Base physical verification exceeds the initial Test Builder worker-class boundary.");
  }
  if (verification.maximumConcurrency !== 1) throw new Error("Base physical verification exceeds concurrency one.");
  if (Array.isArray(verification.errors) && verification.errors.length > 0) throw new Error("Accepted base physical verification unexpectedly contains errors.");

  const baseVerificationSha256 = sha256(Buffer.from(JSON.stringify(canonical(verification)), "utf8"));
  return {
    schemaVersion: 1,
    kind: "evavo-codex-spark-safe-physical-acceptance-verification-v1",
    accepted: true,
    observedAt: new Date().toISOString(),
    routeId: "codex-spark-pro",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    workerClasses: ["test-generation"],
    maximumConcurrency: 1,
    paidFallbackAllowed: false,
    supervisedCleanupProven: true,
    supervisedAcceptanceSha256: sha256(acceptanceBytes),
    codexCapabilityReceiptSha256: sha256(capabilityBytes),
    baseVerificationSha256,
    baseVerificationKind: verification.kind,
    codexVersion: verification.codexVersion ?? null,
    sandboxMode: verification.sandboxMode ?? "workspace-write",
    approvalPolicy: verification.approvalPolicy ?? "never",
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    publicationPerformed: false,
    physicalPathsReturned: false,
    truthBoundary:
      "This fresh observation is emitted only from an accepted supervised physical-verification result and binds the exact supervised acceptance and Codex capability bytes. It starts no model turn and grants only Test Builder at concurrency one.",
  };
}
