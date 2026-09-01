#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-doc-truth-lease-plan-v2-"));
const COMPILER = path.resolve("scripts/compile-documentation-truth-route-bound-lease-v2.mjs");
const NOW = "2026-09-02T08:00:00.000Z";
const REPOSITORY = "EVAVO-STUDIO/example";
const SOURCE = "a".repeat(40);
const WORK_ITEM_ID = "work:documentation-truth:example";
const WORKER_ID = "worker:documentation-truth:01";

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}

function canonical(value) {
  return JSON.stringify(ordered(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function seal(document, field) {
  const body = { ...document };
  delete body[field];
  return { ...body, [field]: sha256(Buffer.from(canonical(body), "utf8")) };
}

function writeJson(file, document) {
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
  fs.writeFileSync(file, bytes);
  return sha256(bytes);
}

function baseActivation() {
  return seal({
    schemaVersion: 2,
    kind: "evavo-documentation-truth-supervised-activation-run-v2",
    decision: "ACTIVATE_ELIGIBLE",
    eligible: true,
    repository: REPOSITORY,
    sourceRevision: SOURCE,
    workerClass: "documentation-truth",
    workClass: "capability-manifest-maintenance",
    routeId: "codex-spark-pro",
    capacityClass: "included-consumer",
    maximumConcurrency: 1,
    maximumAutomaticAttempts: 1,
    observedAt: "2026-09-02T07:59:00.000Z",
    expiresAt: "2026-09-02T08:05:00.000Z",
    configurationMutationPerformed: false,
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
  }, "activationRunSha256");
}

function baseHead() {
  return {
    schemaVersion: 1,
    kind: "evavo-repository-head-observation-v1",
    repository: REPOSITORY,
    ref: "main",
    sha: SOURCE,
    observedAt: "2026-09-02T07:59:30.000Z",
    trusted: true,
    readOnly: true,
    configurationMutationPerformed: false,
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
  };
}

function baseRoute() {
  return seal({
    schemaVersion: 1,
    kind: "evavo-worker-route-plan-v1",
    eligible: true,
    decision: "DISPATCH_ELIGIBLE",
    workerClass: "documentation-truth",
    repository: REPOSITORY,
    sourceRevision: SOURCE,
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
    routeAdmissionObservedAt: "2026-09-02T07:59:40.000Z",
    routeAdmissionExpiresAt: "2026-09-02T08:10:00.000Z",
    supervisedAcceptanceSha256: "3".repeat(64),
    capabilityReceiptSha256: "4".repeat(64),
    capacityObservationSha256: "5".repeat(64),
    acceptanceVerificationSha256: "6".repeat(64),
    paidFallbackUsed: false,
    executionPerformed: false,
    validationPerformed: false,
    publicationPerformed: false,
    configurationMutationPerformed: false,
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
  }, "routePlanSha256");
}

function buildBundle() {
  const directory = fs.mkdtempSync(path.join(ROOT, "case-"));
  const paths = {
    activation: path.join(directory, "activation.json"),
    head: path.join(directory, "head.json"),
    readiness: path.join(directory, "readiness.json"),
    route: path.join(directory, "route.json"),
  };
  const documents = {
    activation: baseActivation(),
    head: baseHead(),
    route: baseRoute(),
    readiness: null,
  };
  const activationBytesSha256 = writeJson(paths.activation, documents.activation);
  const headBytesSha256 = writeJson(paths.head, documents.head);
  documents.readiness = seal({
    schemaVersion: 2,
    kind: "evavo-documentation-truth-lease-readiness-v2",
    decision: "LEASE_READY",
    ready: true,
    workItemId: WORK_ITEM_ID,
    repository: REPOSITORY,
    sourceRevision: SOURCE,
    workerClass: "documentation-truth",
    workClass: "capability-manifest-maintenance",
    capacityClass: "included-consumer",
    workExchangeGeneration: 7,
    maximumConcurrency: 1,
    maximumAutomaticAttempts: 1,
    oneWriterPerRepository: true,
    activeRepositoryWriterWorkItemId: null,
    activationRunSha256: documents.activation.activationRunSha256,
    evidence: {
      policy: "7".repeat(64),
      activationRun: activationBytesSha256,
      workExchangeState: "8".repeat(64),
      repositoryHead: headBytesSha256,
    },
    observedAt: "2026-09-02T07:59:45.000Z",
    configurationMutationPerformed: false,
    queueMutationPerformed: false,
    leaseAcquired: false,
    modelTurnPerformed: false,
    repositoryMutationPerformed: false,
    commitPerformed: false,
    pushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
  }, "readinessSha256");
  writeJson(paths.readiness, documents.readiness);
  writeJson(paths.route, documents.route);
  return {
    directory,
    paths,
    documents,
    rewrite(name) {
      return writeJson(paths[name], documents[name]);
    },
    reseal(name, field) {
      documents[name] = seal(documents[name], field);
      return documents[name];
    },
  };
}

function run(bundle, options = {}) {
  const args = [
    COMPILER,
    "--readiness", bundle.paths.readiness,
    "--activation-run", bundle.paths.activation,
    "--route-plan", bundle.paths.route,
    "--repository-head", bundle.paths.head,
    "--worker-id", options.workerId ?? WORKER_ID,
    "--now", options.now ?? NOW,
  ];
  if (options.leaseSeconds !== undefined) args.push("--lease-seconds", String(options.leaseSeconds));
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const channel = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  return { result, document: JSON.parse(String(channel).trim()) };
}

try {
  {
    const bundle = buildBundle();
    const { result, document } = run(bundle);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(document.decision, "LEASE_REQUIRED");
    assert.equal(document.eligible, true);
    assert.equal(document.action, "storage.documentation_truth_work_exchange_lease");
    assert.equal(document.expectedSnapshotSha256, "8".repeat(64));
    assert.equal(document.expectedGeneration, 7);
    assert.equal(document.workerId, WORKER_ID);
    assert.equal(document.leaseSeconds, 180);
    assert.equal(document.leaseExpiresAt, "2026-09-02T08:03:00.000Z");
    assert.equal(document.maximumConcurrency, 1);
    assert.equal(document.maximumAutomaticAttempts, 1);
    assert.equal(document.oneWriterPerRepository, true);
    assert.equal(document.queueMutationPerformed, false);
    assert.equal(document.leaseAcquired, false);
    assert.equal(document.modelTurnPerformed, false);
    assert.equal(document.publicationPerformed, false);
    assert.equal(document.paidFallbackUsed, false);
    assert.match(document.leasePlanSha256, /^[0-9a-f]{64}$/);
  }

  {
    const bundle = buildBundle();
    bundle.documents.route = {
      schemaVersion: 1,
      kind: "evavo-worker-route-plan-v1",
      eligible: false,
      decision: "RETAIN_READY_JOB",
      reason: "NO_ZERO_COST_CAPACITY_ROUTE_AVAILABLE",
      workerClass: "documentation-truth",
      repository: REPOSITORY,
      sourceRevision: SOURCE,
      paidFallbackUsed: false,
      executionPerformed: false,
      validationPerformed: false,
      publicationPerformed: false,
    };
    bundle.rewrite("route");
    const { result, document } = run(bundle);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(document.decision, "RETAIN_READY");
    assert.equal(document.eligible, false);
    assert.equal(document.reason, "NO_ZERO_COST_CAPACITY_ROUTE_AVAILABLE");
    assert.equal(document.leaseAcquired, false);
    assert.equal(document.modelTurnPerformed, false);
  }

  {
    const bundle = buildBundle();
    bundle.documents.route = {
      schemaVersion: 1,
      kind: "evavo-worker-route-plan-v1",
      eligible: false,
      decision: "RETAIN_READY_JOB",
      reason: "NO_ZERO_COST_CAPACITY_ROUTE_AVAILABLE",
      workerClass: "documentation-truth",
      repository: REPOSITORY,
      sourceRevision: SOURCE,
      paidFallbackUsed: false,
      executionPerformed: false,
      validationPerformed: false,
      publicationPerformed: true,
    };
    bundle.rewrite("route");
    const { result, document } = run(bundle);
    assert.equal(result.status, 1);
    assert.equal(document.decision, "REJECTED");
    assert.match(document.errorMessage, /publicationPerformed/);
  }

  {
    const bundle = buildBundle();
    bundle.documents.readiness.readinessSha256 = "f".repeat(64);
    bundle.rewrite("readiness");
    const { result, document } = run(bundle);
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /readiness canonical digest does not match/);
  }

  {
    const bundle = buildBundle();
    bundle.documents.activation.evidenceNonce = "new-exact-bytes";
    bundle.reseal("activation", "activationRunSha256");
    bundle.rewrite("activation");
    const { result, document } = run(bundle);
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /not bound to the exact activation run/);
  }

  {
    const bundle = buildBundle();
    bundle.documents.route.sourceRevision = "b".repeat(40);
    bundle.reseal("route", "routePlanSha256");
    bundle.rewrite("route");
    const { result, document } = run(bundle);
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /source identity differs/);
  }

  {
    const bundle = buildBundle();
    bundle.documents.activation.expiresAt = "2026-09-02T08:02:00.000Z";
    bundle.reseal("activation", "activationRunSha256");
    const activationBytesSha256 = bundle.rewrite("activation");
    bundle.documents.readiness.activationRunSha256 = bundle.documents.activation.activationRunSha256;
    bundle.documents.readiness.evidence.activationRun = activationBytesSha256;
    bundle.reseal("readiness", "readinessSha256");
    bundle.rewrite("readiness");
    const { result, document } = run(bundle);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(document.decision, "RETAIN_READY");
    assert.equal(document.reason, "INSUFFICIENT_ACTIVATION_OR_ROUTE_LIFETIME");
  }

  {
    const bundle = buildBundle();
    bundle.documents.route.paidFallbackUsed = true;
    bundle.reseal("route", "routePlanSha256");
    bundle.rewrite("route");
    const { result, document } = run(bundle);
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /paidFallbackUsed=false/);
  }

  {
    const bundle = buildBundle();
    bundle.documents.readiness.observedAt = "2026-09-02T07:58:00.000Z";
    bundle.reseal("readiness", "readinessSha256");
    bundle.rewrite("readiness");
    const { result, document } = run(bundle);
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /Lease readiness is stale/);
  }

  {
    const bundle = buildBundle();
    const { result, document } = run(bundle, { leaseSeconds: 301 });
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /duration is outside policy/);
  }

  {
    const bundle = buildBundle();
    bundle.documents.head.observedAt = "2026-09-02T07:59:31.000Z";
    bundle.rewrite("head");
    const { result, document } = run(bundle);
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /not bound to the exact repository-head bytes/);
  }

  console.log("Documentation-truth route-bound lease v2 tests passed.");
  console.log("- exact readiness, activation, route and current-main bytes produce a short-lived plan")
  console.log("- unavailable zero-cost capacity retains READY work without a lease or model turn")
  console.log("- malformed unavailable routes and paid fallback are rejected")
  console.log("- digest, source, freshness, duration and lifetime drift fail closed")
  console.log("- the compiler performs no queue, lease, model, Git, publication or financial effect")
} finally {
  fs.rmSync(ROOT, { recursive: true, force: true });
}
