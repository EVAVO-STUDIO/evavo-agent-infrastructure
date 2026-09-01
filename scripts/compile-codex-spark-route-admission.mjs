#!/usr/bin/env node

const result = {
  schemaVersion: 1,
  kind: "evavo-codex-spark-route-admission-deprecated-v1",
  admitted: false,
  decision: "USE_CANONICAL_CAPACITY_STATUS_ASSEMBLER",
  canonicalEntry: "scripts/assemble-codex-spark-capacity-status.mjs",
  reason: "Route admission may not be minted from physical acceptance and capability evidence alone. Raw capacity, supervised admission, exact capability identity, worker-class limits and concurrency must be assembled together by the canonical capacity-status authority.",
  rawCapacityEvidenceRequired: true,
  supervisedPhysicalAdmissionRequired: true,
  sameCapabilityReceiptRequiredAtDispatch: true,
  paidFallbackAllowed: false,
  modelTurnPerformed: false,
  repositoryMutationPerformed: false,
  publicationPerformed: false,
  truthBoundary: "This compatibility tombstone never creates a route admission. It exists only so stale callers fail closed rather than silently bypassing the canonical capacity-status assembler.",
};

process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = 2;
