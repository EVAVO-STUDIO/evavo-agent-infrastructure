#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-doc-truth-activation-v2-"));
const COMPILER = path.resolve("scripts/compile-documentation-truth-supervised-activation-v2.mjs");
const NOW = "2026-09-02T08:00:00.000Z";
const SOURCE = "a".repeat(40);
const REPOSITORY = "EVAVO-STUDIO/example";
const SHA = "b".repeat(64);
const SCENARIOS = [
  "success-one-manifest-file-only",
  "no-action-already-correct",
  "forbidden-path-rejected",
  "stale-head-rejected",
  "second-file-rejected",
  "line-limit-rejected",
  "publication-attempt-rejected",
  "paid-fallback-rejected",
];

function baseEvidence() {
  return {
    waveManifest: {
      schemaVersion: 1,
      kind: "evavo-autonomous-lease-wave-manifest-v1",
      repository: REPOSITORY,
      sourceRevision: SOURCE,
      publicationPerformed: false,
      paidFallbackUsed: false,
    },
    waveValidation: {
      schemaVersion: 1,
      kind: "evavo-autonomous-lease-wave-validation-receipt-v1",
      ok: true,
      packageVerified: true,
      completedAt: "2026-09-01T08:00:00.000Z",
      publicationPerformed: false,
      paidFallbackUsed: false,
    },
    repositoryHead: {
      schemaVersion: 1,
      kind: "evavo-repository-head-observation-v1",
      repository: REPOSITORY,
      ref: "main",
      sha: SOURCE,
      observedAt: "2026-09-02T07:59:30.000Z",
      trusted: true,
      readOnly: true,
      repositoryMutationPerformed: false,
      publicationPerformed: false,
      paidFallbackUsed: false,
    },
    workExchange: {
      schemaVersion: 1,
      kind: "evavo-autonomous-lease-wave-deployment-receipt-v1",
      repository: REPOSITORY,
      sourceRevision: SOURCE,
      ok: true,
      decision: "ALREADY_CURRENT",
      completedAt: "2026-09-02T07:58:00.000Z",
      forcePushPerformed: false,
      githubActionsDispatched: false,
      leaseAcquired: false,
      modelTurnPerformed: false,
      publicationPerformed: false,
      deploymentPerformed: false,
      paidFallbackUsed: false,
    },
    capability: {
      schemaVersion: 1,
      kind: "evavo-codex-worker-capability-probe-v1",
      eligibleForWorkerDispatch: true,
      observedAt: "2026-09-02T07:59:20.000Z",
      version: "1.0.0",
      capabilities: {
        jsonFlag: "--json",
        modelFlag: "--model",
        sandboxFlag: "--sandbox",
        approvalFlag: "--ask-for-approval",
      },
      modelTurnPerformed: false,
      publicationPerformed: false,
      paidFallbackUsed: false,
    },
    capacity: {
      schemaVersion: 1,
      kind: "evavo-worker-capacity-status-v1",
      observedAt: "2026-09-02T07:59:15.000Z",
      routes: [{
        routeId: "codex-spark-pro",
        modelPreference: "gpt-5.3-codex-spark",
        capacityClass: "included-consumer",
        paidFallbackAllowed: false,
        dispatchEligible: true,
        maximumConcurrency: 1,
        admittedWorkerClasses: ["documentation-truth"],
      }],
      modelTurnPerformed: false,
      publicationPerformed: false,
      paidFallbackUsed: false,
    },
    fixture: {
      schemaVersion: 2,
      kind: "evavo-documentation-truth-supervised-fixture-acceptance-v2",
      accepted: true,
      supervised: true,
      repository: REPOSITORY,
      sourceRevision: SOURCE,
      workerClass: "documentation-truth",
      workClass: "capability-manifest-maintenance",
      maximumConcurrency: 1,
      maximumAutomaticAttempts: 1,
      acceptedAt: "2026-09-01T07:00:00.000Z",
      scenarios: SCENARIOS.map((id) => ({ id, passed: true, receiptSha256: SHA })),
      workerCommitPerformed: false,
      workerPushPerformed: false,
      publicationPerformed: false,
      deploymentPerformed: false,
      paidFallbackUsed: false,
    },
    validation: {
      schemaVersion: 2,
      kind: "evavo-documentation-truth-candidate-validation-v2",
      decision: "VALIDATED_SUCCESS",
      independent: true,
      repository: REPOSITORY,
      sourceRevision: SOURCE,
      changedFiles: 1,
      changedLines: 20,
      modelTurnPerformed: false,
      commitPerformed: false,
      pushPerformed: false,
      publicationPerformed: false,
      deploymentPerformed: false,
      paidFallbackUsed: false,
    },
    primary: {
      schemaVersion: 1,
      kind: "evavo-primary-checkout-unchanged-attestation-v1",
      repository: REPOSITORY,
      sourceRevision: SOURCE,
      branch: "main",
      primaryCheckoutUnchanged: true,
      primaryCheckoutClean: true,
      repositoryMutationPerformed: false,
      commitPerformed: false,
      pushPerformed: false,
      publicationPerformed: false,
      paidFallbackUsed: false,
    },
  };
}

