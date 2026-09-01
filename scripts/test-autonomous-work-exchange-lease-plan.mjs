#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-lease-plan-"));
const NOW = "2026-09-01T11:00:00.000Z";
const sha = (character, length = 64) => character.repeat(length);

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}
const canonical = (value) => JSON.stringify(ordered(value));
const digest = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")).digest("hex");

function documentationWork(patch = {}) {
  return {
    schemaVersion: 1,
    kind: "evavo-autonomous-improvement-work-item-v1",
    id: "work:capability-gap:" + sha("a", 24),
    lifecycleState: "READY",
    createdAt: NOW,
    updatedAt: NOW,
    origin: {
      producer: "brain-portfolio-health",
      evidenceFingerprintSha256: sha("b"),
      coverageReportSha256: sha("c"),
      candidateFingerprintSha256: sha("d"),
      repositoryHeadEvidenceSha256: sha("e"),
      admissionDecisionSha256: sha("f"),
      admissionPolicySha256: sha("1")
    },
    repository: "EVAVO-STUDIO/example",
    sourceRevision: sha("2", 40),
    repoTier: "T1",
    repositoryLifecycleState: "ACTIVE",
    category: "capability-manifest-gap",
    workClass: "capability-manifest-maintenance",
    workerClass: "documentation-truth",
    objective: "Add the smallest truthful capability declaration from current repository evidence.",
    capacityClass: "included-consumer",
    paidFallbackAllowed: false,
    allowedPaths: ["evavo.capabilities.json"],
    forbiddenPaths: ["src/**", ".git/**"],
    requiredValidation: ["capability-manifest-check"],
    maximumChangedFiles: 1,
    maximumChangedLines: 600,
    maximumAutomaticAttempts: 1,
    automaticAttempts: 0,
    documentationMetadataMutationAllowed: true,
    productionSourceMutationAllowed: false,
    dependencyChangeAllowed: false,
    schemaChangeAllowed: false,
    publicApiChangeAllowed: false,
    workerMayCommit: false,
    workerMayPush: false,
    workerMayPublish: false,
    publicationSeparated: true,
    requiresCurrentHeadMatch: true,
    noActionAccepted: true,
    lease: null,
    dedupeKey: sha("3"),
    ...patch
  };
}

function testWork(patch = {}) {
  return {
    schemaVersion: 1,
    kind: "evavo-autonomous-improvement-work-item-v1",
    id: "work:spark-test:" + sha("4", 24),
    lifecycleState: "READY",
    createdAt: NOW,
    updatedAt: NOW,
    origin: { producer: "EVAVO-STUDIO/automated-testing", evidenceFingerprintSha256: sha("5") },
    repository: "EVAVO-STUDIO/example-tests",
    sourceRevision: sha("6", 40),
    category: "failure-path-test-gap",
    workClass: "test-expansion",
    workerClass: "test-generation",
    objective: "Add focused malformed-input coverage.",
    capacityClass: "included-consumer",
    paidFallbackAllowed: false,
    allowedPaths: ["tests/**"],
    forbiddenPaths: ["src/**"],
    requiredValidation: ["node-test"],
    maximumChangedFiles: 4,
    maximumChangedLines: 300,
    maximumAutomaticAttempts: 2,
    productionSourceMutationAllowed: false,
    dependencyChangeAllowed: false,
    schemaChangeAllowed: false,
    publicApiChangeAllowed: false,
    workerMayCommit: false,
    workerMayPush: false,
    workerMayPublish: false,
    lease: null,
    dedupeKey: sha("7"),
    ...patch
  };
}

function routeFor(work, patch = {}) {
  const body = {
    schemaVersion: 1,
    kind: "evavo-worker-route-plan-v1",
    eligible: true,
    decision: "DISPATCH_ELIGIBLE",
    workerClass: work.workerClass,
    repository: work.repository,
    sourceRevision: work.sourceRevision,
    routeId: "codex-spark-pro",
    runtime: "codex",
    modelPreference: "gpt-5.3-codex-spark",
    capacityClass: "included-consumer",
    capacityState: "AVAILABLE",
    rawCapacityState: "AVAILABLE",
    maximumConcurrency: 1,
    maximumAutomaticConcurrency: 1,
    capacityStatusSha256: sha("8"),
    routeAdmissionSha256: sha("9"),
    routeAdmissionObservedAt: "2026-09-01T10:59:30.000Z",
    routeAdmissionExpiresAt: "2026-09-01T11:05:00.000Z",
    supervisedAcceptanceSha256: sha("a"),
    capabilityReceiptSha256: sha("b"),
    capacityObservationSha256: sha("c"),
    acceptanceVerificationSha256: sha("d"),
    paidFallbackUsed: false,
    executionPerformed: false,
    validationPerformed: false,
    publicationPerformed: false,
    truthBoundary: "fixture"
  };
  Object.assign(body, patch);
  return { ...body, routePlanSha256: digest(canonical(body)) };
}

