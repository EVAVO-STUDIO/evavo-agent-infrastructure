#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-doc-truth-fixture-v2-"));
const VERIFIER = path.resolve("scripts/verify-documentation-truth-supervised-fixture-acceptance-v2.mjs");
const NOW = "2026-09-02T08:00:00.000Z";
const REPOSITORY = "EVAVO-STUDIO/example";
const SOURCE = "a".repeat(40);
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

function scenario(id) {
  const common = {
    schemaVersion: 2,
    kind: "evavo-documentation-truth-fixture-scenario-receipt-v2",
    id,
    passed: true,
    repository: REPOSITORY,
    sourceRevision: SOURCE,
    workerClass: "documentation-truth",
    workClass: "capability-manifest-maintenance",
    capacityClass: "included-consumer",
    maximumConcurrency: 1,
    maximumAutomaticAttempts: 1,
    paidFallbackAllowed: false,
    observedAt: "2026-09-01T07:30:00.000Z",
    workerCommitPerformed: false,
    workerPushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
  };
  if (id === "success-one-manifest-file-only") {
    return {
      ...common,
      resultState: "SUCCESS",
      changedPaths: ["evavo.capabilities.json"],
      changedFiles: 1,
      changedLines: 24,
    };
  }
  if (id === "no-action-already-correct") {
    return {
      ...common,
      resultState: "NO_ACTION",
      changedPaths: [],
      changedFiles: 0,
      changedLines: 0,
    };
  }
  const flags = {
    "forbidden-path-rejected": { forbiddenPathObserved: true },
    "stale-head-rejected": { staleHeadObserved: true },
    "second-file-rejected": { secondFileObserved: true },
    "line-limit-rejected": { lineLimitExceededObserved: true },
    "publication-attempt-rejected": { publicationAttemptObserved: true },
    "paid-fallback-rejected": { paidFallbackAttemptObserved: true },
  };
  return {
    ...common,
    resultState: "REJECTED",
    changedPaths: [],
    changedFiles: 0,
    changedLines: 0,
    attemptObserved: true,
    attemptRejected: true,
    ...flags[id],
  };
}

function writeCampaign(mutator) {
  const root = fs.mkdtempSync(path.join(ROOT, "case-"));
  const scenarioRoot = path.join(root, "scenarios");
  fs.mkdirSync(scenarioRoot);
  const documents = Object.fromEntries(SCENARIOS.map((id) => [id, scenario(id)]));
  const state = {
    root,
    scenarioRoot,
    documents,
    acceptance: null,
  };
  if (mutator) mutator(state, "before-write");
  const summaries = [];
  for (const id of SCENARIOS) {
    const file = path.join(scenarioRoot, `${id}.json`);
    const bytes = Buffer.from(`${JSON.stringify(documents[id], null, 2)}\n`, "utf8");
    fs.writeFileSync(file, bytes, { flag: "wx" });
    summaries.push({ id, path: `${id}.json`, receiptSha256: sha256(bytes) });
  }
  const body = {
    schemaVersion: 2,
    kind: "evavo-documentation-truth-supervised-fixture-acceptance-v2",
    accepted: true,
    supervised: true,
    repository: REPOSITORY,
    sourceRevision: SOURCE,
    workerClass: "documentation-truth",
    workClass: "capability-manifest-maintenance",
    capacityClass: "included-consumer",
    maximumConcurrency: 1,
    maximumAutomaticAttempts: 1,
    maximumChangedFiles: 1,
    maximumChangedLines: 600,
    acceptedAt: "2026-09-01T08:00:00.000Z",
    scenarios: summaries,
    workerCommitPerformed: false,
    workerPushPerformed: false,
    publicationPerformed: false,
    deploymentPerformed: false,
    financialActionPerformed: false,
    paidFallbackUsed: false,
  };
  state.acceptance = { ...body, acceptanceSha256: sha256(Buffer.from(canonical(body), "utf8")) };
  if (mutator) mutator(state, "after-write");
  const acceptancePath = path.join(root, "acceptance.json");
  fs.writeFileSync(acceptancePath, `${JSON.stringify(state.acceptance, null, 2)}\n`, { flag: "wx" });
  return { ...state, acceptancePath };
}

function runCampaign(campaign, now = NOW) {
  const result = spawnSync(
    process.execPath,
    [VERIFIER, campaign.acceptancePath, campaign.scenarioRoot, now],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const channel = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  return { result, document: JSON.parse(String(channel).trim()) };
}

try {
  {
    const campaign = writeCampaign();
    const { result, document } = runCampaign(campaign);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(document.accepted, true);
    assert.equal(document.kind, "evavo-documentation-truth-supervised-fixture-verification-v2");
    assert.equal(document.allRequiredScenariosVerified, true);
    assert.equal(document.scenarios.length, 8);
    assert.equal(document.evidenceRootReturned, false);
    assert.equal(document.publicationPerformed, false);
    assert.equal(document.paidFallbackUsed, false);
    assert.match(document.verificationSha256, /^[0-9a-f]{64}$/);
  }

  {
    const campaign = writeCampaign((state, phase) => {
      if (phase === "after-write") {
        fs.appendFileSync(
          path.join(state.scenarioRoot, "success-one-manifest-file-only.json"),
          " ",
        );
      }
    });
    const { result, document } = runCampaign(campaign);
    assert.equal(result.status, 1);
    assert.equal(document.accepted, false);
    assert.match(document.errorMessage, /exact receipt digest changed/);
  }

  {
    const campaign = writeCampaign((state, phase) => {
      if (phase === "before-write") {
        state.documents["success-one-manifest-file-only"].changedPaths = [
          "evavo.capabilities.json",
          "src/product.ts",
        ];
        state.documents["success-one-manifest-file-only"].changedFiles = 2;
      }
    });
    const { result, document } = runCampaign(campaign);
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /path count|one-file bound/);
  }

  {
    const campaign = writeCampaign((state, phase) => {
      if (phase === "before-write") {
        state.documents["forbidden-path-rejected"].publicationPerformed = true;
      }
    });
    const { result, document } = runCampaign(campaign);
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /publicationPerformed must be false/);
  }

  {
    const campaign = writeCampaign((state, phase) => {
      if (phase === "after-write") {
        state.acceptance.scenarios = state.acceptance.scenarios.filter(
          (entry) => entry.id !== "paid-fallback-rejected",
        );
        const body = { ...state.acceptance };
        delete body.acceptanceSha256;
        state.acceptance.acceptanceSha256 = sha256(Buffer.from(canonical(body), "utf8"));
      }
    });
    const { result, document } = runCampaign(campaign);
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /scenario set is incomplete/);
  }

  {
    const campaign = writeCampaign((state, phase) => {
      if (phase === "after-write") state.acceptance.acceptanceSha256 = "f".repeat(64);
    });
    const { result, document } = runCampaign(campaign);
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /canonical digest is invalid/);
  }

  {
    const campaign = writeCampaign();
    const { result, document } = runCampaign(campaign, "2026-09-10T08:00:01.000Z");
    assert.equal(result.status, 1);
    assert.match(document.errorMessage, /stale/);
  }

  console.log("Documentation-truth supervised fixture acceptance v2 tests passed.");
  console.log("- all eight exact scenario receipts are required and digest-bound");
  console.log("- campaign and receipt tampering fail closed");
  console.log("- path, file-count, line-count and authority limits are enforced");
  console.log("- negative scenarios must prove zero-effect rejection semantics");
  console.log("- stale fixture acceptance cannot authorize later activation");
} finally {
  fs.rmSync(ROOT, { recursive: true, force: true });
}
