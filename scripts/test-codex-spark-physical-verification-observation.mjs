#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { compilePhysicalVerificationObservation } from "./codex-spark-physical-verification-observation-core.mjs";

const acceptanceBytes = Buffer.from('{"kind":"evavo-codex-spark-safe-physical-acceptance-v1"}\n', "utf8");
const capabilityBytes = Buffer.from('{"kind":"evavo-codex-worker-capability-probe-v1"}\n', "utf8");
const acceptedVerification = {
  schemaVersion: 1,
  kind: "evavo-codex-spark-safe-physical-acceptance-verification-v1",
  accepted: true,
  routeId: "codex-spark-pro",
  modelPreference: "gpt-5.3-codex-spark",
  workerClasses: ["test-generation"],
  maximumConcurrency: 1,
  paidFallbackAllowed: false,
  supervisedCleanupProven: true,
  errors: [],
  codexVersion: "fixture-codex",
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
};

const observation = compilePhysicalVerificationObservation({
  acceptanceBytes,
  capabilityBytes,
  verification: acceptedVerification,
});
assert.equal(observation.schemaVersion, 1);
assert.equal(observation.kind, "evavo-codex-spark-safe-physical-acceptance-verification-v1");
assert.equal(observation.accepted, true);
assert.equal(observation.routeId, "codex-spark-pro");
assert.equal(observation.modelPreference, "gpt-5.3-codex-spark");
assert.equal(observation.capacityClass, "included-consumer");
assert.deepEqual(observation.workerClasses, ["test-generation"]);
assert.equal(observation.maximumConcurrency, 1);
assert.equal(observation.paidFallbackAllowed, false);
assert.equal(observation.supervisedCleanupProven, true);
assert.match(observation.observedAt, /^\d{4}-\d{2}-\d{2}T/);
assert.match(observation.supervisedAcceptanceSha256, /^[0-9a-f]{64}$/);
assert.match(observation.codexCapabilityReceiptSha256, /^[0-9a-f]{64}$/);
assert.match(observation.baseVerificationSha256, /^[0-9a-f]{64}$/);
assert.equal(observation.modelTurnPerformed, false);
assert.equal(observation.repositoryMutationPerformed, false);
assert.equal(observation.publicationPerformed, false);
assert.equal(observation.physicalPathsReturned, false);

const rejects = [
  [{ ...acceptedVerification, accepted: false }, /not accepted/i],
  [{ ...acceptedVerification, supervisedCleanupProven: false }, /supervised cleanup/i],
  [{ ...acceptedVerification, routeId: "another-route" }, /route\/model/i],
  [{ ...acceptedVerification, modelPreference: "another-model" }, /route\/model/i],
  [{ ...acceptedVerification, paidFallbackAllowed: true }, /paid fallback/i],
  [{ ...acceptedVerification, workerClasses: ["test-generation", "fast-coding"] }, /worker-class boundary/i],
  [{ ...acceptedVerification, workerClasses: ["fast-coding"] }, /worker-class boundary/i],
  [{ ...acceptedVerification, maximumConcurrency: 2 }, /concurrency one/i],
  [{ ...acceptedVerification, errors: ["unexpected"] }, /contains errors/i],
];
for (const [verification, expected] of rejects) {
  assert.throws(
    () => compilePhysicalVerificationObservation({ acceptanceBytes, capabilityBytes, verification }),
    expected,
  );
}
assert.throws(
  () => compilePhysicalVerificationObservation({ acceptanceBytes: Buffer.alloc(0), capabilityBytes, verification: acceptedVerification }),
  /acceptance bytes/i,
);
assert.throws(
  () => compilePhysicalVerificationObservation({ acceptanceBytes, capabilityBytes: Buffer.alloc(0), verification: acceptedVerification }),
  /capability bytes/i,
);

const cliPath = path.join(process.cwd(), "scripts", "compile-codex-spark-physical-verification-observation.mjs");
const syntax = spawnSync(process.execPath, ["--check", cliPath], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: false,
});
assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
const cliSource = fs.readFileSync(cliPath, "utf8");
assert.ok(cliSource.includes("verify-codex-spark-safe-physical-acceptance.mjs"));
assert.ok(cliSource.includes("compilePhysicalVerificationObservation"));
assert.ok(cliSource.includes("shell: false"));
assert.ok(!cliSource.includes("run-codex-worker-dispatch.mjs"));
assert.ok(!cliSource.includes("EVAVO_CODEX_SPARK_EXECUTION_ENABLED"));

console.log("Codex Spark physical-verification observation tests passed.");
console.log("- accepted supervised verification is freshness-stamped and hash-bound to exact acceptance/capability bytes");
console.log("- class, concurrency, paid fallback, cleanup, route/model and verification-error drift fail closed");
console.log("- the CLI reruns the existing supervised verifier without starting Codex or granting mutation/publication authority");