function execute(work, snapshotPatch = {}, routePatch = {}) {
  const snapshot = {
    schemaVersion: 1,
    kind: "evavo-work-exchange-state-v1",
    generation: 4,
    updatedAt: NOW,
    items: [work],
    ...snapshotPatch
  };
  const route = routeFor(work, routePatch);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const workPath = path.join(TEMP, `work-${suffix}.json`);
  const snapshotPath = path.join(TEMP, `snapshot-${suffix}.json`);
  const routePath = path.join(TEMP, `route-${suffix}.json`);
  fs.writeFileSync(workPath, JSON.stringify(work));
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
  fs.writeFileSync(routePath, JSON.stringify(route));
  const result = spawnSync(process.execPath, [
    "scripts/compile-autonomous-work-exchange-lease-plan.mjs",
    workPath,
    snapshotPath,
    routePath,
    "spark-worker-1",
    "--now",
    NOW
  ], { cwd: ROOT, encoding: "utf8", shell: false });
  const channel = result.status === 0 ? result.stdout : result.stderr;
  return { result, document: JSON.parse(String(channel).trim()), work, snapshot, route };
}

try {
  {
    const first = execute(documentationWork());
    assert.equal(first.result.status, 0, first.result.stderr);
    assert.equal(first.document.kind, "evavo-autonomous-work-exchange-lease-plan-v2");
    assert.equal(first.document.workerClass, "documentation-truth");
    assert.equal(first.document.maximumItemsLeased, 1);
    assert.equal(first.document.oneWriterPerRepository, true);
    assert.equal(first.document.effectiveTtlSeconds, 295);
    assert.equal(first.document.leaseAcquired, false);
    assert.equal(first.document.modelTurnPerformed, false);
    assert.equal(first.document.publicationPerformed, false);
    const body = { ...first.document };
    const observed = body.planSha256;
    delete body.planSha256;
    assert.equal(observed, digest(canonical(body)));
    const second = execute(documentationWork()).document;
    assert.equal(first.document.planSha256, second.planSha256, "fixed-time equivalent evidence must compile deterministically");
  }

  {
    const outcome = execute(testWork());
    assert.equal(outcome.result.status, 0, outcome.result.stderr);
    assert.equal(outcome.document.workerClass, "test-generation");
  }

  {
    const work = documentationWork();
    const outcome = execute(work, {}, { workerClass: "test-generation" });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /identity differs/);
  }

  {
    const work = documentationWork();
    const outcome = execute(work, {}, {
      routeAdmissionObservedAt: "2026-09-01T10:40:00.000Z",
      routeAdmissionExpiresAt: "2026-09-01T11:05:00.000Z"
    });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /stale/);
  }

  {
    const work = documentationWork();
    const writer = {
      ...testWork({ id: "work:other", repository: work.repository }),
      lifecycleState: "RUNNING",
      lease: { workerId: "other", expiresAt: "2026-09-01T11:04:00.000Z" }
    };
    const outcome = execute(work, { items: [work, writer] });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /active writer/);
  }

  {
    const outcome = execute(documentationWork({ allowedPaths: ["src/index.ts"] }));
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /canonical capability-manifest paths/);
  }

  {
    const outcome = execute(documentationWork({ paidFallbackAllowed: true }));
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /paid fallback disabled/);
  }

  {
    const outcome = execute(documentationWork(), {}, { maximumConcurrency: 2 });
    assert.equal(outcome.result.status, 1);
    assert.match(outcome.document.errors[0], /concurrency one/);
  }

  console.log("Autonomous Work Exchange lease-plan tests passed.");
  console.log("- exact READY item, snapshot, generation and physical route admission are bound");
  console.log("- test-generation and documentation-truth remain separate worker classes");
  console.log("- one writer, canonical manifest paths, zero paid fallback and concurrency one fail closed");
  console.log("- planning performs no lease, model, validation, Git, publication or deployment effect");
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true });
}
