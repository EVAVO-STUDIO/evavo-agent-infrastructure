#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runCodexDocumentationTruthDormantFixtureCampaign } from "./run-codex-documentation-truth-dormant-fixture-campaign.mjs";

const ROOT = process.cwd();
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), "evavo-doc-truth-campaign-test-"));
const INPUT = path.join(TEMP, "input");
const EVIDENCE = path.join(TEMP, "evidence");
fs.mkdirSync(INPUT);
fs.mkdirSync(EVIDENCE);

const OBJECT = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!OBJECT(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, ordered(value[key])]),
  );
}
const canonical = (value) => JSON.stringify(ordered(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function seal(body, field) {
  return { ...body, [field]: sha256(Buffer.from(canonical(body), "utf8")) };
}
function write(name, value) {
  const file = path.join(INPUT, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return file;
}

function fixtureManifest() {
  return {
    contractVersion: "evavo_repository_capabilities_v1",
    repository: "EVAVO-STUDIO/_documentation-truth-fixture",
    authority: "fixture-only",
    summary: "Remote-less documentation-truth physical acceptance fixture.",
    capabilities: [
      {
        id: "fixture.documentation.truth",
        title: "Documentation truth fixture",
        description: "Proves one bounded manifest-only documentation-truth change without product or publication authority.",
        interfaces: ["automation", "testing"],
        effects: ["read", "compute"],
        entrypoints: ["evavo.capabilities.json"],
        tags: ["fixture", "documentation-truth"],
        requires: ["remote-less fixture repository"],
      },
    ],
    brain: {
      consult: true,
      sanityCheck: true,
      topics: ["documentation truth fixture"],
    },
    reviewedAt: "2026-09-01T00:00:00.000Z",
  };
}

function createInput(now, overrides = {}) {
  const design = seal({
    schemaVersion: 1,
    kind: "evavo-documentation-truth-cross-repository-activation-design-v1",
    ready: true,
    decision: "ACTIVATION_DESIGN_PACKET_READY",
    workerClass: "documentation-truth",
    workClass: "capability-manifest-maintenance",
  }, "designSha256");
  const publication = seal({
    schemaVersion: 1,
    kind: "evavo-documentation-truth-dormant-publication-attestation-v1",
    accepted: true,
    designSha256: design.designSha256,
    agentInfrastructureMainSha: overrides.agentMainSha ?? "1".repeat(40),
    localStorageMainSha: overrides.localStorageMainSha ?? "2".repeat(40),
    agentInfrastructureExactRemoteMainConfirmed: true,
    localStorageExactRemoteMainConfirmed: true,
    dormantSupportStillDisabled: overrides.dormantSupportStillDisabled ?? true,
  }, "attestationSha256");
  const capability = {
    schemaVersion: 1,
    kind: "evavo-codex-worker-capability-probe-v1",
    eligibleForWorkerDispatch: true,
    observedAt: overrides.capabilityObservedAt ?? now.toISOString(),
    version: "codex-test-version",
    capabilities: {
      jsonFlag: "--json",
      modelFlag: "--model",
      sandboxFlag: "--sandbox",
      approvalFlag: "--ask-for-approval",
    },
  };
  return {
    designPath: write(`design-${Math.random()}.json`, design),
    publicationPath: write(`publication-${Math.random()}.json`, publication),
    capabilityPath: write(`capability-${Math.random()}.json`, capability),
  };
}

function summary(resultState, changedPaths) {
  return {
    resultState,
    changedPaths,
    assertionsAdded: [],
    assumptions: [],
    followUp: [],
  };
}

function fakeExecutor(mode = "valid") {
  return ({ cwd, scenario }) => {
    if (scenario === "validated-success") {
      if (mode === "success-forbidden-path") {
        fs.writeFileSync(path.join(cwd, "README.md"), "forbidden\n", "utf8");
        return {
          status: 0,
          signal: null,
          error: null,
          stdout: "",
          stderr: "",
          modelTurnPerformed: true,
          structuredTurnCompleted: true,
          workerSummary: summary("SUCCESS", ["README.md"]),
          removedEnvironment: [],
        };
      }
      if (mode === "malformed-success-summary") {
        fs.writeFileSync(
          path.join(cwd, "evavo.capabilities.json"),
          `${JSON.stringify(fixtureManifest(), null, 2)}\n`,
          "utf8",
        );
        return {
          status: 0,
          signal: null,
          error: null,
          stdout: "",
          stderr: "",
          modelTurnPerformed: true,
          structuredTurnCompleted: false,
          workerSummary: { resultState: "SUCCESS" },
          removedEnvironment: [],
        };
      }
      fs.writeFileSync(
        path.join(cwd, "evavo.capabilities.json"),
        `${JSON.stringify(fixtureManifest(), null, 2)}\n`,
        "utf8",
      );
      return {
        status: 0,
        signal: null,
        error: null,
        stdout: JSON.stringify({ type: "turn.completed" }),
        stderr: "",
        modelTurnPerformed: true,
        structuredTurnCompleted: true,
        workerSummary: summary("SUCCESS", ["evavo.capabilities.json"]),
        removedEnvironment: [],
      };
    }

    if (mode === "no-action-mutates") {
      fs.writeFileSync(path.join(cwd, "unexpected.txt"), "unexpected\n", "utf8");
    }
    return {
      status: 0,
      signal: null,
      error: null,
      stdout: JSON.stringify({ type: "turn.completed" }),
      stderr: "",
      modelTurnPerformed: true,
      structuredTurnCompleted: true,
      workerSummary: summary("NO_ACTION", []),
      removedEnvironment: [],
    };
  };
}

function readEvidence(directory, name) {
  return JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
}

try {
  const now = new Date();

  {
    const input = createInput(now);
    const result = runCodexDocumentationTruthDormantFixtureCampaign({
      ...input,
      evidenceBaseDirectory: EVIDENCE,
      now,
      codexExecutor: fakeExecutor(),
      requirePhysicalEnable: false,
    });
    assert.ok(fs.existsSync(result.evidenceDirectory));
    const campaign = readEvidence(result.evidenceDirectory, "campaign.json");
    const supervision = readEvidence(result.evidenceDirectory, "supervision.json");
    const success = readEvidence(result.evidenceDirectory, "validated-success.json");
    const noAction = readEvidence(result.evidenceDirectory, "validated-no-action.json");
    const forbidden = readEvidence(result.evidenceDirectory, "forbidden-path-rejection.json");
    const stale = readEvidence(result.evidenceDirectory, "stale-head-rejection.json");

    assert.equal(campaign.kind, "evavo-codex-documentation-truth-dormant-fixture-campaign-v1");
    assert.equal(campaign.fixtureOnly, true);
    assert.equal(campaign.productRepositoryTouched, false);
    assert.equal(campaign.normalRouteMutationPerformed, false);
    assert.equal(campaign.workerCommitPerformed, false);
    assert.equal(campaign.publicationPerformed, false);
    assert.equal(campaign.paidFallbackUsed, false);
    assert.match(campaign.campaignSha256, /^[0-9a-f]{64}$/);

    assert.equal(supervision.fixtureRepositoryRemoteCount, 0);
    assert.equal(supervision.fixturePrimaryCheckoutClean, true);
    assert.equal(supervision.fixtureMainUnchanged, true);
    assert.equal(supervision.candidateCleanupComplete, true);
    assert.equal(supervision.registeredWorktreesAfterCleanup, 1);
    assert.equal(supervision.normalRouteWasUnchanged, true);
    assert.equal(supervision.workerCommitPerformed, false);
    assert.match(supervision.receiptSha256, /^[0-9a-f]{64}$/);

    assert.equal(success.accepted, true);
    assert.equal(success.resultState, "SUCCESS");
    assert.deepEqual(success.changedPaths, ["evavo.capabilities.json"]);
    assert.equal(success.changedFiles, 1);
    assert.ok(success.changedLines >= 1 && success.changedLines <= 600);
    assert.equal(success.modelTurnPerformed, true);
    assert.equal(success.candidateMutationPersisted, true);

    assert.equal(noAction.accepted, true);
    assert.equal(noAction.resultState, "NO_ACTION");
    assert.deepEqual(noAction.changedPaths, []);
    assert.equal(noAction.changedFiles, 0);
    assert.equal(noAction.changedLines, 0);
    assert.equal(noAction.modelTurnPerformed, true);
    assert.equal(noAction.candidateMutationPersisted, false);

    assert.equal(forbidden.accepted, false);
    assert.equal(forbidden.rejected, true);
    assert.equal(forbidden.rejectionReason, "FORBIDDEN_PATH");
    assert.equal(forbidden.modelTurnPerformed, false);
    assert.equal(forbidden.candidateMutationPersisted, false);

    assert.equal(stale.accepted, false);
    assert.equal(stale.rejected, true);
    assert.equal(stale.rejectionReason, "STALE_HEAD");
    assert.equal(stale.modelTurnPerformed, false);
    assert.equal(stale.candidateMutationPersisted, false);

    for (const name of [
      "validated-success",
      "validated-no-action",
      "forbidden-path-rejection",
      "stale-head-rejection",
    ]) {
      assert.match(supervision.scenarioReceiptSha256[name], /^[0-9a-f]{64}$/);
    }
    fs.rmSync(result.evidenceDirectory, { recursive: true, force: true });
  }

  {
    const input = createInput(now, {
      capabilityObservedAt: new Date(now.getTime() - 30 * 60_000).toISOString(),
    });
    assert.throws(
      () => runCodexDocumentationTruthDormantFixtureCampaign({
        ...input,
        evidenceBaseDirectory: EVIDENCE,
        now,
        codexExecutor: fakeExecutor(),
        requirePhysicalEnable: false,
      }),
      /capability receipt is stale or future-dated/,
    );
  }

  {
    const input = createInput(now, { dormantSupportStillDisabled: false });
    assert.throws(
      () => runCodexDocumentationTruthDormantFixtureCampaign({
        ...input,
        evidenceBaseDirectory: EVIDENCE,
        now,
        codexExecutor: fakeExecutor(),
        requirePhysicalEnable: false,
      }),
      /publication attestation is not eligible/,
    );
  }

  {
    const input = createInput(now);
    assert.throws(
      () => runCodexDocumentationTruthDormantFixtureCampaign({
        ...input,
        evidenceBaseDirectory: ROOT,
        now,
        codexExecutor: fakeExecutor(),
        requirePhysicalEnable: false,
      }),
      /outside and independent/,
    );
  }

  {
    const input = createInput(now);
    assert.throws(
      () => runCodexDocumentationTruthDormantFixtureCampaign({
        ...input,
        evidenceBaseDirectory: EVIDENCE,
        now,
        codexExecutor: fakeExecutor("success-forbidden-path"),
        requirePhysicalEnable: false,
      }),
      /inadmissible path set/,
    );
  }

  {
    const input = createInput(now);
    assert.throws(
      () => runCodexDocumentationTruthDormantFixtureCampaign({
        ...input,
        evidenceBaseDirectory: EVIDENCE,
        now,
        codexExecutor: fakeExecutor("no-action-mutates"),
        requirePhysicalEnable: false,
      }),
      /NO_ACTION fixture changed files/,
    );
  }

  {
    const input = createInput(now);
    assert.throws(
      () => runCodexDocumentationTruthDormantFixtureCampaign({
        ...input,
        evidenceBaseDirectory: EVIDENCE,
        now,
        codexExecutor: fakeExecutor("malformed-success-summary"),
        requirePhysicalEnable: false,
      }),
      /structured SUCCESS summary/,
    );
  }

  {
    const input = createInput(now);
    const previous = process.env.EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED;
    delete process.env.EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED;
    try {
      assert.throws(
        () => runCodexDocumentationTruthDormantFixtureCampaign({
          ...input,
          evidenceBaseDirectory: EVIDENCE,
          now,
          codexExecutor: fakeExecutor(),
          requirePhysicalEnable: true,
        }),
        /FIXTURE_CAMPAIGN_ENABLED=1 is required/,
      );
    } finally {
      if (previous === undefined) delete process.env.EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED;
      else process.env.EVAVO_DOCUMENTATION_TRUTH_FIXTURE_CAMPAIGN_ENABLED = previous;
    }
  }

  console.log("Documentation-truth dormant fixture campaign tests passed.");
  console.log("- success and NO_ACTION use an injected process boundary in a remote-less fixture repository");
  console.log("- forbidden-path and stale-head rejection occur without model execution");
  console.log("- cleanup proves unchanged clean main, zero remotes and one registered worktree");
  console.log("- stale capability, dormant-policy drift, path escape, invalid summaries and hidden mutation fail closed");
  console.log("- no product repository, normal route, commit, push, publication or paid-fallback authority is exercised");
} finally {
  fs.rmSync(TEMP, { recursive: true, force: true });
}
