#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const ordered = (value) => {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
};
const canonicalJson = (value) => JSON.stringify(ordered(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const withRouteDigest = (body) => ({ ...body, routePlanSha256: sha256(Buffer.from(canonicalJson(body), "utf8")) });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-codex-dispatch-compiler-"));
try {
  const workPath = path.join(dir, "work.json");
  const routePath = path.join(dir, "route.json");
  const capabilityPath = path.join(dir, "capability.json");
  const candidatePath = path.join(dir, "candidate.json");
  const candidateRoot = path.join(dir, "candidate-root");
  fs.mkdirSync(candidateRoot);

  const workerId = "spark-test-builder-fixture";
  const capability = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-capability-probe-v1",
    eligibleForWorkerDispatch: true,
    observedAt: new Date(Date.now() - 15_000).toISOString(),
    version: "fixture",
    capabilities: {
      jsonFlag: "--json",
      modelFlag: "--model",
      sandboxFlag: "--sandbox",
      approvalFlag: "--ask-for-approval",
    },
  };
  const capabilityBytes = Buffer.from(`${JSON.stringify(capability, null, 2)}\n`, "utf8");
  fs.writeFileSync(capabilityPath, capabilityBytes);

  const makeWork = (patch = {}) => ({
    schemaVersion: 1,
    kind: "evavo-autonomous-work-item-v1",
    id: "work:test-builder-fixture",
    lifecycleState: "LEASED",
    lease: {
      workerId,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
    workerClass: "test-generation",
    capacityClass: "included-consumer",
    repository: "EVAVO-STUDIO/example",
    sourceRevision: "a".repeat(40),
    objective: "Add regression coverage for stale state rejection.",
    allowedPaths: ["tests/**"],
    forbiddenPaths: ["tests/fixtures/secrets/**"],
    requiredValidation: ["node scripts/test-example.mjs"],
    paidFallbackAllowed: false,
    fixtureOnly: false,
    ...patch,
  });
  const makeRouteBody = (patch = {}) => ({
    schemaVersion: 1,
    kind: "evavo-worker-route-plan-v1",
    eligible: true,
    decision: "DISPATCH_ELIGIBLE",
    workerClass: "test-generation",
    repository: "EVAVO-STUDIO/example",
    sourceRevision: "a".repeat(40),
    routeId: "codex-spark-pro",
    runtime: "codex",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    capacityState: "AVAILABLE",
    rawCapacityState: "AVAILABLE",
    maximumConcurrency: 1,
    maximumAutomaticConcurrency: 1,
    capacityStatusSha256: "1".repeat(64),
    routeAdmissionSha256: "2".repeat(64),
    routeAdmissionObservedAt: new Date(Date.now() - 20_000).toISOString(),
    routeAdmissionExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    supervisedAcceptanceSha256: "3".repeat(64),
    capabilityReceiptSha256: sha256(capabilityBytes),
    capacityObservationSha256: "4".repeat(64),
    acceptanceVerificationSha256: "5".repeat(64),
    paidFallbackUsed: false,
    executionPerformed: false,
    validationPerformed: false,
    publicationPerformed: false,
    ...patch,
  });
  const makeCandidate = (patch = {}) => ({
    schemaVersion: 1,
    kind: "evavo-autonomous-candidate-worktree-v1",
    workItemId: "work:test-builder-fixture",
    sourceRevision: "a".repeat(40),
    sourceTreeSha: "b".repeat(40),
    candidate: {
      contract: "evavo_mainline_candidate_worktree_v1",
      path: candidateRoot,
    },
    ...patch,
  });

  const run = ({ workPatch = {}, routePatch = {}, mutateRouteAfterDigest = null, capabilityDocument = capability, candidatePatch = {} } = {}) => {
    const work = makeWork(workPatch);
    const route = withRouteDigest(makeRouteBody(routePatch));
    if (typeof mutateRouteAfterDigest === "function") mutateRouteAfterDigest(route);
    const candidate = makeCandidate(candidatePatch);
    fs.writeFileSync(workPath, `${JSON.stringify(work, null, 2)}\n`);
    fs.writeFileSync(routePath, `${JSON.stringify(route, null, 2)}\n`);
    fs.writeFileSync(capabilityPath, `${JSON.stringify(capabilityDocument, null, 2)}\n`);
    fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
    const result = spawnSync(process.execPath, [
      "scripts/compile-codex-worker-dispatch.mjs",
      workPath,
      routePath,
      capabilityPath,
      candidatePath,
      workerId,
    ], {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { result, document: JSON.parse(String(result.status === 0 ? result.stdout : result.stderr).trim()) };
  };

  {
    const { result, document: plan } = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(plan.kind, "evavo-codex-worker-dispatch-plan-v1");
    assert.equal(plan.eligible, true);
    assert.equal(plan.workerClass, "test-generation");
    assert.equal(plan.routeId, "codex-spark-pro");
    assert.equal(plan.maximumConcurrency, 1);
    assert.equal(plan.capabilityReceiptSha256, sha256(capabilityBytes));
    assert.match(plan.routePlanSha256, /^[0-9a-f]{64}$/);
    assert.match(plan.routePlanBytesSha256, /^[0-9a-f]{64}$/);
    assert.match(plan.dispatchPlanSha256, /^[0-9a-f]{64}$/);
    assert.equal(plan.modelTurnPerformed, false);
    assert.equal(plan.repositoryMutationPerformed, false);
    assert.equal(plan.validationAuthority, false);
    assert.equal(plan.publicationAuthority, false);
    assert.equal(plan.paidFallbackUsed, false);
  }

  {
    const { result, document } = run({ mutateRouteAfterDigest: (route) => { route.rawCapacityState = "DEGRADED"; } });
    assert.equal(result.status, 1);
    assert.ok(document.errors.some((entry) => entry.includes("Route-plan SHA-256")));
  }

  {
    const { result, document } = run({ capabilityDocument: { ...capability, version: "changed" } });
    assert.equal(result.status, 1);
    assert.ok(document.errors.some((entry) => entry.includes("Capability receipt bytes differ")));
  }

  {
    const { result, document } = run({
      routePatch: {
        routeAdmissionObservedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        routeAdmissionExpiresAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
    });
    assert.equal(result.status, 1);
    assert.ok(document.errors.some((entry) => entry.includes("Route admission")));
  }

  {
    const { result, document } = run({ routePatch: { maximumConcurrency: 2 } });
    assert.equal(result.status, 1);
    assert.ok(document.errors.some((entry) => entry.includes("concurrency")));
  }

  {
    const { result, document } = run({ workPatch: { workerClass: "fast-coding" } });
    assert.equal(result.status, 1);
    assert.ok(document.errors.some((entry) => entry.includes("test-generation")));
  }

  {
    const { result, document } = run({ workPatch: { paidFallbackAllowed: true } });
    assert.equal(result.status, 1);
    assert.ok(document.errors.some((entry) => entry.includes("Paid fallback")));
  }

  {
    const { result, document } = run({ candidatePatch: { workItemId: "work:other" } });
    assert.equal(result.status, 1);
    assert.ok(document.errors.some((entry) => entry.includes("does not match")));
  }

  {
    const { result, document } = run({ workPatch: { lease: { workerId: "spark-other", expiresAt: new Date(Date.now() + 60_000).toISOString() } } });
    assert.equal(result.status, 1);
    assert.ok(document.errors.some((entry) => entry.includes("lease")));
  }

  console.log("Codex worker dispatch compiler tests passed.");
  console.log("- exact route-plan and capability bytes are bound into the dispatch plan");
  console.log("- expired admission, concurrency escalation, unadmitted classes and paid fallback fail closed");
  console.log("- candidate and lease identity must match the bounded Test Builder work item");
  console.log("- compilation performs no model turn, validation, Git mutation or publication");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