const switches = {
  waveManifest: "--wave-manifest",
  waveValidation: "--wave-validation",
  repositoryHead: "--repository-head",
  workExchange: "--work-exchange-receipt",
  capability: "--codex-capability",
  capacity: "--capacity-status",
  fixture: "--fixture-acceptance",
  validation: "--candidate-validation",
  primary: "--primary-attestation",
};

function execute(documents) {
  const directory = fs.mkdtempSync(path.join(ROOT, "case-"));
  const argv = [COMPILER];
  for (const [name, value] of Object.entries(documents)) {
    const file = path.join(directory, `${name}.json`);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    argv.push(switches[name], file);
  }
  argv.push("--now", NOW);
  const result = spawnSync(process.execPath, argv, {
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
    const { result, document } = execute(baseEvidence());
    assert.equal(result.status, 0, result.stderr);
    assert.equal(document.decision, "ACTIVATE_ELIGIBLE");
    assert.equal(document.eligible, true);
    assert.equal(document.maximumConcurrency, 1);
    assert.equal(document.maximumAutomaticAttempts, 1);
    assert.equal(document.configurationMutationPerformed, false);
    assert.equal(document.leaseAcquired, false);
    assert.equal(document.modelTurnPerformed, false);
    assert.equal(document.publicationPerformed, false);
    assert.match(document.activationDecisionSha256, /^[0-9a-f]{64}$/);
  }

  {
    const evidence = baseEvidence();
    evidence.capacity.routes[0].admittedWorkerClasses = ["test-generation"];
    const { result, document } = execute(evidence);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(document.decision, "RETAIN_READY");
    assert.equal(document.eligible, false);
    assert.ok(document.blockers.some((entry) => entry.includes("not currently admitted")));
  }

  {
    const evidence = baseEvidence();
    evidence.fixture.publicationPerformed = true;
    const { result, document } = execute(evidence);
    assert.equal(result.status, 1);
    assert.equal(document.decision, "REJECTED");
    assert.ok(document.rejections.some((entry) => entry.includes("publicationPerformed")));
  }

  {
    const evidence = baseEvidence();
    evidence.repositoryHead.observedAt = "2026-09-02T07:00:00.000Z";
    const { result, document } = execute(evidence);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(document.decision, "RETAIN_READY");
    assert.ok(document.blockers.some((entry) => entry.includes("stale")));
  }

  {
    const evidence = baseEvidence();
    evidence.fixture.scenarios = evidence.fixture.scenarios.filter(
      (entry) => entry.id !== "forbidden-path-rejected",
    );
    const { result, document } = execute(evidence);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(document.decision, "RETAIN_READY");
    assert.ok(document.blockers.some((entry) => entry.includes("forbidden-path-rejected")));
  }

  {
    const evidence = baseEvidence();
    evidence.primary.sourceRevision = "c".repeat(40);
    const { result, document } = execute(evidence);
    assert.equal(result.status, 1);
    assert.equal(document.decision, "REJECTED");
    assert.ok(document.rejections.some((entry) => entry.includes("source revision")));
  }

  console.log("Documentation-truth supervised activation v2 tests passed.");
  console.log("- complete exact evidence produces a short-lived ACTIVATE_ELIGIBLE decision only");
  console.log("- missing worker-class admission and stale evidence retain READY work");
  console.log("- publication authority and source-identity drift are rejected");
  console.log("- required negative fixture scenarios cannot be omitted");
  console.log("- the compiler performs no configuration, lease, model, Git or publication effect");
} finally {
  fs.rmSync(ROOT, { recursive: true, force: true });
}
