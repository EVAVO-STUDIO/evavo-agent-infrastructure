#!/usr/bin/env node

import assert from "node:assert/strict";
import { classifyCodexSparkCapacityObservation } from "./codex-spark-capacity-observation-core.mjs";

const sourceSha256 = "a".repeat(64);
const classify = (source) => classifyCodexSparkCapacityObservation({ source, sourceSha256 });

{
  const result = classify({
    kind: "evavo-codex-worker-run-v1",
    finishedAt: "2026-09-01T08:00:00.000Z",
    exitCode: 0,
    modelTurnCompleted: true,
    structuredTurnCompleted: true,
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "AVAILABLE");
  assert.equal(result.reason, "VERIFIED_STRUCTURED_TURN_COMPLETED");
  assert.equal(result.completionEvidenceVerified, true);
  assert.equal(result.accountUsageScraped, false);
}

{
  const result = classify({
    kind: "evavo-codex-worker-run-v1",
    finishedAt: "2026-09-01T08:00:00.000Z",
    exitCode: 0,
    modelTurnCompleted: true,
    structuredTurnCompleted: true,
    stdout: { text: "Added regression coverage for usage limit and rate limit messages." },
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "AVAILABLE");
  assert.equal(result.reason, "VERIFIED_STRUCTURED_TURN_COMPLETED");
}

{
  const result = classify({
    kind: "evavo-codex-worker-run-v1",
    finishedAt: "2026-09-01T08:00:00.000Z",
    exitCode: 1,
    modelTurnCompleted: true,
    structuredTurnCompleted: true,
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "DEGRADED");
  assert.equal(result.completionEvidenceVerified, false);
}

{
  const result = classify({
    kind: "evavo-codex-worker-run-v1",
    finishedAt: "2026-09-01T08:00:00.000Z",
    exitCode: 1,
    modelTurnCompleted: false,
    structuredTurnCompleted: false,
    capacityState: "AVAILABLE",
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "DEGRADED");
  assert.equal(result.reason, "CONTRADICTORY_AVAILABLE_COMPLETION_EVIDENCE");
  assert.equal(result.contradictoryAvailableClaimRejected, true);
}

{
  const result = classify({
    kind: "evavo-codex-worker-run-v1",
    finishedAt: "2026-09-01T08:00:00.000Z",
    exitCode: 1,
    structuredTurnCompleted: false,
    errorMessage: "Too many requests; retry-after 120",
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "RATE_LIMITED");
}

{
  const result = classify({
    kind: "evavo-codex-worker-run-v1",
    finishedAt: "2026-09-01T08:00:00.000Z",
    exitCode: 1,
    errorMessage: "Weekly usage limit reached; allowance exhausted",
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "EXHAUSTED");
}

{
  const result = classify({
    kind: "evavo-codex-worker-run-v1",
    finishedAt: "2026-09-01T08:00:00.000Z",
    exitCode: 1,
    errorMessage: "Not logged in. Sign in required.",
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "AUTH_REQUIRED");
}

{
  const result = classify({
    kind: "evavo-codex-worker-run-v1",
    finishedAt: "2026-09-01T08:00:00.000Z",
    exitCode: 1,
    error: "spawn codex ENOENT",
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "OFFLINE");
}

{
  const result = classify({
    kind: "evavo-codex-worker-result-classification-v1",
    observedAt: "2026-09-01T08:00:00.000Z",
    capacityState: "DEGRADED",
    sourceExitCode: 2,
    structuredTurnCompleted: false,
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "DEGRADED");
  assert.equal(result.reason, "EXPLICIT_CAPACITY_CLASSIFICATION");
}

{
  const result = classify({
    kind: "evavo-codex-worker-result-classification-v1",
    observedAt: "2026-09-01T08:00:00.000Z",
    capacityState: "EXHAUSTED",
    sourceExitCode: 0,
    structuredTurnCompleted: true,
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "AVAILABLE");
  assert.equal(result.reason, "VERIFIED_STRUCTURED_TURN_COMPLETED");
}

{
  const result = classify({
    kind: "evavo-codex-worker-result-classification-v1",
    observedAt: "2026-09-01T08:00:00.000Z",
    capacityState: "AVAILABLE",
    sourceExitCode: 2,
    structuredTurnCompleted: true,
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "DEGRADED");
  assert.equal(result.reason, "CONTRADICTORY_AVAILABLE_COMPLETION_EVIDENCE");
}

{
  const result = classify({
    kind: "evavo-codex-worker-result-classification-v2",
    observedAt: "2026-09-01T08:00:00.000Z",
    capacityState: "AVAILABLE",
    sourceExitCode: 0,
    structuredTurnCompleted: true,
    completionEvidenceConsistent: true,
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "AVAILABLE");
  assert.equal(result.completionEvidenceVerified, true);
}

{
  const result = classify({
    kind: "unrelated-read-only-observation",
    observedAt: "2026-09-01T08:00:00.000Z",
    paidFallbackUsed: false,
  });
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.capacityInferredFromInstallationOnly, false);
  assert.equal(result.capacityInferredFromAuthenticationOnly, false);
}

assert.throws(
  () => classify({ kind: "evavo-codex-worker-run-v1", finishedAt: "2026-09-01T08:00:00.000Z", paidFallbackUsed: true }),
  /paid-fallback result/,
);
assert.throws(
  () => classify({ kind: "evavo-codex-worker-run-v1", paidFallbackUsed: false }),
  /valid observedAt/,
);

console.log("Codex Spark capacity observation tests passed.");
console.log("- AVAILABLE requires coherent zero-exit structured completion evidence for raw runs/classifiers");
console.log("- verified completion overrides incidental failure-like text and repairs stale v1 classifier false negatives");
console.log("- contradictory AVAILABLE claims are rejected rather than routed as capacity");
console.log("- rate limits, exhaustion, authentication and transport failures remain distinct");
console.log("- installation or authentication alone never implies capacity");
console.log("- the classifier does not spend a model turn or scrape account usage");
console.log("- paid fallback cannot be recorded as included Spark capacity");
